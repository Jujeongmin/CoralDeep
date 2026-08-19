// 포식자 접근 경로가 보드 사각형(보드 아래 정렬 이후, 화면 위쪽 빈 띠)을 침범하지
// 않는지 검증.
//
// predators.ts 의 Predators 클래스는 constructor(private scene, private kind) 같은 TS
// parameter property 를 써서 npm test 의 Node 내장 strip-only 로더로 못 읽는다
// (depthProjection.ts 상단 주석 참고 — diver.ts/seafloor.ts 와 같은 이유, diver.test.ts
// 가 diver.ts 를 import 하지 않고 상수를 옮겨 적는 것과 같은 사정이다). 그래서 여기서도
// CONFIG(far/near/bodyLength/reach) 값을 그대로 옮겨 적었다 — predators.ts 의 값을
// 바꾸면 여기도 같이 맞춰야 한다.
//
// 예전(튜브 접근) 버전은 4개 제어점을 검사했다. 지금은 danger 가 거리 하나만 옮기므로
// (파일 상단 브리핑 — 실제 크기가 고정된 생물이 다가온다) 검사할 자리도 하나다:
// danger 가 가장 위험한(=화면에서 가장 크고 가까운) danger=1 의 near 위치, 그리고
// 대조군으로 danger=0 의 far 위치. near 가 통과하면 danger 가 그 사이 어느 값이든
// (lerp 이므로) 안전하다 — 두 끝점이 다 안이면 볼록결합인 중간도 안이다.
//
// 실측 화면(8번 과제 착수 직전 상태, task-8-brief 컨텍스트): 638px 캔버스에서 보드가
// y 6..392 를 차지했다(sceneH=0, 보드 높이 386px). 8번 과제가 boardView.resize() 를
// `originY = h - boardH - pad` 로 바꾸면 같은 보드가 y 246..632 로 내려가고, 빈 띠는
// 위쪽 0..246(약 38.6%)으로 남는다 — 그 숫자를 그대로 재현해 검증한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectPebble } from './depthProjection.ts';

/** predators.ts 의 PredatorKind (levels.ts 에서 옮겨온 값과 같다) */
type PredatorKind = 'anglerfish' | 'goblinShark' | 'squid';

/** stage.ts 의 CAM_Z */
const CAM_Z = 10;
/** stage.ts 의 FOV */
const FOV = 45;

/**
 * predators.ts 의 CONFIG 를 그대로 옮겨 적었다 — far/near 는 z=0 평면 기준 world
 * 좌표, bodyLength 는 world 단위 몸길이, reach 는 몸 중심에서 가장 먼 정점까지
 * 거리(몸길이=1 기준, 굽는 도구가 실측해 로그로 알려준 값을 여유 있게 올림)다.
 * radius = bodyLength * reach 가 danger=1(near) 에서 실제로 화면에 찍히는
 * "몸 전체를 감싸는 구"의 반지름이다.
 */
interface PredatorConfig {
  far: [number, number, number];
  near: [number, number, number];
  bodyLength: number;
  reach: number;
}

const CONFIG: Record<PredatorKind, PredatorConfig> = {
  anglerfish: { far: [4.5, 2.2, -3.0], near: [1.35, 1.85, 1.65], bodyLength: 1.25, reach: 0.53 },
  goblinShark: { far: [-5.0, 2.6, -3.2], near: [-1.5, 2.0, 1.7], bodyLength: 1.5, reach: 0.56 },
  squid: { far: [0.2, 5.8, -2.5], near: [0.9, 2.9, 1.6], bodyLength: 1.2, reach: 0.52 },
};

/** projection.ts 의 planeView() 와 같은 식 — worldW 는 y 경계 계산에 안 쓰여 생략한다 */
const WORLD_H = 2 * Math.tan(((FOV * Math.PI) / 180) / 2) * CAM_Z;

/** 8번 과제 이후 실측 시나리오: 638px 캔버스, 보드 상단이 246px 지점 */
const CANVAS_H = 638;
const BOARD_TOP_PX = 246;

/** 화면 sy=BOARD_TOP_PX 에 대응하는 z=0 평면 world y — 이보다 커야 빈 띠(보드 밖) 안이다 */
const BOARD_TOP_WORLD_Y = (0.5 - BOARD_TOP_PX / CANVAS_H) * WORLD_H;

/** predators.ts 의 FAR_SCALE — danger=0 에서 bodyLength 에 곱하는 배율 */
const FAR_SCALE = 0.05;

const KINDS: PredatorKind[] = ['anglerfish', 'goblinShark', 'squid'];

