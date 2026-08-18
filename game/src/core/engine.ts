// 레벨 진행 상태 기계. 스왑 -> 제거 -> 낙하 -> 연쇄 -> 목표/이동 판정.

import type {
  Board,
  ClearPhase,
  Color,
  LevelDef,
  Phase,
  Special,
  SwapResult,
} from './types.ts';
import {
  emptyCollected,
  idx,
  isMovable,
  isSolid,
  mergeCollected,
  xOf,
  yOf,
} from './types.ts';
import { createBoard, findEscapePath, shuffleBoard } from './board.ts';
import { findMatches, hasPossibleMove } from './match.ts';
import { detonate, planCombo } from './special.ts';
import { applyCollected, goalsComplete, initGoals, rescuePending, starsFor } from './goals.ts';
import type { GoalProgress } from './goals.ts';
import { makeRng } from './rng.ts';
import type { Rng } from './rng.ts';

export type LevelStatus = 'playing' | 'won' | 'lost';

export interface LevelState {
  level: LevelDef;
  board: Board;
  rng: Rng;
  movesLeft: number;
  totalMoves: number;
  score: number;
  goals: GoalProgress[];
  status: LevelStatus;
  /** 이 판에서 광고로 이동 수를 이미 몇 번 연장했는지 (재도전 광고 남용 방지) */
  reviveCount: number;
  /**
   * 갇힌 연구원의 남은 산소. maxOxygen === 0 이면 이 레벨에 산소 시스템이 없다.
   * 구조를 끝내기 전에 0이 되면 이동 수가 남아 있어도 실패한다.
   */
  oxygen: number;
  maxOxygen: number;
  /** 탈출로가 이미 이어졌는가 (한 번만 처리한다) */
  escaped: boolean;
  /** 남은 타일로는 더 이상 둘 수가 없다 (리필이 없어서 생기는 상황) */
  deadBoard: boolean;
}

/** 왜 졌는지 (실패 모달 문구를 나누기 위해) */
export type LoseReason = 'moves' | 'eaten' | 'deadBoard';

export function loseReason(state: LevelState): LoseReason {
  // 시간이 다 되면 곰치가 잡아먹는다
  if (state.maxOxygen > 0 && state.oxygen <= 0 && rescuePending(state.goals)) return 'eaten';
  // 판이 막힌 것과 이동 수를 다 쓴 것은 다르다.
  // 섞어도 짝이 안 나오는 상황에서 "이동이 부족해요" 를 띄우면
  // 이동 수가 멀쩡히 남아 있는 화면과 문구가 어긋난다.
  if (state.deadBoard) return 'deadBoard';
  return 'moves';
}

/** 이 레벨이 구조 미션인가 */
export function isRescueLevel(state: LevelState): boolean {
  return state.maxOxygen > 0;
}

/** 레벨 시작 전 부스터: 보드에 특수 타일을 미리 뿌린다. */
export type PreBooster = 'current' | 'mine' | 'pearl';

/** 인게임 부스터 */
export type InGameBooster = 'harpoon' | 'depthCharge' | 'tide';

export interface StartOptions {
  seed?: number;
  extraMoves?: number;
  preBoosters?: PreBooster[];
}

export function startLevel(level: LevelDef, options: StartOptions = {}): LevelState {
  const rng = makeRng(options.seed ?? 0x9e3779b9);
  const board = createBoard(level, rng);
  const totalMoves = level.moves + (options.extraMoves ?? 0);

  for (const boost of options.preBoosters ?? []) applyPreBooster(board, boost, rng);

  return {
    level,
    board,
    rng,
    movesLeft: totalMoves,
    totalMoves,
    score: 0,
    goals: initGoals(level.goals, board),
    status: 'playing',
    reviveCount: 0,
    oxygen: level.oxygen ?? 0,
    maxOxygen: level.oxygen ?? 0,
    escaped: false,
    deadBoard: false,
  };
}

function applyPreBooster(board: Board, boost: PreBooster, rng: Rng): void {
  const candidates: number[] = [];
  for (let i = 0; i < board.cells.length; i++) {
    const c = board.cells[i];
    if (isMovable(c) && c.tile!.special === 'none') candidates.push(i);
  }
  if (candidates.length === 0) return;
  const i = rng.pick(candidates);
  const special: Special =
    boost === 'mine' ? 'mine' : boost === 'pearl' ? 'voidPearl' : rng.next() < 0.5 ? 'currentH' : 'currentV';
  board.cells[i].tile!.special = special;
}

export function areAdjacent(b: Board, i: number, j: number): boolean {
  const dx = Math.abs(xOf(b, i) - xOf(b, j));
  const dy = Math.abs(yOf(b, i) - yOf(b, j));
  return dx + dy === 1;
}

