import { defineConfig } from 'vite';

// Verse8(Agent8)는 Vite 프로젝트를 그대로 빌드/배포한다.
// index.html 과 소스는 game/ 안에 두고 Vite root 를 game 으로 지정한다.
export default defineConfig({
  root: 'game',

  // .env 는 프로젝트 루트에 있다. root 가 'game' 이라 기본 envDir(=root)로는
  // VITE_* 가 로드되지 않으므로 루트를 명시한다.
  envDir: __dirname,

  // Verse8 처럼 하위 경로에서 서빙될 때도 자산이 로드되도록 상대 경로 사용.
  base: './',

  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },

  server: {
    // 기본은 localhost 만. 다른 기기에서 열어야 할 때만 `npm run dev:lan`.
    host: 'localhost',
    port: Number(process.env.PORT) || 5173,
  },
});
