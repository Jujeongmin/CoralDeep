// createStage 의 WebGL 폴백이 실제로 실행되는지 검증.
//
// Node 테스트 환경엔 DOM 이 없어 진짜 <canvas> 를 만들 수 없다(HTMLCanvasElement 자체가
// 없다). 그래서 "getContext 를 스텁해서 강제로 실패시킨다"를 브라우저 콘솔이 아니라
// 여기서 하려면 판정 함수를 갈아끼울 수 있어야 한다 — index.ts 의 webglAvailable()/
// createStage() 는 그래서 probe/detect 를 인자로 받는다. 이 테스트는 코드를 읽고
// "될 것이다"라고 주장하는 게 아니라, 실패 경로를 실제로 실행시켜 null 이 나오는지
// 확인한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStage, webglAvailable } from './index.ts';

test('webglAvailable: getContext 가 항상 null 이면 false (구형 웹뷰 시나리오)', () => {
  const ok = webglAvailable(() => ({ getContext: () => null }));
  assert.equal(ok, false);
});

test('webglAvailable: webgl2 나 webgl 중 하나라도 컨텍스트를 주면 true', () => {
  const ok = webglAvailable(() => ({ getContext: (id: string) => (id === 'webgl' ? {} : null) }));
  assert.equal(ok, true);
});

test('webglAvailable: canvas 를 만들다 예외가 나도(일부 웹뷰) 밖으로 새지 않고 false', () => {
  const ok = webglAvailable(() => {
    throw new Error('canvas 생성 실패');
  });
  assert.equal(ok, false);
});

test('createStage: WebGL 판정이 실패하면 null 을 준다 — stage.ts 동적 import 는 건드리지 않는다', async () => {
  // 판정 함수 자체가 false 를 강제한다. 여기서 stage.ts 를 실제로 import 하려 들면
  // (canvas 가 가짜라) WebGLRenderer 생성에서 예외가 나며 이 테스트가 오래 걸리거나
  // 실패했을 것이다 — 통과한다는 것 자체가 detect() 단계에서 진짜로 멈췄다는 증거다.
  const stage = await createStage({} as unknown as HTMLCanvasElement, 0, () => false);
  assert.equal(stage, null);
});

test('createStage: WebGL 판정이 성공해도 무대 생성이 던지면 null 로 흡수한다', async () => {
  // canvas 가 진짜가 아니므로 Stage3D 생성자(WebGLRenderer 초기화)가 던진다 —
  // 그 예외를 createStage 가 삼키고 null 을 주는지 확인한다(사고 대응 경로).
  const stage = await createStage({} as unknown as HTMLCanvasElement, 0, () => true);
  assert.equal(stage, null);
});
