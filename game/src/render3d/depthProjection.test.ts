// z=0 평면 <-> 실제 깊이 원근 보정 수학 테스트.  실행: npm test
//
// depthScale() 과 그걸 쓰는 두 곳(바닥판 구멍의 크기·중심, 알의 구멍 침범 판정)은
// seafloor.ts 작업 중 세 번 연속으로 틀렸다 — 매번 사람이 WebGL 픽셀을 눈으로
// 읽어서야 잡혔다. z=0 평면과 실제 카메라 깊이 사이를 오가는 계산이라 렌더링
// 없이도 순수 함수로 뽑아 수치로 검증할 수 있다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { depthScale, type HoleBox, projectPebble, scaleHole } from './depthProjection.ts';

const near = (a: number, b: number, eps = 1e-9): void => {
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);
};

test('depthScale: z=0 평면은 스케일 1 — 보정이 필요 없다', () => {
  near(depthScale(10, 0), 1);
  near(depthScale(12, 0), 1);
});

test('depthScale: camZ=10, planeZ=-1.8 -> (camZ - planeZ) / camZ ≈ 1.18', () => {
  near(depthScale(10, -1.8), 11.8 / 10);
});

test('depthScale: 카메라에서 더 멀수록(z 가 더 음수일수록) 스케일이 커진다', () => {
  const camZ = 10;
  const shallow = depthScale(camZ, -0.2);
  const mid = depthScale(camZ, -0.9);
  const deep = depthScale(camZ, -1.6);
  assert.ok(shallow < mid);
  assert.ok(mid < deep);
});

test('scaleHole: k 배 했다가 1/k 배 하면 원래 HoleBox 로 돌아온다 (크기·중심 둘 다)', () => {
  const hole: HoleBox = { cx: 3.7, cy: -5.2, w: 2.4, h: 3.1 };
  const k = depthScale(10, -1.8);
  const scaled = scaleHole(hole, k);
  const roundTrip = scaleHole(scaled, 1 / k);

  // 크기만 맞고 중심이 어긋나는 실패 모드가 round 2 의 실제 버그였으므로 둘 다 잰다.
  near(roundTrip.cx, hole.cx, 1e-9);
  near(roundTrip.cy, hole.cy, 1e-9);
  near(roundTrip.w, hole.w, 1e-9);
  near(roundTrip.h, hole.h, 1e-9);
});

test('scaleHole: k=1 이면 그대로다', () => {
  const hole: HoleBox = { cx: 1, cy: 2, w: 3, h: 4 };
  const scaled = scaleHole(hole, 1);
  near(scaled.cx, hole.cx);
  near(scaled.cy, hole.cy);
  near(scaled.w, hole.w);
  near(scaled.h, hole.h);
});

test('projectPebble: z=0 이면 투영해도 제자리다', () => {
  const p = projectPebble(5, -3, 1.2, 0, 10);
  near(p.x, 5);
  near(p.y, -3);
  near(p.r, 1.2);
});

test('projectPebble: round 3 버그 재현 — z=0 기준으로는 구멍 밖이어도 깊은 z 에서는 화면상 구멍을 침범할 수 있다', () => {
  const camZ = 10;
  // 구멍 절반 폭이 1인 정사각형 구멍. 중심은 원점이 아니게 잡아 round 2 처럼
  // "중심이 원점이 아닐 때만 드러나는" 실패 모드도 같이 걸리게 한다.
  const hole: HoleBox = { cx: 0.3, cy: 0.2, w: 2, h: 2 };

  // z=0 기준으로는 구멍 바로 바깥(중심에서 딱 반지름만큼 떨어진 경계)에 놓인
  // 반지름 0.05 짜리 작은 알. 옛 판정(투영 없이 x, y, r 그대로 비교)이라면
  // 통과(=배치)했을 자리다.
  const x = hole.cx + hole.w / 2 + 0.05; // 1.35
  const y = hole.cy;
  const r = 0.05;
  const z = -1.6; // 알 깊이 범위(z: -0.2 ~ -1.6) 중 가장 깊은 쪽

  // 옛 판정: 투영 없이 그대로 비교하면 구멍 밖(=배치 허용)으로 판정된다.
  const oldRejects =
    Math.abs(x - hole.cx) < hole.w / 2 + r && Math.abs(y - hole.cy) < hole.h / 2 + r;
  assert.equal(oldRejects, false, '이 좌표는 z=0 기준으로는 구멍 밖이어야 테스트 의미가 있다');

  // 새 판정: 투영한 자리로 비교하면 화면상 구멍 안쪽으로 당겨져 들어와 걸러져야 한다.
  const proj = projectPebble(x, y, r, z, camZ);
  const newRejects =
    Math.abs(proj.x - hole.cx) < hole.w / 2 + proj.r &&
    Math.abs(proj.y - hole.cy) < hole.h / 2 + proj.r;
  assert.equal(newRejects, true, 'z=-1.6 에서는 투영된 자리가 구멍을 침범해 버려져야 한다');
});

test('projectPebble: 반지름도 중심과 같은 배율로 투영된다', () => {
  const camZ = 10;
  const z = -1.8;
  const k = depthScale(camZ, z);
  const p = projectPebble(k * 2, 0, k * 0.5, z, camZ);
  near(p.x, 2);
  near(p.r, 0.5);
});
