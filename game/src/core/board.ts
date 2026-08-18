// 보드 생성 · 중력 · 리필 · 셔플.

import type { Board, Cell, Color, LevelDef, Tile } from './types.ts';
import { idx, isMovable, isSolid } from './types.ts';
import { findRuns, hasPossibleMove } from './match.ts';
import type { Rng } from './rng.ts';

type CellSpec = Pick<Cell, 'hole' | 'blocker' | 'blockerHp' | 'passage'>;

const LAYOUT_MAP: Record<string, CellSpec> = {
  '.': { hole: false, blocker: 'none', blockerHp: 0, passage: false },
  '#': { hole: true, blocker: 'none', blockerHp: 0, passage: false },
  r: { hole: false, blocker: 'rock', blockerHp: 1, passage: false },
  R: { hole: false, blocker: 'rock', blockerHp: 2, passage: false },
  i: { hole: false, blocker: 'ice', blockerHp: 1, passage: false },
  I: { hole: false, blocker: 'ice', blockerHp: 2, passage: false },
  n: { hole: false, blocker: 'net', blockerHp: 1, passage: false },
  // 잔해 — 부수면 통로가 된다
  x: { hole: false, blocker: 'rubble', blockerHp: 2, passage: false },
  X: { hole: false, blocker: 'rubble', blockerHp: 3, passage: false },
  // 처음부터 열려 있는 통로
  S: { hole: false, blocker: 'none', blockerHp: 0, passage: true },
  E: { hole: false, blocker: 'none', blockerHp: 0, passage: true },
  o: { hole: false, blocker: 'none', blockerHp: 0, passage: true },
};

export function makeTile(color: Color): Tile {
  return { color, special: 'none' };
}

/** 레이아웃 문자열을 빈 보드로 바꾼다 (타일은 아직 없음). */
export function emptyBoard(level: LevelDef): Board {
  const cells: Cell[] = [];
  let start = -1;
  let exit = -1;
  for (let y = 0; y < level.h; y++) {
    const row = level.layout?.[y];
    for (let x = 0; x < level.w; x++) {
      const ch = row?.[x] ?? '.';
      const spec = LAYOUT_MAP[ch] ?? LAYOUT_MAP['.'];
      if (ch === 'S') start = cells.length;
      if (ch === 'E') exit = cells.length;
      cells.push({
        hole: spec.hole,
        tile: null,
        blocker: spec.blocker,
        blockerHp: spec.blockerHp,
        passage: spec.passage,
      });
    }
  }
  return {
    w: level.w,
    h: level.h,
    cells,
    colors: Math.max(2, Math.min(6, level.colors)),
    start,
    exit,
  };
}

/**
 * 시작 칸에서 탈출구까지 통로가 이어졌는지 본다.
 * 이어졌으면 실제 경로(칸 인덱스 순서)를, 아니면 null 을 준다.
 */
export function findEscapePath(b: Board): number[] | null {
  if (b.start < 0 || b.exit < 0) return null;
  if (!b.cells[b.start].passage || !b.cells[b.exit].passage) return null;

  const prev = new Map<number, number>();
  const seen = new Set<number>([b.start]);
  const queue = [b.start];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === b.exit) {
      const path: number[] = [];
      for (let n: number | undefined = cur; n !== undefined; n = prev.get(n)) path.push(n);
      return path.reverse();
    }
    const x = cur % b.w;
    const y = Math.floor(cur / b.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
      const n = ny * b.w + nx;
      if (seen.has(n) || !b.cells[n].passage) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  return null;
}

/** 아직 안 뚫린 잔해 칸 수 */
export function countRubble(b: Board): number {
  return b.cells.filter((c) => c.blocker === 'rubble').length;
}

/**
 * 시작 보드를 만든다.
 * - 시작하자마자 터지는 매치가 없도록 채운다.
 * - 움직일 수 있는 수가 하나도 없으면 다시 섞는다.
 */
export function createBoard(level: LevelDef, rng: Rng): Board {
  const b = emptyBoard(level);
  for (let attempt = 0; attempt < 50; attempt++) {
    for (let i = 0; i < b.cells.length; i++) {
      const cell = b.cells[i];
      if (isSolid(cell)) {
        cell.tile = null;
        continue;
      }
      cell.tile = makeTile(pickSafeColor(b, i, rng));
    }
    if (findRuns(b).length === 0 && hasPossibleMove(b)) return b;
  }
  return b;
}

/** 즉시 매치가 되지 않는 색을 고른다. */
function pickSafeColor(b: Board, i: number, rng: Rng): Color {
  const x = i % b.w;
  const y = Math.floor(i / b.w);
  const banned = new Set<Color>();

  const colorAt = (cx: number, cy: number): Color | null => {
    if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h) return null;
    const c = b.cells[idx(b, cx, cy)];
    if (isSolid(c) || !c.tile) return null;
    return c.tile.color;
  };

  const left1 = colorAt(x - 1, y);
  const left2 = colorAt(x - 2, y);
  if (left1 !== null && left1 === left2) banned.add(left1);
  const up1 = colorAt(x, y - 1);
  const up2 = colorAt(x, y - 2);
  if (up1 !== null && up1 === up2) banned.add(up1);

  const options: Color[] = [];
  for (let c = 0; c < b.colors; c++) {
    if (!banned.has(c as Color)) options.push(c as Color);
  }
  if (options.length === 0) return rng.int(b.colors) as Color;
  return rng.pick(options);
}

/**
 * 움직일 수 있는 수가 없을 때 타일을 다시 섞는다.
 * 특수 타일과 장애물은 그대로 두고 색만 재배치한다.
 */
export function shuffleBoard(b: Board, rng: Rng): boolean {
  const movable: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    // 잠수부와 어망에 묶인 타일은 자리를 지킨다
    if (isMovable(b.cells[i])) movable.push(i);
  }
  if (movable.length < 3) return false;

  for (let attempt = 0; attempt < 60; attempt++) {
    const tiles = movable.map((i) => b.cells[i].tile!);
    for (let k = tiles.length - 1; k > 0; k--) {
      const r = rng.int(k + 1);
      const t = tiles[k];
      tiles[k] = tiles[r];
      tiles[r] = t;
    }
    movable.forEach((i, n) => {
      b.cells[i].tile = tiles[n];
    });
    if (findRuns(b).length === 0 && hasPossibleMove(b)) return true;
  }
  return hasPossibleMove(b);
}

export function cloneBoard(b: Board): Board {
  return {
    w: b.w,
    h: b.h,
    colors: b.colors,
    start: b.start,
    exit: b.exit,
    cells: b.cells.map((c) => ({
      hole: c.hole,
      blocker: c.blocker,
      blockerHp: c.blockerHp,
      passage: c.passage,
      tile: c.tile ? { color: c.tile.color, special: c.tile.special } : null,
    })),
  };
}

/** 보드에 남아있는 장애물 개수 */
export function countBlockers(b: Board): {
  rock: number;
  ice: number;
  net: number;
} {
  const out = { rock: 0, ice: 0, net: 0 };
  for (const c of b.cells) {
    if (c.blocker === 'rock') out.rock++;
    else if (c.blocker === 'ice') out.ice++;
    else if (c.blocker === 'net') out.net++;
  }
  return out;
}
