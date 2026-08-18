// 포식자 접근 곡선이 보드 사각형(보드 아래 정렬 이후, 화면 위쪽 빈 띠)을 침범하지
// 않는지 검증.
//
// predators.ts 의 Predators 클래스는 constructor(private scene, private kind) 같은 TS
// parameter property 를 써서 npm test 의 Node 내장 strip-only 로더로 못 읽는다
// (depthProjection.ts 상단 주석 참고 — diver.ts/seafloor.ts 와 같은 이유, diver.test.ts
// 가 diver.ts 를 import 하지 않고 상수를 옮겨 적는 것과 같은 사정이다). 그래서 여기서도
// controlPoints() 의 제어점 식을 그대로 옮겨 적는다 — predators.ts 의 값을 바꾸면
// 여기도 같이 맞춰야 한다.
//
// 실측 화면(8번 과제 착수 직전 상태, task-8-brief 컨텍스트): 638px 캔버스에서 보드가
// y 6..392 를 차지했다(sceneH=0, 보드 높이 386px). 8번 과제가 boardView.resize() 를
// `originY = h - boardH - pad` 로 바꾸면 같은 보드가 y 246..632 로 내려가고, 빈 띠는
// 위쪽 0..246(약 38.6%)으로 남는다 — 그 숫자를 그대로 재현해 검증한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectPebble } from './depthProjection.ts';

/** predators.ts 의 PredatorKind (levels.ts 에서 옮겨온 값과 같다) */
type PredatorKind = 'eel' | 'angler' | 'tentacle';

/** stage.ts 의 CAM_Z */
const CAM_Z = 10;
/** stage.ts 의 FOV */
const FOV = 45;
/** predators.ts rebuild() 의 최대 튜브 반지름 (0.28 + danger*0.1, danger=1) */
const MAX_TUBE_RADIUS = 0.38;

/**
 * predators.ts 의 EEL_HEAD_REACH — 곰치 머리(주둥이·눈·아래턱·이빨)가 앵커(튜브
 * 끝 제어점, controlPoints() 의 마지막 점)에서 가장 멀리 뻗는 거리. 아래턱 앞쪽
 * 아래 모서리가 가장 멀다(predators.ts EEL_HEAD_REACH 주석의 계산과 같다). 머리는
 * 튜브 끝에만 붙으므로 마지막 제어점에서만 이 반지름을 쓴다 — 나머지 세 점은
 * 튜브 자체의 반지름(MAX_TUBE_RADIUS)만으로 충분하다.
 */
const EEL_HEAD_REACH = 0.5;

/**
 * 아귀 머리(주둥이+눈)의 최대 반지름 — predators.ts 주석대로 0.222 로
 * MAX_TUBE_RADIUS(0.38) 보다 작다. 튜브 자체가 이미 검증하는 범위 안이므로
 * 아귀는 반지름을 따로 늘리지 않는다(코드에도 상수를 안 둔 이유와 같다).
 */

/** projection.ts 의 planeView() 와 같은 식 — worldW 는 y 경계 계산에 안 쓰여 생략한다 */
const WORLD_H = 2 * Math.tan(((FOV * Math.PI) / 180) / 2) * CAM_Z;

/** 8번 과제 이후 실측 시나리오: 638px 캔버스, 보드 상단이 246px 지점 */
const CANVAS_H = 638;
const BOARD_TOP_PX = 246;

/** 화면 sy=BOARD_TOP_PX 에 대응하는 z=0 평면 world y — 이보다 커야 빈 띠(보드 밖) 안이다 */
const BOARD_TOP_WORLD_Y = (0.5 - BOARD_TOP_PX / CANVAS_H) * WORLD_H;

/** predators.ts Predators.controlPoints() 를 그대로 옮겨 적었다 */
function controlPoints(kind: PredatorKind, k: number): [number, number, number][] {
  const reach = k;
  switch (kind) {
    case 'eel':
      return [
        [4.2, 2.2, -1.5],
        [4.2 - 1.6 * reach, 2.1, -1.0],
        [4.2 - 3.2 * reach, 1.8, -0.2 + 1.4 * reach],
        [4.2 - 4.6 * reach, 1.6, 0.2 + 1.6 * reach],
      ];
    case 'angler':
      return [
        [-4.5, 3.0, -3.0],
        [-3.0 + 1.2 * reach, 2.8, -2.2 + 0.8 * reach],
        [-1.6 + 1.4 * reach, 2.4, -1.0 + 1.4 * reach],
        [-0.4 + 0.6 * reach, 2.0, 0.2 + 1.4 * reach],
      ];
    case 'tentacle':
    default:
      return [
        [1.4, 5.8, -2.0],
        [1.2, 4.8 - 0.9 * reach, -1.2],
        [0.7, 3.8 - 1.2 * reach, -0.2 + 1.0 * reach],
        [0.2, 2.8 - 1.0 * reach, 0.4 + 1.4 * reach],
      ];
  }
}

const KINDS: PredatorKind[] = ['eel', 'angler', 'tentacle'];

for (const kind of KINDS) {
  for (const danger of [0, 1]) {
    test(`${kind}: danger=${danger} 에서 몸 전체가 보드 위 빈 띠 경계를 넘지 않는다`, () => {
      const pts = controlPoints(kind, danger);
      pts.forEach(([x, y, z], i) => {
        // 제어점(x, y, z, z=0 기준)이 실제로는 z 깊이에 있으므로 화면에 찍히는
        // 자리·반지름은 projectPebble() 로 구한다 — seafloor.ts 가 자갈 알의 구멍
        // 침범을 판정할 때 쓰는 것과 같은 함수다.
        //
        // 곰치는 마지막 제어점(튜브 끝, i === pts.length-1)에 머리(주둥이·눈·턱·
        // 이빨)가 붙어 튜브 반지름보다 더 멀리 뻗는다 — 그 점만 EEL_HEAD_REACH 로
        // 검증한다(predators.ts 의 buildEelHead()/EEL_HEAD_REACH 주석 참고). 나머지
        // 제어점과 다른 종은 튜브 반지름(MAX_TUBE_RADIUS)만으로 충분하다(아귀 머리는
        // 0.222 로 이미 그 안에 들어간다 — 위 주석 참고).
        const isEelHead = kind === 'eel' && i === pts.length - 1;
        const r = isEelHead ? EEL_HEAD_REACH : MAX_TUBE_RADIUS;
        const proj = projectPebble(x, y, r, z, CAM_Z);
        const bottomEdge = proj.y - proj.r;
        assert.ok(
          bottomEdge > BOARD_TOP_WORLD_Y,
          `${kind} 제어점(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})의 ` +
            `${isEelHead ? '머리' : '몸통'} 아래쪽 경계(${bottomEdge.toFixed(3)})가 ` +
            `빈 띠 경계(${BOARD_TOP_WORLD_Y.toFixed(3)})를 넘었다`,
        );
      });
    });
  }
}
