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
  /** 격자 열 수 */
  cols: number;
  /** 격자 행 수 */
  rows: number;
  /**
   * 칸 점유 여부. **row-major**(인덱스 = row * cols + col), BoardView.holes 와
   * 같은 규약이다: `true` 면 이 칸은 보드에 없다(자갈로 채워야 한다), `false` 면
   * 보드 칸이다(자갈 해저에 파인 구멍이어야 한다).
   *
   * 보드는 이 사각형(x, y, w, h) 을 꽉 채우지 않는다 — 계단·L자·十자 같은 불규칙한
   * 모양이고, 사각형은 그 바운딩 박스일 뿐이다. 3D 쪽이 사각형 전체를 구멍으로
   * 뚫으면 실제 보드 밖이지만 바운딩 박스 안쪽인 칸에 아무것도 없어 배경이
   * 비친다 — 이 마스크가 있어야 진짜 모양대로 뚫을 수 있다.
   */
  holes: boolean[];
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
  /**
   * 무대가 실제로 다 갖춰졌는가 -- three.js 모듈을 불러오고 Stage3D 를 생성하는
   * 것과는 다른 시점이다. 생성자는 동기라 바로 끝나지만, 잠수부(diver.glb)와
   * 포식자(anglerfish/goblinShark/squid.glb) 는 생성자 안에서 fetch 를 걸어 두고
   * await 하지 않는다 -- 그래야 무대 자체는 즉시 화면에 떠서(자갈·조명·광선판)
   * 텅 빈 채로 몇 초씩 기다리지 않는다. 하지만 그 fetch 들이 끝나기 전에 게임을
   * 시작하면 잠수부·포식자가 화면에 "툭" 나타나는 게 보인다 -- 호출부
   * (screens/level.ts) 가 이 프로미스를 기다렸다가 게임을 시작하려면 로드가
   * 실제로 끝나는 시점이 필요하다.
   *
   * fetch 가 실패해도(네트워크 등) 이 프로미스는 거부(reject)하지 않는다 -- 각
   * 로더(diver.ts/predators.ts)가 자기 실패를 안에서 삼키고 콘솔 경고만 남기기
   * 때문이다(정지 포즈로 대체). 호출부가 .catch 를 따로 안 달아도 안전하다.
   */
  ready(): Promise<void>;
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