/**
 * 두 칸을 맞바꾼다. 매치가 생기지 않으면 되돌리고 ok:false.
 * 성공하면 애니메이션용 Phase 목록을 돌려준다 (스왑 애니메이션은 호출부가 먼저 재생).
 */
export function trySwap(state: LevelState, i: number, j: number): SwapResult {
  const b = state.board;
  const empty: SwapResult = { ok: false, phases: [], score: 0, collected: emptyCollected() };
  if (state.status !== 'playing') return empty;
  if (!areAdjacent(b, i, j)) return empty;
  if (!isMovable(b.cells[i]) || !isMovable(b.cells[j])) return empty;

  swapTiles(b, i, j);

  const combo = planCombo(b, i, j);
  let first: ClearPhase | null = null;

  if (combo) {
    first = detonate(b, combo.seeds);
  } else {
    const groups = findMatches(b, [i, j]);
    if (groups.length > 0) {
      first = resolveMatches(b, groups);
    } else {
      // 매치는 안 됐지만 특수 타일을 옮긴 경우 → 그 특수 타일을 단독 발동시킨다.
      const specialIndex = b.cells[i].tile?.special !== 'none' ? i : b.cells[j].tile?.special !== 'none' ? j : -1;
      if (specialIndex >= 0) {
        first = detonate(b, [{ index: specialIndex }]);
      } else {
        swapTiles(b, i, j);
        return empty;
      }
    }
  }

  return finishMove(state, first);
}

function swapTiles(b: Board, i: number, j: number): void {
  const t = b.cells[i].tile;
  b.cells[i].tile = b.cells[j].tile;
  b.cells[j].tile = t;
}

/** 매치 그룹들을 제거하고, 규칙에 맞는 특수 타일을 생성한다. */
function resolveMatches(b: Board, groups: ReturnType<typeof findMatches>): ClearPhase {
  const spare = new Set<number>();
  for (const g of groups) if (g.special !== 'none') spare.add(g.anchor);

  const seeds = groups.flatMap((g) => g.cells.map((c) => ({ index: c })));
  const phase = detonate(b, seeds, spare);

  for (const g of groups) {
    if (g.special === 'none') continue;
    const cell = b.cells[g.anchor];
    cell.tile = { color: g.color as Color, special: g.special };
    phase.created.push({ index: g.anchor, special: g.special, color: g.color as Color });
  }
  return phase;
}

/**
 * 한 수의 결과를 마무리한다.
 *
 * 이 게임은 **새 타일이 위에서 내려오지 않는다.** 지운 자리는 그대로 물이 차고,
 * 남은 타일은 제자리를 지킨다. 그래서 낙하도 연쇄도 없고 제거는 한 번뿐이다.
 * (특수 타일끼리의 연쇄 발동은 detonate 안에서 이미 다 처리된다.)
 */
function runCascade(state: LevelState, first: ClearPhase): Phase[] {
  const phases: Phase[] = [first];

  // 물길이 이어졌는지 본다. 이어졌으면 잠수부가 그 길로 빠져나간다.
  if (!state.escaped) {
    const path = findEscapePath(state.board);
    if (path) {
      state.escaped = true;
      phases.push({ kind: 'escape', cells: path });
    }
  }

  return phases;
}

function finishMove(state: LevelState, first: ClearPhase): SwapResult {
  const phases = runCascade(state, first);

  const collected = emptyCollected();
  let score = 0;
  for (const p of phases) {
    if (p.kind === 'clear') {
      score += p.score;
      mergeCollected(collected, p.collected);
    } else if (p.kind === 'escape') {
      collected.escaped += 1;
      score += 1000;
    }
  }

  state.score += score;
  applyCollected(state.goals, collected);
  state.movesLeft = Math.max(0, state.movesLeft - 1);


  // 움직일 수 있는 수가 없으면 남은 타일을 섞어본다.
  // 리필이 없으니 타일이 다 떨어지면 섞어도 소용없다 — 그때는 판이 끝난 것이다.
  if (!hasPossibleMove(state.board)) {
    shuffleBoard(state.board, state.rng);
    state.deadBoard = !hasPossibleMove(state.board);
  }

  updateStatus(state);

  return { ok: true, phases, score, collected };
}

export function updateStatus(state: LevelState): void {
  if (state.status !== 'playing') return;
  if (goalsComplete(state.goals)) {
    state.status = 'won';
    return;
  }
  // 산소 고갈은 이동 수가 남아 있어도 즉시 실패다
  if (state.maxOxygen > 0 && state.oxygen <= 0 && rescuePending(state.goals)) {
    state.status = 'lost';
    return;
  }
  // 리필이 없으니 둘 수가 없으면 그대로 끝이다
  if (state.deadBoard) {
    state.status = 'lost';
    return;
  }
  if (state.movesLeft <= 0) state.status = 'lost';
}

