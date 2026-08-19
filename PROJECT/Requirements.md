# Requirements — Coral Deep

## 성능

- 중급 폰 60fps. 드로우콜 30 이하, 삼각형 40k 이하.
- 그림자 없음, 포스트프로세싱 없음.
- 3D 캔버스 dpr 상한 1.5. 2D 보드 캔버스는 2 유지.
- WebGL 을 못 따면 CSS 그라디언트 배경만 남기고 보드는 정상 동작한다.
- 프레임이 길어지면 품질 티어가 부유물 -> 광선 -> 해상도 순으로 덜어낸다.

## 플랫폼

- 모바일 세로 웹뷰. 데스크톱은 대상이 아니다.
- Verse8 배포. 광고는 `@verse8/ads` 를 쓴다.

## 검증

`npm run typecheck`, `npm test`, `npm run build` 가 모두 통과해야 한다.
