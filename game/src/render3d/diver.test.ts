// 잠수부의 대기 중 흔들림이 빈 띠(clearBand)를 벗어나지 않는지 검증.
//
// diver.ts 는 Diver 클래스가 constructor(private scene: THREE.Scene) 같은 TS
// parameter property 를 써서 npm test 의 Node 내장 strip-only 로더로 못 읽는다
// (depthProjection.ts 상단 주석 참고 — seafloor.ts 와 같은 이유다). 그래서 흔들림
// 상한을 계산하는 순수 수학(maxIdleBobWorld 와 그 재료인 screenDelta /
// worldDeltaForScreen)은 depthProjection.ts 에 있고, 여기서는 그 함수들과 diver.ts /
// stage.ts 양쪽의 상수를 그대로 옮겨 적어 실제 파이프라인을 재현한다 — 값을 바꾸면
// 여기도 같이 맞춰야 한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { depthScale, maxIdleBobWorld, screenDelta, worldDeltaForScreen } from './depthProjection.ts';
import { planeView } from './projection.ts';

const CAM_Z = 10;
const FOV = 45;
/** diver.ts 의 HOME_Z */
const HOME_Z = 1.2;
/** diver.ts 의 CELLS_TALL */
const CELLS_TALL = 1.9;
/** diver.ts 의 MODEL_WIDTH_RATIO — diver.glb 버텍스 바운딩 박스 실측(약 0.336)을 올려 잡았다 */
const MODEL_WIDTH_RATIO = 0.34;
/** diver.ts step() 의 흔들림 식: bob = (0.06+0.035) * amp, amp = 1 + danger*1.8 */
const BOB_COEFF = 0.06 + 0.035;
const AMP_AT_MAX_DANGER = 1 + 1 * 1.8;
/** stage.ts setBoardRect() 의 대기 크기 클램프 여유 */
const REST_MARGIN = 0.9;

test('worldDeltaForScreen 은 screenDelta 의 역함수다', () => {
  const view = planeView(400, 800, FOV, CAM_Z);
  const world = worldDeltaForScreen(CAM_Z, HOME_Z, 40, view.pxPerWorld);
  const backToScreen = screenDelta(CAM_Z, HOME_Z, world, view.pxPerWorld);
  assert.ok(Math.abs(backToScreen - 40) < 1e-9);
});

test('screenDelta: 카메라에 가까운 HOME_Z 에서는 같은 world 변위가 z=0 보다 화면에서 더 크게 보인다', () => {
  const view = planeView(400, 800, FOV, CAM_Z);
  const atHome = screenDelta(CAM_Z, HOME_Z, 1, view.pxPerWorld);
  const atZero = screenDelta(CAM_Z, 0, 1, view.pxPerWorld);
  assert.ok(atHome > atZero);
  // 리뷰가 독립적으로 재도출한 배율(1 / depthScale(camZ, HOME_Z) ≈ 1.136)과 정확히 일치해야 한다
  assert.ok(Math.abs(atHome / atZero - 1 / depthScale(CAM_Z, HOME_Z)) < 1e-9);
});

test('maxIdleBobWorld: 빈 띠가 넉넉하면 흔들림을 거의 안 줄인다', () => {
  const view = planeView(400, 800, FOV, CAM_Z);
  const heightPx = 90; // cellPx * CELLS_TALL 정도
  const bandHeightPx = 600; // 대기 크기의 몇 배나 되는 넉넉한 띠
  const maxBob = maxIdleBobWorld(heightPx, bandHeightPx, MODEL_WIDTH_RATIO, CAM_Z, HOME_Z, view.pxPerWorld);
  const worstBobWorld = BOB_COEFF * AMP_AT_MAX_DANGER;
  assert.ok(maxBob >= worstBobWorld); // 넉넉하면 애초에 클램프가 걸리지 않아야 한다
});

test('danger=1 최대 흔들림 + 회전 실루엣 + 대기 크기가, 클램프가 실제로 작동하는 타이트한 빈 띠 안에 들어온다', () => {
  const view = planeView(400, 800, FOV, CAM_Z);

  // 일부러 빡빡하게 잡는다 -- stage.ts 의 클램프(cellPx = min(r.cell, bandHeightPx*0.9/CELLS_TALL))
  // 가 실제로 작동하는 영역이어야 이 테스트가 뜻이 있다.
  const bandHeightPx = 120;
  const rCell = 200; // 클램프가 걸리도록 충분히 큰 칸
  const cellPx = Math.min(rCell, (bandHeightPx * REST_MARGIN) / CELLS_TALL);
  assert.ok(cellPx < rCell, '이 테스트는 클램프가 걸리는 시나리오를 가정한다');
  const heightPx = cellPx * CELLS_TALL;

  const maxBobWorld = maxIdleBobWorld(
    heightPx,
    bandHeightPx,
    MODEL_WIDTH_RATIO,
    CAM_Z,
    HOME_Z,
    view.pxPerWorld,
  );
  const worstBobWorld = BOB_COEFF * AMP_AT_MAX_DANGER;
  // diver.ts step() 이 실제로 하는 클램프
  const clampedBobWorld = Math.min(worstBobWorld, maxBobWorld);
  assert.ok(clampedBobWorld < worstBobWorld, '이 시나리오에서는 클램프가 실제로 흔들림을 줄여야 한다');

  const bobScreenPx = screenDelta(CAM_Z, HOME_Z, clampedBobWorld, view.pxPerWorld);
  // 어떤 각도로 기울어도 실루엣은 이 반지름의 원을 벗어나지 않는다
  const rotationReachPx = (heightPx / 2) * (Math.hypot(1, MODEL_WIDTH_RATIO) - 1);

  const totalReachPx = heightPx / 2 + rotationReachPx + bobScreenPx;
  assert.ok(
    totalReachPx <= bandHeightPx / 2 + 1e-6,
    `흔들림 + 회전 + 대기 크기(${totalReachPx}px)가 빈 띠 절반(${bandHeightPx / 2}px)을 넘었다`,
  );
});
