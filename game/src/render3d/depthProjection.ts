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

/**
 * 깊이 z 에 이미 놓인 물체 위에 world 단위로 더한 변위(worldDelta)가 화면에서
 * 몇 px 로 보이는가.
 *
 * diver.ts 의 잠수부는 place()/setDescent() 가 중심 좌표·크기를 depthScale(camZ, z)
 * 로 미리 보정해 두지만(z=0 기준 좌표를 곱해서 depth 에 심는다), 그 위에 얹는
 * 흔들림(bob) 같은 애니메이션 오프셋은 world 좌표계에 직접 더해진다 — 이미 보정된
 * 좌표 위에 보정 안 된 변위를 얹는 셈이다. 그 변위가 화면에 나타날 때는 원근
 * 카메라의 screen ∝ world / (camZ - z) 관계 그대로 적용되므로, place() 가 곱하는
 * 방향(depthScale, z=0 -> z 로 심을 때 축소)과 반대로 카메라에 가까울수록
 * (depthScale(camZ, z) < 1) 더 크게 보인다 — 나누는 방향이다.
 */
export function screenDelta(
  camZ: number,
  z: number,
  worldDelta: number,
  pxPerWorld: number,
): number {
  return (worldDelta * pxPerWorld) / depthScale(camZ, z);
}

/**
 * screenDelta() 의 역함수 — 화면에서 이만큼만 흔들리길 원할 때(screenDeltaPx),
 * 깊이 z 에서 필요한 world 변위. 흔들림 진폭을 화면 여유(빈 띠 안 남는 px)에
 * 맞춰 거꾸로 잡을 때 쓴다.
 */
export function worldDeltaForScreen(
  camZ: number,
  z: number,
  screenDeltaPx: number,
  pxPerWorld: number,
): number {
  return (screenDeltaPx * depthScale(camZ, z)) / pxPerWorld;
}

/**
 * 대기 중인 잠수부가 흔들려도 되는 world 진폭의 상한.
 *
 * 대기 크기(heightPx, 이미 빈 띠 높이에 맞춰 줄어 있을 수 있다 — stage.ts 의 클램프
 * 참고)를 빈 띠(bandHeightPx) 가운데 두면 위아래로 (bandHeightPx - heightPx) / 2 씩
 * 여유가 남는다. 그런데 몸이 기울면(tilt, 화면 평면 축 회전) 실루엣이 세운 키의
 * 절반보다 더 뻗는다 — 어떤 각도로 기울어도 실루엣은 반지름
 * sqrt((h/2)^2 + (w/2)^2) 인 원을 벗어나지 못한다는 사실로(각도별로 정확히 계산할
 * 필요 없이 모든 각도에 안전한 상한이다), 그 초과분을 여유에서 먼저 뗀 뒤 나머지를
 * 흔들림에 배정한다. 남는 px 여유는 worldDeltaForScreen() 으로 world 단위로 바꾼다.
 *
 * widthRatio 는 실루엣의 가로/세로 비(w/h). 회전축이 세로축인 요(yaw)은 y 좌표를
 * 그대로 두므로 세로 실루엣을 넓히지 않는다 — 이 함수는 기울기(tilt)만 본다.
 */
export function maxIdleBobWorld(
  heightPx: number,
  bandHeightPx: number,
  widthRatio: number,
  camZ: number,
  z: number,
  pxPerWorld: number,
): number {
  const halfMargin = Math.max(0, (bandHeightPx - heightPx) / 2);
  const rotationReach = (heightPx / 2) * (Math.hypot(1, widthRatio) - 1);
  const marginPx = Math.max(0, halfMargin - rotationReach);
  return worldDeltaForScreen(camZ, z, marginPx, pxPerWorld);
}

/**
 * 접지(발이 보드 위 접지선에 선) 상태의 잠수부가 기울 때(tilt, z 축 회전) 실루엣이
 * 접지선 아래로 파고들 수 있는 최대 px 반경.
 *
 * 잠수부 모델의 원점(y=0)은 발이다(tools/bake-diver-glb.mjs 의 정규화 참고) —
 * three.js Object3D 는 로컬 원점을 축으로 회전한 뒤 position 만큼 옮기므로, 발
 * (로컬 원점)은 몸이 기울어도 제자리다(diver.ts place()/step() 참고). 다만 발
 * 옆으로 뻗은 폭(widthRatio, 전신 높이 대비 가로 비) 때문에, 몸이 기울면 발 높이
 * (y=0)에 있는 옆 지점(x=±width/2)이 살짝 접지선 아래로 내려간다 — 세로축 회전인
 * 요(yaw)는 y 를 안 건드리므로 이 계산과 무관하다(diver.ts step() 의 결론과 같다).
 *
 * y' = x*sin(tilt) + y*cos(tilt) 를 y∈[0,1](발~정수리), x∈[-width/2,width/2],
 * |tilt|<=tiltMaxRad 범위에서 최소화하면, cos(tilt)>0(tiltMaxRad 는 90도 근처에도
 * 못 미친다) 이므로 y 항은 y=0 일 때가 가장 작고(더 낮출 수 없다 — 이미 0), x 항은
 * x=∓width/2, tilt=±tiltMaxRad 일 때 가장 작다(가장 음수). 그래서 정수리 쪽
 * heightPx 전체가 아니라 발 옆 폭만으로 정해진다 — 발보다 위에 있는 몸통·머리는
 * 오히려 덜 위험하다(cos(tilt)≈1 이라 y 성분이 거의 그대로 양수로 남는다).
 */
export function standingTiltReachPx(
  heightPx: number,
  widthRatio: number,
  tiltMaxRad: number,
): number {
  return heightPx * (widthRatio / 2) * Math.sin(tiltMaxRad);
}

/**
 * 접지 상태에서, 위로만 뜨는 흔들림(bob)이 가질 수 있는 world 진폭 상한.
 *
 * maxIdleBobWorld() 는 빈 띠 가운데 배치를 가정해 위아래로 여유를 반씩 나눴다.
 * 접지 상태는 발이 접지선에 그대로 붙어 있어(standingTiltReachPx() 참고) 아래로는
 * 여유가 필요 없다 — reachPx 만큼만 접지선 위로 몸을 미리 세워 두면(diver.ts
 * place() 가 적용) 최악의 기울기에도 안전하고, 남는 여유(bandHeightPx - heightPx -
 * reachPx) 를 전부 위쪽 흔들림에 배정할 수 있다.
 */
export function maxStandingBobWorld(
  heightPx: number,
  bandHeightPx: number,
  reachPx: number,
  camZ: number,
  z: number,
  pxPerWorld: number,
): number {
  const marginPx = Math.max(0, bandHeightPx - heightPx - reachPx);
  return worldDeltaForScreen(camZ, z, marginPx, pxPerWorld);
}