// "danger 를 바꿔도 화면이 거의 안 변한다" 는 리뷰(코디네이터) 대응 — far(danger=0)
// 와 near(danger=1) 의 화면상 지름이 실제로 크게 벌어지는지를 375x812 화면 기준
// 수치로 못박아 둔다. 이 값이 좁아지면(리팩터 중 FAR_SCALE 을 실수로 키우는 등)
// "다가옴"이 안 보이는 퇴행이므로, 여기서 비율 상한으로 잡아 둔다.
{
  const SCREEN_H = 812;
  const PX_PER_WORLD = SCREEN_H / WORLD_H; // worldH 는 화면 크기와 무관 (FOV/camZ 만의 함수)

  for (const kind of KINDS) {
    test(`${kind}: danger=0 이 danger=1 대비 화면에서 뚜렷하게 작다(원근 무시하고 스케일만 비교해도)`, () => {
      const cfg = CONFIG[kind];
      const rNear = cfg.bodyLength * cfg.reach;
      const rFar = rNear * FAR_SCALE;
      const projNear = projectPebble(cfg.near[0], cfg.near[1], rNear, cfg.near[2], CAM_Z);
      const projFar = projectPebble(cfg.far[0], cfg.far[1], rFar, cfg.far[2], CAM_Z);
      const diameterNearPx = projNear.r * 2 * PX_PER_WORLD;
      const diameterFarPx = projFar.r * 2 * PX_PER_WORLD;
      // "작은 일부"의 기준 — near 의 15% 미만이면 눈에 띄게 다른 크기다(참고로 실측은
      // 6~8% 수준, report 참고). 이 상한을 넘으면 danger=0 이 이미 danger=1 과 비슷해
      // 보인다는 뜻이라 회귀로 본다.
      assert.ok(
        diameterFarPx < diameterNearPx * 0.15,
        `${kind}: danger=0 지름(${diameterFarPx.toFixed(1)}px) 이 danger=1 지름` +
          `(${diameterNearPx.toFixed(1)}px) 의 15% 이상이다 — 접근이 화면에서 잘 안 보일 만큼 좁다`,
      );
      // near 자체도 "위협적"이라 부를 만큼 커야 한다(너무 작아지면 반대 방향 회귀).
      assert.ok(
        diameterNearPx > 100,
        `${kind}: danger=1 지름(${diameterNearPx.toFixed(1)}px)이 100px 도 안 된다 — 가까이 와도 안 위협적이다`,
      );
    });
  }
}

for (const kind of KINDS) {
  const cfg = CONFIG[kind];
  for (const [label, point] of [
    ['far(danger=0)', cfg.far],
    ['near(danger=1)', cfg.near],
  ] as const) {
    test(`${kind}: ${label} 에서 몸 전체가 보드 위 빈 띠 경계를 넘지 않는다`, () => {
      const [x, y, z] = point;
      const radius = cfg.bodyLength * cfg.reach;
      // controlPoints 를 검증하던 예전 테스트와 같은 도구(projectPebble — seafloor.ts
      // 가 자갈 알의 구멍 침범을 판정할 때 쓰는 것과 같은 함수)로, 중심과 반지름을
      // 실제 깊이(z)에서 화면에 투영한 값을 잰다.
      const proj = projectPebble(x, y, radius, z, CAM_Z);
      const bottomEdge = proj.y - proj.r;
      assert.ok(
        bottomEdge > BOARD_TOP_WORLD_Y,
        `${kind} ${label}(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) 의 ` +
          `아래쪽 경계(${bottomEdge.toFixed(3)})가 빈 띠 경계(${BOARD_TOP_WORLD_Y.toFixed(3)})를 넘었다`,
      );
    });
  }

  test(`${kind}: danger 가 0..1 사이 어느 값이어도 far/near 를 잇는 직선 위라 안전하다`, () => {
    // step() 은 posScratch.copy(far).lerp(near, danger) 로 위치를 잡는다(+wobble,
    // x 축으로 아주 작게만 흔들려 이 볼록결합 논증을 크게 안 어긋낸다). far·near
    // 둘 다 빈 띠 안이면(위 두 테스트) 그 사이 어떤 danger 값의 위치도 두 안전한
    // 점의 볼록결합이다 — 다만 "화면에 투영된 아래쪽 경계"는 z 가 섞이며 y/r 를
    // 나누는 depthScale 도 같이 바뀌어 순수 선형은 아니므로, 중간값 몇 개를 실제로
    // 찍어 재확인한다(수학적 증명 대신 촘촘한 샘플링으로 안전망을 친다).
    for (let i = 0; i <= 10; i++) {
      const d = i / 10;
      const x = cfg.far[0] + (cfg.near[0] - cfg.far[0]) * d;
      const y = cfg.far[1] + (cfg.near[1] - cfg.far[1]) * d;
      const z = cfg.far[2] + (cfg.near[2] - cfg.far[2]) * d;
      const radius = cfg.bodyLength * cfg.reach;
      const proj = projectPebble(x, y, radius, z, CAM_Z);
      const bottomEdge = proj.y - proj.r;
      assert.ok(
        bottomEdge > BOARD_TOP_WORLD_Y,
        `${kind} danger=${d} 위치(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) 의 ` +
          `아래쪽 경계(${bottomEdge.toFixed(3)})가 빈 띠 경계(${BOARD_TOP_WORLD_Y.toFixed(3)})를 넘었다`,
      );
    }
  });
}
