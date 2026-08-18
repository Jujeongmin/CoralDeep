// 잠수부 리그 확인용 개발 하네스. 빌드 대상이 아니다 (vite 는 index.html 만 엔트리로 잡는다).
// 여러 시점의 포즈를 한 줄로 늘어놓아 애니메이션이 사람처럼 움직이는지 눈으로 본다.

import { DIVER_SPAN, drawDiver } from './src/render/diverRig.ts';
import { drawPart, preloadSprites, spritesReady } from './src/sprites.ts';
import { TILE_ART, type TileArt, bakedTile, preloadTiles } from './src/tiles.ts';
import { LevelScene, type SceneVariant } from './src/render/levelScene.ts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
preloadSprites();
preloadTiles();

function frame(): void {
  if (!spritesReady()) {
    setTimeout(frame, 50);
    return;
  }
  // 실제 배경(어두운 심해) 위에서 봐야 대비를 제대로 판단할 수 있다
  ctx.fillStyle = '#0a1c26';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = 300 / DIVER_SPAN;
  const panics = [0.2, 0.6, 1.0, 1.0, 1.0, 1.0];
  for (let n = 0; n < 6; n++) {
    drawDiver(ctx, {
      x: 80 + n * 160,
      y: 130,
      scale,
      time: n * 0.16,
      panic: panics[n],
    });
  }
  // 타일 6종 — 실제 게임 크기(작게)와 확대를 나란히 놓고 실루엣 구분을 본다
  TILE_ART.forEach((name, n) => {
    const big = bakedTile(name, 96);
    const small = bakedTile(name, 40);
    if (big) ctx.drawImage(big, 20 + n * 104, 250);
    if (small) ctx.drawImage(small, 44 + n * 104, 352);
  });

  // 사진 질감을 입힌 바위 계열도 같이 확인한다
  const arts: TileArt[] = ['rock1', 'rock2', 'boulder1', 'boulder2', 'boulder3', 'boulder4'];
  let missing = false;
  arts.forEach((name, n) => {
    const tile = bakedTile(name, 120);
    if (!tile) {
      missing = true;
      return;
    }
    ctx.drawImage(tile, 20 + n * 110, 430);
  });
  if (missing) {
    setTimeout(frame, 80);
    return;
  }

  // 곰치 머리/아래턱을 크게 확인한다 (관절 기준점에 십자 표시)
  const eelScale = 1.4;
  for (const [n, name] of (['eelHead', 'eelJaw'] as const).entries()) {
    const px = 700 + n * 20;
    const py = 460 + n * 60;
    drawPart(ctx, name, { x: px, y: py, scale: eelScale });
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 10, py);
    ctx.lineTo(px + 10, py);
    ctx.moveTo(px, py - 10);
    ctx.lineTo(px, py + 10);
    ctx.stroke();
  }

  // 포식자가 다가오는 정도를 나란히 놓고 본다.
  //
  // 한 장면만 보면 "지금 가까운 건가?"를 알 수 없다. 위험도 0 / 0.5 / 1 을 같은
  // 크기로 늘어놓아야 **간격이 실제로 줄어드는지**가 눈에 들어온다.
  // 마지막 칸은 물린 순간 — 잠수부가 입 안에 들어갔는지 본다.
  //
  // 줄마다 수심이 다르다. 물빛·부유물·포식자가 층마다 갈리는지 한 화면에서 비교한다.
  // 세 칸만 둔다. 네 칸이면 가로로 넘쳐서 물린 순간을 보려고 스크롤해야 하는데,
  // 그 한 칸이 제일 확인이 필요한 칸이다.
  const steps: { danger: number; devour?: number; label: string }[] = [
    { danger: 0, label: 'danger 0' },
    { danger: 1, label: 'danger 1' },
    { danger: 1, devour: 0.72, label: 'devour 0.72' },
  ];
  const bands: { depth: number; label: string }[] = [
    { depth: 0, label: '12m 곰치' },
    { depth: 0.5, label: '~110m 아귀' },
    { depth: 1, label: '640m 촉수' },
  ];
  bands.forEach((band, row) => {
    const py = 560 + row * 242;
    steps.forEach((step, n) => {
      const scene = new LevelScene('rescue', band.depth);
      scene.update({ danger: step.danger, progress: 0.2, rescued: 0, total: 1 });
      // 보간이 목표값에 닿도록 충분히 돌린다
      for (let i = 0; i < 40; i++) scene.step(0.1);
      if (step.devour !== undefined) {
        scene.devour();
        // devourT 는 dt * 1.4 로 오르므로 원하는 값까지 돌린다
        for (let i = 0; i < 60 && scene.devourProgress() < step.devour; i++) scene.step(0.02);
      }
      const px = 20 + n * 262;
      scene.paintBackdrop(ctx, px, py, 248, 210);
      scene.paintDiver(ctx, px, py, 248, 210);
      ctx.fillStyle = '#789';
      ctx.font = '12px monospace';
      ctx.fillText(n === 0 ? `${band.label} · ${step.label}` : step.label, px + 4, py + 226);
    });
  });

  (window as unknown as { rigReady: boolean }).rigReady = true;
}

frame();
