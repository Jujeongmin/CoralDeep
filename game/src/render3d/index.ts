// 3D 무대 진입점.
//
// three 는 여기서만 동적으로 불러온다. 지도·수족관 화면은 3D 를 안 쓰므로 앱을 켜자마자
// 150KB 를 내려받을 이유가 없다.
//
// 실패하면 null 을 준다. 그때는 CSS 그라디언트 배경만 남고 보드는 정상 동작한다.
// 이건 저사양 대응이 아니라 사고 대응이다 — 저사양은 품질 티어가 처리한다.

import type { Stage } from './types.ts';

export type { Stage } from './types.ts';

/**
 * WebGL 컨텍스트를 실제로 딸 수 있는가.
 *
 * probe 를 인자로 받는다 — Node 테스트 환경에는 DOM 이 없어 진짜 `<canvas>` 를
 * 만들 수 없다. 판정 로직만 떼어 실제 canvas 없이도 실행해 증명하려면 canvas를
 * 만드는 부분을 갈아끼울 수 있어야 한다. 기본값은 진짜 canvas 를 쓴다.
 */
export function webglAvailable(
  probe: () => { getContext(id: string): unknown } = () => document.createElement('canvas'),
): boolean {
  try {
    const c = probe();
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export async function createStage(
  canvas: HTMLCanvasElement,
  depth: number,
  // WebGL 판정 함수도 주입 가능하게 둔다 — 위 webglAvailable() 과 같은 이유다.
  // 기본값은 실제 판정이므로 호출부(screens/level.ts)는 인자 두 개만 넘기면 된다.
  detect: () => boolean = webglAvailable,
): Promise<Stage | null> {
  if (!detect()) return null;
  try {
    const { Stage3D } = await import('./stage.ts');
    return new Stage3D(canvas, depth);
  } catch (e) {
    console.warn('3D 무대 로드 실패 — 배경만 남긴다', e);
    return null;
  }
}
