// z=0 평면 좌표와 실제 카메라 깊이 사이를 오가는 순수 수학.
//
// seafloor.ts 의 자갈 해저는 z=0 이 아닌 여러 깊이에 물체를 놓는다(알 -0.2~-1.6,
// 바닥판 -1.8). 이 파일의 함수들은 그 변환을 담당한다 — 세 번(바닥판 구멍 크기,
// 바닥판 구멍 중심, 알의 구멍 침범 판정) 연속으로 틀렸던 계산이라 렌더링 없이
// 수치로 검증할 수 있게 별도 파일로 뺐다.
//
// seafloor.ts 에서 옮겨온 이유가 하나 더 있다: Seafloor 클래스는
// `constructor(private scene: THREE.Scene)` 같은 TS parameter property 를 쓰는데,
// `npm test` 가 쓰는 Node 내장 TypeScript strip-only 모드는 이 문법을 지원하지
// 않는다(ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). seafloor.test.ts 가 Seafloor 클래스를
// 아예 안 거치고 이 순수 함수들만 import 할 수 있어야 테스트가 실행된다.

export interface HoleBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * z=0 평면 기준 좌표(화면 px 와 상수배로 대응)를 z=planeZ 평면에서 같은 화면
 * 위치·크기로 옮기는 배율.
 *
 * 원근 카메라는 screen ∝ world / (camZ - z) 로 투영한다. z=0 에서는 분모가
 * camZ, z=planeZ 에서는 camZ - planeZ 이므로, 같은 screen 값을 내려면
 * world 좌표를 (camZ - planeZ) / camZ 배 해야 한다. 크기뿐 아니라 원점으로부터의
 * 오프셋(중심 좌표)도 같은 배율을 먹는다 — 좌표 자체가 이 식의 입력이기 때문이다.
 */
export function depthScale(camZ: number, planeZ: number): number {
  return (camZ - planeZ) / camZ;
}

/**
 * HoleBox 를 배율 k 로 늘린 새 HoleBox — 중심 오프셋(cx, cy)도 크기(w, h)와
 * 함께 늘어난다. 둘 중 하나만 늘리면 "크기는 맞는데 자리가 어긋난" 구멍이 된다
 * (round 2 에서 실제로 겪은 버그). layoutBacking() 이 구멍을 z=BACKING_Z 평면
 * 좌표로 옮길 때 이걸 쓴다.
 */
export function scaleHole(hole: HoleBox, k: number): HoleBox {
  return { cx: hole.cx * k, cy: hole.cy * k, w: hole.w * k, h: hole.h * k };
}

/**
 * 알의 중심(x, y)·반지름 r(모두 z=0 기준)이 실제 깊이 z 에서 화면에 투영되는
 * 위치·크기.
 *
 * z=0 기준 좌표를 깊이 z 에 그대로 배치하면 화면에는 depthScale(camZ, z) 로
 * 나눈 자리·크기로 찍힌다(다른 방향에서 보면 depthScale 은 "z=0 좌표를 깊이 z 에
 * 심으려면 얼마를 곱해야 하는가"이므로, 반대로 "이미 깊이 z 에 있는 z=0 기준
 * 좌표가 화면 어디에 찍히는가"는 나누기다). 반지름도 같은 배율을 받는다 —
 * 중심만 투영하고 반지름은 z=0 기준을 그대로 쓰면 깊은 알의 실제 화면 크기를
 * 못 잡아 구멍 침범 판정이 얕은 알과 깊은 알에서 서로 다른 기준을 쓰게 된다
 * (round 3 에서 실제로 겪은 버그 — 알마다 깊이가 달라 침범량이 들쭉날쭉했다).
 */
export function projectPebble(
  x: number,
  y: number,
  r: number,
  z: number,
  camZ: number,
): { x: number; y: number; r: number } {
  const k = depthScale(camZ, z);
  return { x: x / k, y: y / k, r: r / k };
}
