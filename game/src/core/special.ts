// 제거(폭발) 처리. 특수 타일 연쇄 발동과 장애물 피해를 한 번에 계산한다.

import type { Board, ClearPhase, Color, Special } from './types.ts';
import { emptyCollected, idx, xOf, yOf } from './types.ts';

interface Seed {
  index: number;
  /** 이 칸의 실제 special 대신 강제로 발동시킬 종류 (콤보용) */
  forceSpecial?: Special;
  /** voidPearl 이 노릴 색 */
  forceColor?: Color;
}

const SCORE_TILE = 20;
const SCORE_SPECIAL_TRIGGER = 60;
const SCORE_BLOCKER = 40;

/**
 * seeds 로 지정한 칸들을 제거하고, 그 과정에서 발동한 특수 타일의 연쇄까지 모두 처리한다.
 * 보드를 직접 변경하고 ClearPhase 를 돌려준다.
 *
 * @param spare 특수 타일이 새로 생길 자리. 제거 대상에서 제외한다.
 */
export function detonate(b: Board, seeds: Seed[], spare: Set<number> = new Set()): ClearPhase {
  const clearedTiles: number[] = [];
  const clearedSet = new Set<number>();
  const triggered: { index: number; special: Special }[] = [];
  const blockers: ClearPhase['blockers'] = [];
  const collected = emptyCollected();
  const directlyHit = new Set<number>();

  const queue: Seed[] = [...seeds];

  const damageBlocker = (i: number): void => {
    const cell = b.cells[i];
    if (cell.blocker === 'none') return;
    const before = cell.blockerHp;
    cell.blockerHp -= 1;
    const kind = cell.blocker;
    const destroyed = cell.blockerHp <= 0;
    if (destroyed) {
      cell.blocker = 'none';
      cell.blockerHp = 0;
      // 타일이 없는 장애물(산호암·잔해)을 치운 자리도 그대로 물이 찬다.
      // 결빙·어망은 아래에 타일이 남아 있으므로 그 타일이 지워질 때 물이 된다.
      if (kind !== 'ice' && kind !== 'net') cell.passage = true;
    }
    blockers.push({ index: i, blocker: kind, hpBefore: before, hpAfter: cell.blockerHp });

    // 목표는 "장애물 N개 제거"다. 여러 겹짜리는 완전히 부순 순간에만 센다.
    if (!destroyed) return;
    if (kind === 'rock') collected.rock += 1;
    else if (kind === 'ice') collected.ice += 1;
    else if (kind === 'net') collected.net += 1;
    else if (kind === 'rubble') collected.rubble += 1;
  };

  /**
   * 폭발이 장애물 칸을 직접 덮은 경우. 한 판정에 한 번만 센다 —
   * 해류와 기뢰가 같은 칸을 겹쳐 덮었다고 두 배로 부서질 이유는 없다.
   */
  const damageDirect = (i: number): void => {
    if (directlyHit.has(i)) return;
    directlyHit.add(i);
    damageBlocker(i);
  };

  while (queue.length > 0) {
    const seed = queue.shift()!;
    const i = seed.index;
    if (i < 0 || i >= b.cells.length) continue;
    const cell = b.cells[i];
    if (cell.hole) continue;
    if (spare.has(i)) continue;

    // 산호암 / 잔해: 타일이 없다. 맞으면 내구도만 깎인다.
    if (cell.blocker === 'rock' || cell.blocker === 'rubble') {
      damageDirect(i);
      continue;
    }

    // 어망·결빙: 타일을 덮고 있다. 제거 판정을 한 겹씩 흡수하고 타일은 살아남는다.
    //
    // 결빙이 어망과 같은 방식인 건 리필이 없는 판이라서다. 예전처럼 '타일이 사라질 때
    // 한 겹 벗겨진다'로 두면, 그 순간 칸이 통로가 되어 새 타일이 안 내려오고 남은
    // 겹을 때릴 수단이 영영 사라진다. 2겹 결빙은 그래서 전부 영구히 남아 있었다.
    // 흡수식이면 겹 수가 곧 '그 칸을 뚫는 데 드는 매치 수'가 된다.
    if (cell.blocker === 'net' || cell.blocker === 'ice') {
      damageDirect(i);
      continue;
    }

    if (!cell.tile || clearedSet.has(i)) continue;

    const tile = cell.tile;
    const special = seed.forceSpecial ?? tile.special;
    collected.colors[tile.color] = (collected.colors[tile.color] ?? 0) + 1;
    clearedSet.add(i);
    clearedTiles.push(i);
    cell.tile = null;
    // 지운 자리는 물이 찬다. 새 타일이 내려오지 않고 영구히 통로로 남는다.
    cell.passage = true;

    if (special !== 'none') {
      triggered.push({ index: i, special });
      for (const next of blastCells(b, i, special, seed.forceColor ?? tile.color)) {
        if (!clearedSet.has(next)) queue.push({ index: next });
      }
    }
  }

  // 매치로 사라진 타일 주변의 산호암·잔해는 인접 피해를 받는다.
  //
  // **사라진 타일 하나당 1 씩**이다. 예전엔 한 판정에 장애물당 한 번만 깎았는데,
  // 리필이 없는 판에서 그건 소프트락을 만든다: 기뢰 한 방이 2겹 잔해의 인접 타일을
  // 한꺼번에 지우면 피해는 1 만 들어가고 그 칸들은 영구 통로가 되어, 남은 한 겹을
  // 때릴 타일이 세상에서 사라진다. 물길이 영영 안 이어지는데 판은 계속 굴러간다.
  // 인접 제거 수만큼 깎으면 '들어간 피해 = 소모한 인접 타일'이라 그 상태가 안 생긴다.
  for (const i of clearedTiles) {
    const x = xOf(b, i);
    const y = yOf(b, i);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
      const n = idx(b, nx, ny);
      const blocker = b.cells[n].blocker;
      if (blocker === 'rock' || blocker === 'rubble') damageBlocker(n);
    }
  }

  const score =
    clearedTiles.length * SCORE_TILE +
    triggered.length * SCORE_SPECIAL_TRIGGER +
    blockers.length * SCORE_BLOCKER;

  return {
    kind: 'clear',
    tiles: clearedTiles,
    triggered,
    created: [],
    blockers,
    collected,
    score,
  };
}

