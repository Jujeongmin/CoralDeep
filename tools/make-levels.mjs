// 레벨 판 크기·모양 생성기.  실행: node tools/make-levels.mjs
//
// 7x7 짜리 판에 대각선 띠 모양이라 실제로 만질 수 있는 칸이 30개도 안 됐다.
// 한 수로 지울 수 있는 곳이 뻔해서 '고르는 재미'가 없다. 판을 9칸 폭으로 넓히고
// 구멍을 줄여 열린 칸을 두 배 이상으로 늘린다.
//
// 규칙 (core.test.ts 가 검사한다):
//   - S 는 맨 위 열린 행, E 는 맨 아래 열린 행
//   - 전부 파냈을 때 S→E 가 이어져야 한다
//   - 타일 칸이 열린 칸의 65% 를 넘어야 한다 (리필이 없어서 판이 마르면 안 된다)

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../game/src/levels.ts', import.meta.url);
const src = readFileSync(FILE, 'utf8');

/** 시드 난수 — 돌릴 때마다 같은 판이 나와야 한다 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 레벨 번호로 판 크기를 정한다. 폭은 9를 넘기지 않는다 — 넘기면 칸이 36px 밑으로 내려간다. */
function sizeFor(id) {
  if (id <= 5) return [8, 9];
  if (id <= 12) return [9, 10];
  return [9, 11];
}

/**
 * 자갈에 파인 구멍 모양.
 * 모서리를 둥글게 베어내고 가장자리에 홈을 몇 개 낸다. 속은 비우지 않는다 —
 * 가운데가 뚫려 있으면 판이 두 갈래로 갈려서 '고를 수 있는 수'가 오히려 줄어든다.
 */
function carve(w, h, rand) {
  const grid = Array.from({ length: h }, () => new Array(w).fill('.'));

  // 네 모서리를 원호로 베어낸다 (크기는 판마다 조금씩 다르게)
  for (const [cx, cy] of [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ]) {
    const r = 1.4 + rand() * 1.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.hypot(x - cx, y - cy) < r) grid[y][x] = '#';
      }
    }
  }

  // 좌우 가장자리 홈 — 실루엣이 밋밋해지지 않게
  const notches = 2 + Math.floor(rand() * 3);
  for (let n = 0; n < notches; n++) {
    const side = rand() < 0.5 ? 0 : w - 1;
    const y0 = 2 + Math.floor(rand() * (h - 4));
    const len = 1 + Math.floor(rand() * 2);
    const depth = 1 + Math.floor(rand() * 2);
    for (let y = y0; y < Math.min(h, y0 + len); y++) {
      for (let d = 0; d < depth; d++) {
        const x = side === 0 ? d : side - d;
        grid[y][x] = '#';
      }
    }
  }
  return grid;
}

const open = (ch) => ch !== '#';

/** 열린 칸이 한 덩어리인지 확인하고, 떨어져 나간 조각은 자갈로 메운다 */
function keepLargestRegion(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const seen = Array.from({ length: h }, () => new Array(w).fill(false));
  let best = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!open(grid[y][x]) || seen[y][x]) continue;
      const region = [];
      const queue = [[y, x]];
      seen[y][x] = true;
      for (let qi = 0; qi < queue.length; qi++) {
        const [cy, cx] = queue[qi];
        region.push([cy, cx]);
        for (const [dy, dx] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const ny = cy + dy;
          const nx = cx + dx;
          if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
          if (!open(grid[ny][nx]) || seen[ny][nx]) continue;
          seen[ny][nx] = true;
          queue.push([ny, nx]);
        }
      }
      if (region.length > best.length) best = region;
    }
  }
  const keep = new Set(best.map(([y, x]) => `${y},${x}`));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (open(grid[y][x]) && !keep.has(`${y},${x}`)) grid[y][x] = '#';
    }
  }
  return best.length;
}

/** 열린 칸에서의 BFS 거리 */
function distances(grid, sy, sx) {
  const h = grid.length;
  const w = grid[0].length;
  const dist = Array.from({ length: h }, () => new Array(w).fill(-1));
  dist[sy][sx] = 0;
  const queue = [[sy, sx]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [y, x] = queue[qi];
    for (const [dy, dx] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const ny = y + dy;
      const nx = x + dx;
      if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
      if (!open(grid[ny][nx]) || dist[ny][nx] >= 0) continue;
      dist[ny][nx] = dist[y][x] + 1;
      queue.push([ny, nx]);
    }
  }
  return dist;
}

