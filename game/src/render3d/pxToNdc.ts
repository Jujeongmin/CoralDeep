// CSS px 캔버스 크기 <-> 화면 NDC 배율 -- 순수 수학.
//
// particles.ts 의 Drift 는 점 하나의 반지름(디바이스 px, gl_PointSize)을 보드 구멍
// 판정의 여유로 쓴다. 그러려면 "디바이스 px 하나가 NDC 몇 폭인가"를 알아야 하는데,
// 이 계산은 Drift 클래스(= TS parameter property 생성자를 쓰는 렌더링 클래스)를 안
// 거치고도 검증할 수 있어야 한다 -- depthProjection.ts 가 seafloor.ts 에서 분리된
// 이유와 같다(그 파일 상단 주석 참고): npm test 가 쓰는 Node 내장 TypeScript
// strip-only 로더가 parameter property 문법(ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX)을
// 못 읽는다.

import type { PlaneView } from './projection.ts';

/**
 * PlaneView 에서 z=0 평면의 CSS px 캔버스 크기를 되짚는다.
 *
 * planeView() 는 pxPerWorld = screenH / worldH 로 이 값을 만들었다. worldW, worldH 에
 * 그 배율을 다시 곱하면 원래 넘겼던 screenW, screenH(CSS px) 로 돌아온다 -- 새 정보를
 * 더하는 게 아니라 이미 view 안에 있는 값을 되짚을 뿐이다.
 */
export function cssSizeFromView(view: PlaneView): { w: number; h: number } {
  return { w: view.worldW * view.pxPerWorld, h: view.worldH * view.pxPerWorld };
}

/** 실제 렌더링에 쓰는 dpr -- window.devicePixelRatio 를 상한(max)으로 자른다. */
export function clampDpr(raw: number, max: number): number {
  return Math.min(raw || 1, max);
}

/**
 * 디바이스 px(= CSS px * dpr) 하나가 NDC 몇 폭인지.
 *
 * gl_PointSize 는 WebGL 뷰포트 기준 디바이스 px 다(렌더러가 setPixelRatio(dpr) 로
 * 드로잉 버퍼를 CSS px 의 dpr 배로 키워 두기 때문이다). NDC 는 뷰포트 폭 전체가 2 이므로
 * "디바이스 px 하나가 NDC 몇 폭인가" = 2 / 디바이스px캔버스크기 다. CSS px 로만 나누면
 * (dpr 을 안 곱하면) dpr 배만큼 큰 값이 나와 여유가 필요 이상으로 커진다 -- 화면을
 * 침범하지는 않으니 그 자체로 위험하진 않지만, 이 프로젝트는 "안전한 쪽으로 어림"이
 * 아니라 depthProjection.ts 처럼 "정확한 값"을 요구한다.
 */
export function pxToNdc(cssW: number, cssH: number, dpr: number): { x: number; y: number } {
  const dW = Math.max(1e-6, cssW * dpr);
  const dH = Math.max(1e-6, cssH * dpr);
  return { x: 2 / dW, y: 2 / dH };
}
