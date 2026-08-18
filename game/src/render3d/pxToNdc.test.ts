// CSS px <-> NDC 변환 수학 테스트.  실행: npm test
//
// particles.ts 가 점 하나의 반지름(px)을 보드 구멍 판정 여유로 바꿀 때 쓰는 계산이다.
// 이 값을 고정 상수로 어림했다가(HOLE_MARGIN=0.03) "화면이 어느 정도보다 좁아지면
// 안전을 못 보장한다"는 지적을 받고 정확한 값으로 바꿨다 -- depthProjection.ts 가
// 겪은 것과 같은 종류의 실패(화면 기하를 손으로 어림)라 같은 방식(순수 함수 + 수치
// 테스트)으로 막는다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { clampDpr, cssSizeFromView, pxToNdc } from './pxToNdc.ts';
import { planeView } from './projection.ts';

const near = (a: number, b: number, eps = 1e-9): void => {
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);
};

test('cssSizeFromView: planeView 를 만든 원래 CSS px 크기를 되짚는다', () => {
  for (const [w, h] of [
    [360, 800],
    [430, 932],
    [768, 1024],
  ]) {
    const v = planeView(w, h, 45, 10);
    const size = cssSizeFromView(v);
    near(size.w, w, 1e-6);
    near(size.h, h, 1e-6);
  }
});

test('clampDpr: 상한 아래면 그대로다', () => {
  near(clampDpr(1, 1.5), 1);
  near(clampDpr(1.2, 1.5), 1.2);
});

test('clampDpr: 상한을 넘으면 잘린다', () => {
  near(clampDpr(3, 1.5), 1.5);
  near(clampDpr(2.5, 2), 2);
});

test('clampDpr: 0 이나 NaN 이 오면 1 로 본다 (raw || 1)', () => {
  near(clampDpr(0, 1.5), 1);
});

test('pxToNdc: 디바이스 px 캔버스 크기가 클수록 같은 px 여유가 더 작은 NDC 폭이 된다', () => {
  const narrow = pxToNdc(360, 800, 1);
  const wide = pxToNdc(1200, 2000, 1);
  assert.ok(wide.x < narrow.x);
  assert.ok(wide.y < narrow.y);
});

test('pxToNdc: dpr 을 곱하지 않으면 dpr 배만큼 값이 커진다(과대 여유 방향)', () => {
  const cssW = 360;
  const cssH = 800;
  const dpr = 1.5;
  const withDpr = pxToNdc(cssW, cssH, dpr);
  const withoutDpr = pxToNdc(cssW, cssH, 1);
  near(withoutDpr.x, withDpr.x * dpr, 1e-9);
  near(withoutDpr.y, withDpr.y * dpr, 1e-9);
});

test('pxToNdc: NDC 폭 2를 디바이스 px 캔버스 크기로 나눈 값과 같다', () => {
  const cssW = 400;
  const cssH = 900;
  const dpr = 1.5;
  const r = pxToNdc(cssW, cssH, dpr);
  near(r.x, 2 / (cssW * dpr));
  near(r.y, 2 / (cssH * dpr));
});

test('pxToNdc: 점 반지름(px) 에 곱하면 그 반지름의 NDC 폭이 나온다 -- 좁은 화면(287px 근방)에서도 정확하다', () => {
  // 리뷰에서 지적된 손익분기점: 고정 여유(0.03 NDC)가 반지름을 못 덮기 시작하는
  // CSS 폭이 ~287px 였다. 여기서는 그 폭에서 실제 점 반지름(예: 4.3px, dpr=1)을
  // 정확히 NDC 로 바꿀 수 있어야 한다 -- 상수가 아니라 그 화면에 맞는 값이 나온다.
  const cssW = 287;
  const cssH = 620;
  const dpr = 1;
  const pointRadiusPx = 4.3;
  const r = pxToNdc(cssW, cssH, dpr);
  const marginNdc = pointRadiusPx * r.x;
  // 고정 상수 0.03 이 이 폭에서 반지름을 겨우 못 덮었던 것과 달리, 유도된 값은
  // 화면 폭에 상관없이 반지름을 정확히 덮는다(같은 반지름 px 를 그 화면의 실제
  // NDC 배율로 바꾸므로).
  near(marginNdc, (pointRadiusPx * 2) / (cssW * dpr));
  assert.ok(marginNdc > 0);
});
