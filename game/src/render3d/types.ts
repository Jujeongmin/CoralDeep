// 2D 보드와 3D 무대가 주고받는 값들.
// 두 쪽이 서로를 import 하면 순환이 생기므로 타입만 여기에 둔다.

/**
 * 보드 사각형. **뷰포트 좌표**(getBoundingClientRect 기준) 이고 단위는 CSS px 이다.
 *
 * 캔버스 두 장은 서로 다른 박스를 가진다 — 보드 캔버스는 .level-screen 의 좌우 패딩
 * 안쪽에 있고 3D 캔버스는 화면 전체를 덮는다. 각자의 캔버스 로컬 좌표로 주고받으면
 * 그 차이만큼 어긋난다. 뷰포트를 공통 기준으로 삼고 받는 쪽이 자기 원점을 뺀다.
 */
export interface BoardRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 칸 한 변 (px) — 잠수부 크기를 여기에 맞춘다 */
  cell: number;
}

/** 탈출 중 잠수부가 있어야 할 화면 좌표 */
export interface DescentPoint {
  x: number;
  y: number;
  cell: number;
  /** 탈출 진행도 0..1 */
  t: number;
}

export interface SceneView {
  /** 0 = 여유, 1 = 한계. 산소 잔량에서 온다 */
  danger: number;
  /** 레벨 목표 달성률 0..1 */
  progress: number;
}

export interface Stage {
  /** 상태 갱신. 렌더 루프는 BoardView 가 돌린다 */
  step(dt: number): void;
  render(): void;
  resize(): void;
  setBoardRect(r: BoardRect): void;
  setView(v: SceneView): void;
  setDescent(p: DescentPoint | null): void;
  /** 잠수부가 지금 있는 화면 좌표 — 탈출이 여기서 시작한다 */
  diverAnchorScreen(): { x: number; y: number };
  /** 화면을 흔들 px (2D 보드도 같은 값으로 흔든다) */
  shake(): number;
  /** 장애물을 하나 부쉈을 때 */
  cheer(): void;
  /** 잠수부가 탈출했을 때 */
  rescued(): void;
  dispose(): void;
}
