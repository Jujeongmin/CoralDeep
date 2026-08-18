// 매치 탐색 + 특수 타일 생성 규칙.

import type { Board, Color, Special } from './types.ts';
import { idx, isMovable, isSolid, xOf, yOf } from './types.ts';

export interface Run {
  cells: number[];
  color: Color;
  horizontal: boolean;
}

export interface MatchGroup {
  /** 이 그룹에 속한 모든 칸 (중복 없음) */
  cells: number[];
  color: Color;
  /** 이 그룹이 만들어내는 특수 타일 ('none' 이면 생성 없음) */
  special: Special;
  /** 특수 타일이 놓일 자리 */
  anchor: number;
  runs: Run[];
}

/** 같은 색 3연속 이상인 가로/세로 줄을 전부 찾는다. */
export function findRuns(b: Board): Run[] {
  const runs: Run[] = [];

  const colorAt = (x: number, y: number): Color | null => {
    const cell = b.cells[idx(b, x, y)];
    if (isSolid(cell) || !cell.tile) return null;
    return cell.tile.color;
  };

  // 가로
  for (let y = 0; y < b.h; y++) {
    let start = 0;
    while (start < b.w) {
      const c = colorAt(start, y);
      if (c === null) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < b.w && colorAt(end, y) === c) end++;
      if (end - start >= 3) {
        const cells: number[] = [];
        for (let x = start; x < end; x++) cells.push(idx(b, x, y));
        runs.push({ cells, color: c, horizontal: true });
      }
      start = end;
    }
  }

  // 세로
  for (let x = 0; x < b.w; x++) {
    let start = 0;
    while (start < b.h) {
      const c = colorAt(x, start);
      if (c === null) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < b.h && colorAt(x, end) === c) end++;
      if (end - start >= 3) {
        const cells: number[] = [];
        for (let y = start; y < end; y++) cells.push(idx(b, x, y));
        runs.push({ cells, color: c, horizontal: false });
      }
      start = end;
    }
  }

  return runs;
}

/**
 * 겹치는 줄끼리 묶어서 그룹으로 만들고, 그룹별 특수 타일 생성 규칙을 결정한다.
 *
 * 규칙 (우선순위 높은 순):
 *  - 5연속 이상 한 줄  -> voidPearl (심연의 진주)
 *  - 가로줄 + 세로줄 교차(L/T) -> mine (기뢰)
 *  - 4연속 한 줄        -> 가로 4연속은 currentH, 세로 4연속은 currentV
 *
 * @param preferAnchor 스왑으로 만들어진 매치라면 스왑한 칸. 그 칸이 그룹에 있으면 거기에 특수 타일이 생긴다.
 */
export function findMatches(b: Board, preferAnchor: number[] = []): MatchGroup[] {
  const runs = findRuns(b);
  if (runs.length === 0) return [];

  // 셀 -> 그 셀을 포함하는 run 인덱스 목록
  const cellToRuns = new Map<number, number[]>();
  runs.forEach((run, ri) => {
    for (const c of run.cells) {
      const list = cellToRuns.get(c);
      if (list) list.push(ri);
      else cellToRuns.set(c, [ri]);
    }
  });

  // run 들을 연결 요소로 묶는다 (셀을 공유하면 같은 그룹)
  const runGroup = new Array<number>(runs.length).fill(-1);
  const groups: number[][] = [];
  for (let ri = 0; ri < runs.length; ri++) {
    if (runGroup[ri] !== -1) continue;
    const gi = groups.length;
    const stack = [ri];
    const members: number[] = [];
    runGroup[ri] = gi;
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const c of runs[cur].cells) {
        for (const other of cellToRuns.get(c)!) {
          if (runGroup[other] === -1) {
            runGroup[other] = gi;
            stack.push(other);
          }
        }
      }
    }
    groups.push(members);
  }

  const result: MatchGroup[] = [];
  for (const members of groups) {
    const memberRuns = members.map((ri) => runs[ri]);
    const cells = [...new Set(memberRuns.flatMap((r) => r.cells))];
    const color = memberRuns[0].color;

    const longest = Math.max(...memberRuns.map((r) => r.cells.length));
    const hasH = memberRuns.some((r) => r.horizontal && r.cells.length >= 3);
    const hasV = memberRuns.some((r) => !r.horizontal && r.cells.length >= 3);

    let special: Special = 'none';
    if (longest >= 5) special = 'voidPearl';
    else if (hasH && hasV) special = 'mine';
    else if (longest === 4) {
      const four = memberRuns.find((r) => r.cells.length === 4)!;
      special = four.horizontal ? 'currentH' : 'currentV';
    }

    result.push({
      cells,
      color,
      special,
      anchor: pickAnchor(cells, memberRuns, special, preferAnchor),
      runs: memberRuns,
    });
  }

  return result;
}

function pickAnchor(
  cells: number[],
  memberRuns: Run[],
  special: Special,
  preferAnchor: number[],
): number {
  if (special === 'none') return cells[0];

  // 플레이어가 직접 움직인 칸을 최우선으로 (게임 느낌이 훨씬 좋다)
  for (const p of preferAnchor) {
    if (cells.includes(p)) return p;
  }

  // L/T 자는 교차점에 만든다
  if (special === 'mine') {
    const counts = new Map<number, number>();
    for (const r of memberRuns) {
      for (const c of r.cells) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const [cell, n] of counts) {
      if (n >= 2) return cell;
    }
  }

  // 가장 긴 줄의 가운데
  const longest = memberRuns.reduce((a, r) => (r.cells.length > a.cells.length ? r : a));
  return longest.cells[Math.floor(longest.cells.length / 2)];
}

/** 이 보드에 성립 가능한 스왑이 하나라도 있는가 */
export function hasPossibleMove(b: Board): boolean {
  return findFirstHint(b) !== null;
}

/** 성립하는 스왑 한 쌍을 찾아 돌려준다 (힌트 표시에 사용). 없으면 null */
export function findFirstHint(b: Board): [number, number] | null {
  const { w, h } = b;

  // 심연의 진주는 어느 방향으로든 스왑 가능
  for (let i = 0; i < b.cells.length; i++) {
    const cell = b.cells[i];
    if (!cell.tile || cell.tile.special !== 'voidPearl') continue;
    if (!isMovable(cell)) continue;
    const x = xOf(b, i);
    const y = yOf(b, i);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isMovable(b.cells[idx(b, nx, ny)])) return [i, idx(b, nx, ny)];
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(b, x, y);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= w || ny >= h) continue;
        const j = idx(b, nx, ny);
        const a = b.cells[i];
        const c = b.cells[j];
        if (!isMovable(a) || !isMovable(c)) continue;
        // 두 특수 타일 스왑은 항상 성립
        if (a.tile!.special !== 'none' && c.tile!.special !== 'none') return [i, j];

        const t = a.tile;
        a.tile = c.tile;
        c.tile = t;
        const ok = findRuns(b).length > 0;
        const t2 = a.tile;
        a.tile = c.tile;
        c.tile = t2;
        if (ok) return [i, j];
      }
    }
  }
  return null;
}
