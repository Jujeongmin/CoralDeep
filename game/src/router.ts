// 아주 작은 화면 라우터. 순환 import 를 피하려고 등록/이동만 담당한다.

export type ScreenName = 'map' | 'aquarium' | 'level';

export interface NavParams {
  levelId?: number;
  preBoosters?: ('current' | 'mine' | 'pearl')[];
}

type Renderer = (host: HTMLElement, params: NavParams) => void | Promise<void>;

const screens = new Map<ScreenName, Renderer>();
let host: HTMLElement | null = null;
let current: ScreenName | null = null;

export function registerScreen(name: ScreenName, render: Renderer): void {
  screens.set(name, render);
}

export function setHost(node: HTMLElement): void {
  host = node;
}

export function currentScreen(): ScreenName | null {
  return current;
}

let currentParams: NavParams = {};

export function navigate(name: ScreenName, params: NavParams = {}): void {
  const render = screens.get(name);
  if (!render || !host) return;
  // 이전 화면이 붙여둔 정리 훅을 먼저 돌린다 (rAF 루프, 타이머 해제)
  host.dispatchEvent(new CustomEvent('screen:destroy'));
  current = name;
  currentParams = params;
  host.replaceChildren();
  void render(host, params);
}

/**
 * 지금 화면을 다시 그린다.
 *
 * 언어를 바꾸면 저장값만 바뀌고 이미 그려진 글자는 그대로 남는다.
 * 화면 전체를 다시 그려야 지도·독·HUD 까지 한 번에 바뀐다.
 * 판을 푸는 중에는 진행이 날아가므로 지도로 되돌린다.
 */
export function reloadScreen(): void {
  if (!current) return;
  if (current === 'level') {
    navigate('map');
    return;
  }
  navigate(current, currentParams);
}
