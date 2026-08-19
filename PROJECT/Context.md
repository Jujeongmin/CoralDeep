# Context — Coral Deep

## Project Overview

심해 잠수 테마의 match-3 퍼즐 게임. 모바일 세로 웹뷰 전용이고 Verse8 에 배포한다.
보드는 2D 캔버스지만 그 뒤 배경은 three.js 로 그린 실시간 3D 장면이다 — 자갈 해저,
수면 광선, 마린 스노우, 잠수부, 그리고 산소가 줄수록 다가오는 심해 포식자.

## Tech Stack

_정확한 버전은 `package.json` 에 있다._

- **Build / Lang**: Vite, TypeScript (프레임워크 없음 — DOM 을 직접 만진다)
- **3D**: three (core 만. `three/examples/...` 와 `GLTFLoader` 는 쓰지 않는다)
- **광고**: `@verse8/ads` (보상형 12개 지면)
- **테스트**: `node --test` 가 `.ts` 를 직접 읽는다

## Critical Memory

- **3D 오브젝트는 보드 사각형의 화면 영역을 침범하지 않는다.** 탈출 중인 잠수부만 예외다.
- **원근 계산은 `game/src/render3d/depthProjection.ts` 가 독점한다.** `z != 0` 인 물체는
  화면 중심 쪽으로 투영된다. 이 계산을 각자 다시 유도하다가 네 번 깨졌다.
- **런타임 이미지 에셋 0개.** 색은 정점색, 무늬는 셰이더 노이즈로 낸다.
- **렌더 루프는 하나다.** `BoardView` 가 소유하고 `Stage3D` 는 자기 RAF 를 돌리지 않는다.
- **소스 파일에 `\p{Extended_Pictographic}` 에 걸리는 문자를 넣지 않는다** —
  `game/src/core/core.test.ts` 가 저장소 전체를 훑어 실패시킨다.
- Node 의 strip-only TS 로더는 parameter property(`constructor(private x: T)`)를 못 읽는다.
  테스트가 import 해야 하는 계산은 leaf 모듈로 뺀다.
