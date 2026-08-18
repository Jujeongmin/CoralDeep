// z=0 평면 좌표 변환 테스트.  실행: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { planeView, pxToWorld, screenToPlane } from './projection.ts';

const near = (a: number, b: number, eps = 1e-9): void => {
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);
};

test('planeView: 평면 높이는 2 * tan(fov/2) * camZ', () => {
  const v = planeView(360, 800, 45, 10);
  near(v.worldH, 2 * Math.tan((45 * Math.PI) / 180 / 2) * 10);
  near(v.worldW, v.worldH * (360 / 800));
});

test('screenToPlane: 화면 중앙은 원점', () => {
  const v = planeView(360, 800, 45, 10);
  const p = screenToPlane(180, 400, 360, 800, v);
  near(p.x, 0);
  near(p.y, 0);
});

test('screenToPlane: 왼쪽 위 모서리는 (-worldW/2, +worldH/2)', () => {
  const v = planeView(360, 800, 45, 10);
  const p = screenToPlane(0, 0, 360, 800, v);
  near(p.x, -v.worldW / 2);
  near(p.y, v.worldH / 2);
});

test('screenToPlane: y 는 화면과 반대로 간다', () => {
  const v = planeView(360, 800, 45, 10);
  const top = screenToPlane(180, 100, 360, 800, v);
  const bottom = screenToPlane(180, 700, 360, 800, v);
  assert.ok(top.y > bottom.y);
});

test('pxToWorld: 화면 높이만큼의 px 는 평면 높이만큼의 월드', () => {
  const v = planeView(360, 800, 45, 10);
  near(pxToWorld(800, v), v.worldH);
});

test('pxToWorld: 0 은 0', () => {
  const v = planeView(360, 800, 45, 10);
  near(pxToWorld(0, v), 0);
});

test('화면 비율이 바뀌어도 중앙은 중앙이다', () => {
  for (const [w, h] of [
    [320, 640],
    [430, 932],
    [768, 1024],
  ]) {
    const v = planeView(w, h, 45, 12);
    const p = screenToPlane(w / 2, h / 2, w, h, v);
    near(p.x, 0);
    near(p.y, 0);
  }
});
