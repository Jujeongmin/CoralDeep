# Status — Coral Deep

## Implemented

- match-3 코어(매치·낙하·연쇄·특수 타일)와 30 스테이지, 4개 언어
- 2D 보드 렌더러 (`game/src/render/boardView.ts`) — 단일 RAF 루프 소유
- three.js 3D 배경 (`game/src/render3d/`): 자갈 해저(칸 마스크로 뚫은 구멍),
  수면 광선, 마린 스노우, Idle 애니메이션을 구운 잠수부, 심해 포식자 3종
- 포식자는 Quaternius CC0 에셋(아귀·고블린상어·대왕오징어)을 정점색 glb 로 구워 쓴다
- 보상형 광고 12개 지면 (`adPolicy.ts` 가 일일 상한·쿨다운·`unsupported_env` 를 관리)
- three 는 레벨 진입 때만 동적으로 불러온다 — 진입 청크에 안 들어간다

## Installed but not wired

- `@agent8/gameserver` — 계정 단위 저장(스테이지 진행도·재화)이 아직 없다.
  지금 저장은 전부 localStorage 다.

## Not implemented

- 서버 검증 (`requestId` 를 `ads-verifier.verse8.io` 로 확인하는 흐름)
- 광고 제거 상품
