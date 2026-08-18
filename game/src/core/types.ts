// 퍼즐 코어 타입. DOM/브라우저 API 에 의존하지 않는다 (node --test 로 그대로 실행 가능).

/** 타일 색. 0..5 (레벨의 colors 설정에 따라 일부만 사용) */
export type Color = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * 특수 타일 종류.
 * - currentH / currentV: 해류. 가로줄/세로줄 전체를 쓸어버린다. (4연속 매치)
 * - mine: 기뢰. 3x3 폭발. (L/T 자 매치)
 * - voidPearl: 심연의 진주. 같은 색 전부 제거. (5연속 매치)
 */
export type Special = 'none' | 'currentH' | 'currentV' | 'mine' | 'voidPearl';

/**
 * 칸에 붙는 장애물.
 * - rock: 산호암. 타일 대신 칸을 차지한다. 인접 칸이 제거될 때만 피해를 받는다. 낙하를 막는다.
 * - ice: 결빙. 타일을 덮은 얼음층. 제거 판정을 한 겹씩 흡수하고 타일은 남는다.
 *        스왑은 된다 — 옮길 수는 있지만 그 자리를 뚫으려면 겹 수만큼 매치해야 한다.
 * - net: 어망. 타일을 묶어둔다. 스왑 불가. 제거 판정을 한 번 받으면 망만 풀리고 타일은 남는다.
 * - rubble: 무너진 잔해. 인접 제거로 부순다. **부수면 그 칸은 영구히 뚫린 통로가 된다**
 *           (타일이 다시 채워지지 않는다). 이 통로가 이어져야 잠수부가 탈출한다.
 */
export type Blocker = 'none' | 'rock' | 'ice' | 'net' | 'rubble';

export interface Tile {
  color: Color;
  special: Special;
}

export interface Cell {
  /** 보드에 존재하지 않는 칸 */
  hole: boolean;
  tile: Tile | null;
  blocker: Blocker;
  /** 장애물 남은 내구도. blocker === 'none' 이면 0 */
  blockerHp: number;
  /**
   * 뚫린 통로. 잔해를 부순 자리이거나 처음부터 열려 있던 칸.
   * 타일이 절대 채워지지 않고, 여기가 이어져야 잠수부가 지나간다.
   */
  passage: boolean;
}

export interface Board {
  w: number;
  h: number;
  /** 길이 w*h, 인덱스 = y * w + x */
  cells: Cell[];
  /** 이 레벨에서 사용할 색 개수 (2..6) */
  colors: number;
  /** 잠수부가 서 있는 칸 (통로). 없으면 -1 */
  start: number;
  /** 탈출구 칸 (통로). 없으면 -1 */
  exit: number;
}

export type GoalType = 'color' | 'rock' | 'ice' | 'net' | 'escape';

export interface Goal {
  type: GoalType;
  /** type === 'color' 일 때만 사용 */
  color?: Color;
  count: number;
}

export interface LevelDef {
  id: number;
  w: number;
  h: number;
  moves: number;
  /** 사용할 색 개수 (2..6) */
  colors: number;
  goals: Goal[];
  /**
   * 보드 레이아웃. 길이 h 의 문자열 배열, 각 문자열 길이 w.
   * '.' 일반 칸 / '#' 없는 칸 / 'r' 산호암 / 'R' 산호암2 / 'i' 결빙1 / 'I' 결빙2
   * 'n' 어망 / 'C' 잠수 케이지(내구도 3)
   * 'x' 잔해(내구도 2) / 'X' 잔해(내구도 3) — 부수면 영구 통로가 된다
   * 'S' 잠수부 시작 통로 / 'E' 탈출구 통로
   * 생략하면 전부 일반 칸.
   */
  layout?: string[];
  /**
   * 구조 제한 시간(산소). 값이 있으면 한 수마다 1씩 줄고,
   * 케이지를 다 부수기 전에 0이 되면 실패한다. 생략하면 산소 시스템을 쓰지 않는다.
   */
  oxygen?: number;
}

/** 이번 제거 단계에서 실제로 깎인 목표 수량 */
export interface Collected {
  rock: number;
  ice: number;
  net: number;
  /** 새로 뚫린 잔해 칸 수 */
  rubble: number;
  /** 탈출로가 이어졌으면 1 */
  escaped: number;
  /** color -> 제거된 개수 */
  colors: Partial<Record<Color, number>>;
}

export interface BlockerHit {
  index: number;
  blocker: Blocker;
  hpBefore: number;
  hpAfter: number;
}

export interface ClearPhase {
  kind: 'clear';
  /** 제거된 타일 인덱스 */
  tiles: number[];
  /** 발동한 특수 타일 */
  triggered: { index: number; special: Special }[];
  /** 이번 매치로 새로 생성된 특수 타일 */
  created: { index: number; special: Special; color: Color }[];
  blockers: BlockerHit[];
  collected: Collected;
  score: number;
}

/** 탈출로가 이어져 잠수부가 빠져나가는 순간 */
export interface EscapePhase {
  kind: 'escape';
  /** 시작 칸부터 탈출구까지의 실제 경로 (잠수부가 이 순서로 지나간다) */
  cells: number[];
}

export type Phase = ClearPhase | EscapePhase;

export interface SwapResult {
  ok: boolean;
  /** ok === false 면 빈 배열 */
  phases: Phase[];
  /** 이번 수로 얻은 총점 */
  score: number;
  /** 누적 목표 달성량 */
  collected: Collected;
}

export function emptyCollected(): Collected {
  return { rock: 0, ice: 0, net: 0, rubble: 0, escaped: 0, colors: {} };
}

export function mergeCollected(into: Collected, from: Collected): void {
  into.rock += from.rock;
  into.ice += from.ice;
  into.net += from.net;
  into.rubble += from.rubble;
  into.escaped += from.escaped;
  for (const key of Object.keys(from.colors)) {
    const c = Number(key) as Color;
    into.colors[c] = (into.colors[c] ?? 0) + (from.colors[c] ?? 0);
  }
}

export const idx = (b: Board, x: number, y: number): number => y * b.w + x;
export const xOf = (b: Board, i: number): number => i % b.w;
export const yOf = (b: Board, i: number): number => Math.floor(i / b.w);
export const inBounds = (b: Board, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < b.w && y < b.h;

/** 타일이 놓일 수 없는 칸 (구멍 / 통로 / 산호암 / 잔해) */
export function isSolid(cell: Cell): boolean {
  return (
    cell.hole ||
    cell.passage ||
    cell.blocker === 'rock' ||
    cell.blocker === 'rubble'
  );
}

/** 플레이어가 직접 움직일 수 있는 타일인가 */
export function isMovable(cell: Cell): boolean {
  return !isSolid(cell) && cell.tile !== null && cell.blocker !== 'net';
}