/** 특수 타일 하나가 영향을 주는 칸 목록 */
function blastCells(b: Board, i: number, special: Special, color: Color): number[] {
  const out: number[] = [];
  const x = xOf(b, i);
  const y = yOf(b, i);

  switch (special) {
    case 'currentH':
      for (let nx = 0; nx < b.w; nx++) if (nx !== x) out.push(idx(b, nx, y));
      break;
    case 'currentV':
      for (let ny = 0; ny < b.h; ny++) if (ny !== y) out.push(idx(b, x, ny));
      break;
    case 'mine':
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
          const n = idx(b, nx, ny);
          if (n !== i) out.push(n);
        }
      }
      break;
    case 'voidPearl':
      for (let n = 0; n < b.cells.length; n++) {
        const c = b.cells[n];
        if (n !== i && c.tile && c.tile.color === color) out.push(n);
      }
      break;
    case 'none':
      break;
  }
  return out;
}

export interface ComboPlan {
  seeds: Seed[];
}

/**
 * 두 특수 타일을 맞바꿨을 때의 콤보를 계산한다.
 * 콤보 대상이 아니면 null.
 */
export function planCombo(b: Board, i: number, j: number): ComboPlan | null {
  const a = b.cells[i].tile;
  const c = b.cells[j].tile;
  if (!a || !c) return null;

  const sa = a.special;
  const sc = c.special;
  if (sa === 'none' && sc === 'none') return null;

  const isCurrent = (s: Special) => s === 'currentH' || s === 'currentV';

  // 진주 + 진주 → 보드 전체
  if (sa === 'voidPearl' && sc === 'voidPearl') {
    return { seeds: b.cells.map((_, n) => ({ index: n })) };
  }

  // 진주 + 다른 특수 → 그 색 타일을 전부 같은 특수로 바꾼 뒤 동시 발동
  if (sa === 'voidPearl' || sc === 'voidPearl') {
    const pearlIndex = sa === 'voidPearl' ? i : j;
    const otherIndex = sa === 'voidPearl' ? j : i;
    const other = b.cells[otherIndex].tile!;

    if (other.special === 'none') {
      // 진주 + 일반 타일 → 그 색 전부 제거
      return {
        seeds: [
          { index: pearlIndex, forceSpecial: 'voidPearl', forceColor: other.color },
          { index: otherIndex },
        ],
      };
    }

    const upgraded: Seed[] = [{ index: pearlIndex }];
    for (let n = 0; n < b.cells.length; n++) {
      const cell = b.cells[n];
      if (n === pearlIndex) continue;
      if (cell.tile && cell.tile.color === other.color) {
        upgraded.push({ index: n, forceSpecial: other.special });
      }
    }
    upgraded.push({ index: otherIndex, forceSpecial: other.special });
    return { seeds: upgraded };
  }

  // 해류 + 해류 → 십자
  if (isCurrent(sa) && isCurrent(sc)) {
    return {
      seeds: [
        { index: i, forceSpecial: 'currentH' },
        { index: j, forceSpecial: 'currentV' },
      ],
    };
  }

  // 기뢰 + 기뢰 → 5x5
  if (sa === 'mine' && sc === 'mine') {
    const seeds: Seed[] = [{ index: i }, { index: j }];
    const cx = xOf(b, j);
    const cy = yOf(b, j);
    for (let ny = cy - 2; ny <= cy + 2; ny++) {
      for (let nx = cx - 2; nx <= cx + 2; nx++) {
        if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
        seeds.push({ index: idx(b, nx, ny) });
      }
    }
    return { seeds };
  }

  // 해류 + 기뢰 → 3줄 가로 + 3줄 세로
  if ((isCurrent(sa) && sc === 'mine') || (sa === 'mine' && isCurrent(sc))) {
    const cx = xOf(b, j);
    const cy = yOf(b, j);
    const seeds: Seed[] = [{ index: i }, { index: j }];
    for (let d = -1; d <= 1; d++) {
      const ry = cy + d;
      if (ry >= 0 && ry < b.h) for (let nx = 0; nx < b.w; nx++) seeds.push({ index: idx(b, nx, ry) });
      const rx = cx + d;
      if (rx >= 0 && rx < b.w) for (let ny = 0; ny < b.h; ny++) seeds.push({ index: idx(b, rx, ny) });
    }
    return { seeds };
  }

  // 특수 하나 + 일반 타일: 콤보 아님 (일반 매치 규칙을 따른다)
  return null;
}