/**
 * 시간이 흘러 곰치가 다가온다.
 *
 * 예전엔 한 수를 둘 때마다 산소가 1씩 줄었다. 그러면 '가만히 있으면 안전한 시간'이
 * 생겨서 쫓기는 느낌이 안 난다. 지금은 실제 시간으로 줄고, 0 이 되면 잡아먹힌다.
 * 구조가 끝난 뒤에는 더 이상 줄지 않는다.
 */
export function drainOxygen(state: LevelState, amount: number): LevelState['status'] {
  if (state.status !== 'playing' || state.maxOxygen <= 0) return state.status;
  if (!rescuePending(state.goals)) return state.status;
  state.oxygen = Math.max(0, state.oxygen - amount);
  updateStatus(state);
  return state.status;
}

/** 광고 보상 등으로 이동 수를 더해 다시 진행시킨다. */
export function grantExtraMoves(state: LevelState, n: number): void {
  state.movesLeft += n;
  state.totalMoves += n;
  state.reviveCount += 1;
  if (state.status === 'lost') state.status = 'playing';
  if (!hasPossibleMove(state.board)) shuffleBoard(state.board, state.rng);
  updateStatus(state);
}

/**
 * 산소통을 보충한다 (광고 보상).
 * 이동 수가 이미 0이면 같이 늘려줘야 실제로 이어서 할 수 있다.
 */
export function grantOxygen(state: LevelState, n: number, extraMoves = 0): void {
  if (state.maxOxygen <= 0) return;
  state.oxygen += n;
  state.maxOxygen = Math.max(state.maxOxygen, state.oxygen);
  if (extraMoves > 0) {
    state.movesLeft += extraMoves;
    state.totalMoves += extraMoves;
  }
  state.reviveCount += 1;
  if (state.status === 'lost') state.status = 'playing';
  if (!hasPossibleMove(state.board)) shuffleBoard(state.board, state.rng);
  updateStatus(state);
}

/** 클리어 시 획득 별 개수 */
export function levelStars(state: LevelState): 1 | 2 | 3 {
  return starsFor(state.movesLeft, state.totalMoves);
}

/**
 * 인게임 부스터 사용.
 * - harpoon(작살): 지정한 타일 1개 제거. index 필요.
 * - depthCharge(폭뢰): 지정 지점 3x3 폭발. index 필요.
 * - tide(조류): 보드 전체 셔플. index 불필요.
 *
 * 부스터는 이동 수를 소모하지 않는다.
 */
export function useBooster(state: LevelState, booster: InGameBooster, index?: number): SwapResult {
  const empty: SwapResult = { ok: false, phases: [], score: 0, collected: emptyCollected() };
  if (state.status !== 'playing') return empty;
  const b = state.board;

  if (booster === 'tide') {
    if (!shuffleBoard(b, state.rng)) return empty;
    return { ok: true, phases: [], score: 0, collected: emptyCollected() };
  }

  if (index === undefined || index < 0 || index >= b.cells.length) return empty;
  const cell = b.cells[index];
  if (cell.hole) return empty;
  if (booster === 'harpoon' && !cell.tile && cell.blocker === 'none') return empty;

  const first =
    booster === 'depthCharge'
      ? detonate(b, [{ index, forceSpecial: 'mine' }])
      : detonate(b, [{ index }]);

  if (first.tiles.length === 0 && first.blockers.length === 0) return empty;

  const phases = runCascade(state, first);
  const collected = emptyCollected();
  let score = 0;
  for (const p of phases) {
    if (p.kind === 'clear') {
      score += p.score;
      mergeCollected(collected, p.collected);
    } else if (p.kind === 'escape') {
      collected.escaped += 1;
      score += 1000;
    }
  }
  state.score += score;
  applyCollected(state.goals, collected);
  if (!hasPossibleMove(state.board)) shuffleBoard(state.board, state.rng);
  updateStatus(state);

  return { ok: true, phases, score, collected };
}

/** 디버그/테스트용: 보드를 문자열로 덤프한다. */
export function dumpBoard(b: Board): string {
  const lines: string[] = [];
  for (let y = 0; y < b.h; y++) {
    let line = '';
    for (let x = 0; x < b.w; x++) {
      const c = b.cells[idx(b, x, y)];
      if (c.hole) line += '#';
      else if (isSolid(c)) line += 'r';
      else if (!c.tile) line += ' ';
      else if (c.tile.special === 'currentH') line += 'H';
      else if (c.tile.special === 'currentV') line += 'V';
      else if (c.tile.special === 'mine') line += 'M';
      else if (c.tile.special === 'voidPearl') line += 'P';
      else line += String(c.tile.color);
    }
    lines.push(line);
  }
  return lines.join('\n');
}