/**
 * 장애물.
 *
 * 산호암(r/R)·잔해(x)는 타일이 없는 칸이라 너무 많으면 파낼 게 모자란다.
 * 결빙(i/I)·어망(n)은 타일 위에 덮이는 층이라 타일 수를 줄이지 않는다.
 */
function addBlockers(grid, id, rand) {
  const h = grid.length;
  const w = grid[0].length;
  const spots = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (open(grid[y][x])) spots.push([y, x]);
    }
  }
  // 무겁게 배치할수록 판이 마른다. 열린 칸의 20% 를 넘기지 않는다.
  const tierless = Math.max(0, Math.min(spots.length * 0.2, (id - 3) * 0.9));
  const picks = Math.floor(tierless);
  for (let n = 0; n < picks; n++) {
    const [y, x] = spots[Math.floor(rand() * spots.length)];
    if (grid[y][x] !== '.') continue;
    const roll = rand();
    if (id >= 12 && roll < 0.18) grid[y][x] = 'x';
    else if (id >= 5 && roll < 0.42) grid[y][x] = id >= 14 && rand() < 0.35 ? 'R' : 'r';
    else if (id >= 6 && roll < 0.74) grid[y][x] = id >= 16 && rand() < 0.35 ? 'I' : 'i';
    else if (id >= 9) grid[y][x] = 'n';
  }
}

/** S 는 맨 위, E 는 맨 아래 (장면의 잠수부가 내려오는 방향) */
function placeEnds(grid) {
  const h = grid.length;
  const w = grid[0].length;
  let sy = -1;
  for (let y = 0; y < h && sy < 0; y++) if (grid[y].some(open)) sy = y;
  const wantX = Math.round((w - 1) * 0.42);
  let sx = -1;
  for (let x = 0; x < w; x++) {
    if (!open(grid[sy][x])) continue;
    if (sx < 0 || Math.abs(x - wantX) < Math.abs(sx - wantX)) sx = x;
  }
  const dist = distances(grid, sy, sx);
  let ey = -1;
  for (let y = h - 1; y >= 0 && ey < 0; y--) if (grid[y].some(open)) ey = y;
  let ex = -1;
  let best = -1;
  for (let x = 0; x < w; x++) {
    if (!open(grid[ey][x]) || dist[ey][x] < 0) continue;
    if (dist[ey][x] > best) {
      best = dist[ey][x];
      ex = x;
    }
  }
  grid[sy][sx] = 'S';
  grid[ey][ex] = 'E';
  return best;
}

function buildLevel(id) {
  const [w, h] = sizeFor(id);
  const rand = rng(id * 7919 + 13);
  let grid;
  let openCount = 0;
  // 너무 많이 베어냈으면 다시 뽑는다
  for (let tries = 0; tries < 40; tries++) {
    grid = carve(w, h, rand);
    openCount = keepLargestRegion(grid);
    if (openCount >= w * h * 0.76) break;
  }
  addBlockers(grid, id, rand);
  const pathLen = placeEnds(grid);
  return { w, h, rows: grid.map((r) => r.join('')), openCount, pathLen };
}

// ---------- levels.ts 갱신 ----------

let count = 0;
// 이동 수는 기존 값에서 키우지 않고 **열린 칸 수에서 새로 계산한다**.
// 기존 값을 곱하면 스크립트를 두 번 돌릴 때마다 값이 불어난다.
let prevMoves = 0;
const out = src.replace(
  /(\{\s*\n\s*id: (\d+),\s*\n\s*)w: \d+, h: \d+, moves: \d+, colors: (\d+), oxygen: \d+,([\s\S]*?)layout: \[\n([\s\S]*?)\n(\s*)\],/g,
  (whole, head, idStr, colorsStr, mid, body, indent) => {
    const id = Number(idStr);
    const level = buildLevel(id);
    const lineIndent = body.match(/^(\s*)/)[1];

    // 파낼 칸이 많을수록 수가 더 필요하다. 뒤 레벨이 앞보다 적어지지 않게 눌러둔다.
    let moves = Math.max(20, Math.min(60, Math.round(level.openCount * 0.6)));
    moves = Math.max(moves, prevMoves);
    prevMoves = moves;
    // 산소가 이동 수보다 빡빡해야 '빨리 뚫어야 한다'는 압박이 생긴다
    const oxygen = Math.round(moves * 0.72);

    count++;
    return (
      `${head}w: ${level.w}, h: ${level.h}, moves: ${moves}, colors: ${colorsStr}, oxygen: ${oxygen},${mid}` +
      `layout: [\n${level.rows.map((r) => `${lineIndent}'${r}',`).join('\n')}\n${indent}],`
    );
  },
);

writeFileSync(FILE, out);
console.log(`rewrote ${count} levels`);
