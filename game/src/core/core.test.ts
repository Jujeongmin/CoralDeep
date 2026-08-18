// 퍼즐 코어 단위 테스트.  실행: npm test  (node --test, 타입 스트리핑으로 .ts 직접 실행)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import type { Board, Cell, Color, Goal, LevelDef, Special } from './types.ts';
import { idx, isMovable } from './types.ts';
import {
  countBlockers,
  countRubble,
  createBoard,
  findEscapePath,
  shuffleBoard,
} from './board.ts';
import { findFirstHint, findMatches, findRuns, hasPossibleMove } from './match.ts';
import { detonate, planCombo } from './special.ts';
import { initGoals, starsFor } from './goals.ts';
import {
  startLevel,
  trySwap,
  useBooster,
  drainOxygen,
  grantExtraMoves,
  grantOxygen,
  levelStars,
  loseReason,
  updateStatus,
} from './engine.ts';
import { makeRng } from './rng.ts';
import { LEVELS, depthT, predatorFor, sceneVariantFor } from '../levels.ts';

// ---------- 테스트용 보드 빌더 ----------
// tileRows: '0'~'5' 색, '.' 빈 칸, '#' 구멍
// blockerRows: '.' 없음, 'r' 산호암(hp1), 'R' 산호암(hp2), 'i' 결빙1, 'I' 결빙2, 'n' 어망

const BLOCKERS: Record<string, [Cell['blocker'], number]> = {
  '.': ['none', 0],
  r: ['rock', 1],
  R: ['rock', 2],
  i: ['ice', 1],
  I: ['ice', 2],
  n: ['net', 1],
};

function tb(tileRows: string[], blockerRows?: string[], colors = 6): Board {
  const h = tileRows.length;
  const w = tileRows[0].length;
  const cells: Cell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = tileRows[y][x];
      const bch = blockerRows?.[y]?.[x] ?? '.';
      const [blocker, hp] = BLOCKERS[bch];
      if (ch === '#') {
        cells.push({ hole: true, tile: null, blocker: 'none', blockerHp: 0, passage: false });
      } else if (ch === '.') {
        cells.push({ hole: false, tile: null, blocker, blockerHp: hp, passage: false });
      } else {
        cells.push({
          hole: false,
          tile: { color: Number(ch) as Color, special: 'none' },
          blocker,
          blockerHp: hp,
          passage: false,
        });
      }
    }
  }
  return { w, h, cells, colors, start: -1, exit: -1 };
}

function setSpecial(b: Board, x: number, y: number, special: Special): number {
  const i = idx(b, x, y);
  b.cells[i].tile!.special = special;
  return i;
}

function tileCount(b: Board): number {
  return b.cells.filter((c) => c.tile !== null).length;
}

// ---------- 매치 탐색 ----------

test('가로 3연속을 찾는다', () => {
  const b = tb(['222', '013', '031']);
  const runs = findRuns(b);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].cells, [0, 1, 2]);
  assert.equal(runs[0].horizontal, true);
});

test('세로 3연속을 찾는다', () => {
  const b = tb(['201', '210', '203']);
  const runs = findRuns(b);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].horizontal, false);
  assert.deepEqual(runs[0].cells, [0, 3, 6]);
});

test('가로 4연속은 currentH 를 만든다', () => {
  const b = tb(['2222', '0101']);
  const groups = findMatches(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].special, 'currentH');
});

test('세로 4연속은 currentV 를 만든다', () => {
  const b = tb(['20', '21', '20', '21', '13']);
  const groups = findMatches(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].special, 'currentV');
});

test('L자 매치는 mine 을 만들고 교차점에 놓는다', () => {
  const b = tb(['111', '100', '100']);
  const groups = findMatches(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].special, 'mine');
  assert.equal(groups[0].anchor, 0);
  assert.equal(groups[0].cells.length, 5);
});

test('5연속은 voidPearl 을 만든다', () => {
  const b = tb(['22222', '01010']);
  const groups = findMatches(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].special, 'voidPearl');
});

test('스왑한 칸이 그룹에 있으면 거기에 특수 타일이 생긴다', () => {
  const b = tb(['2222', '0101']);
  const groups = findMatches(b, [3]);
  assert.equal(groups[0].anchor, 3);
});

// ---------- 특수 타일 발동 ----------

test('currentH 는 자기 가로줄 전체를 제거한다', () => {
  const b = tb(['01234', '10321', '43210']);
  const i = setSpecial(b, 2, 1, 'currentH');
  const phase = detonate(b, [{ index: i }]);
  assert.equal(phase.tiles.length, 5);
  for (let x = 0; x < 5; x++) assert.equal(b.cells[idx(b, x, 1)].tile, null);
  assert.equal(b.cells[idx(b, 0, 0)].tile !== null, true);
});

test('currentV 는 자기 세로줄 전체를 제거한다', () => {
  const b = tb(['01234', '10321', '43210']);
  const i = setSpecial(b, 3, 0, 'currentV');
  const phase = detonate(b, [{ index: i }]);
  assert.equal(phase.tiles.length, 3);
  for (let y = 0; y < 3; y++) assert.equal(b.cells[idx(b, 3, y)].tile, null);
});

test('mine 은 3x3 을 제거한다', () => {
  const b = tb(['01234', '10321', '43210', '12043']);
  const i = setSpecial(b, 2, 1, 'mine');
  const phase = detonate(b, [{ index: i }]);
  assert.equal(phase.tiles.length, 9);
});

test('voidPearl 은 같은 색 전부를 제거한다', () => {
  const b = tb(['31313', '13131', '31313']);
  const i = setSpecial(b, 0, 0, 'voidPearl');
  const before = b.cells.filter((c) => c.tile?.color === 3).length;
  const phase = detonate(b, [{ index: i }]);
  assert.equal(phase.tiles.length, before);
  assert.equal(b.cells.every((c) => c.tile?.color !== 3), true);
});

test('특수 타일은 연쇄로 발동한다', () => {
  const b = tb(['01234', '10321', '43210']);
  const a = setSpecial(b, 0, 0, 'currentH'); // 가로줄 0 제거
  setSpecial(b, 3, 0, 'currentV'); // 그 줄에 있는 세로 해류가 연달아 터진다
  const phase = detonate(b, [{ index: a }]);
  assert.equal(phase.triggered.length, 2);
  for (let y = 0; y < 3; y++) assert.equal(b.cells[idx(b, 3, y)].tile, null);
});

// ---------- 콤보 ----------

test('해류 + 해류 콤보는 십자로 터진다', () => {
  const b = tb(['01234', '10321', '43210', '12043', '30142']);
  const i = setSpecial(b, 2, 2, 'currentH');
  const j = setSpecial(b, 3, 2, 'currentV');
  const plan = planCombo(b, i, j);
  assert.notEqual(plan, null);
  const phase = detonate(b, plan!.seeds);
  // 2행 전체(5) + 3열 전체(5) - 교차 1 = 9
  assert.equal(phase.tiles.length, 9);
});

test('기뢰 + 기뢰 콤보는 5x5 를 터뜨린다', () => {
  const b = tb(['01234', '10321', '43210', '12043', '30142']);
  const i = setSpecial(b, 2, 2, 'mine');
  const j = setSpecial(b, 3, 2, 'mine');
  const plan = planCombo(b, i, j);
  const phase = detonate(b, plan!.seeds);
  // 5x5 보드에서 (3,2) 중심 5x5 는 보드 밖이 잘려 x 1..4(4칸) * y 0..4(5칸) = 20칸
  assert.equal(phase.tiles.length, 20);
  for (let y = 0; y < 5; y++) assert.notEqual(b.cells[idx(b, 0, y)].tile, null); // x=0 열은 남는다
});

test('진주 + 일반 타일은 그 색을 전부 제거한다', () => {
  const b = tb(['01234', '10321', '43210']);
  const i = setSpecial(b, 0, 0, 'voidPearl');
  const j = idx(b, 1, 0); // 색 1
  const plan = planCombo(b, i, j);
  assert.notEqual(plan, null);
  detonate(b, plan!.seeds);
  assert.equal(b.cells.every((c) => c.tile?.color !== 1), true);
  assert.equal(b.cells[i].tile, null);
});

test('진주 + 진주는 보드를 비운다', () => {
  const b = tb(['012', '103', '432']);
  const i = setSpecial(b, 0, 0, 'voidPearl');
  const j = setSpecial(b, 1, 0, 'voidPearl');
  const plan = planCombo(b, i, j);
  detonate(b, plan!.seeds);
  assert.equal(tileCount(b), 0);
});

test('일반 타일끼리는 콤보가 아니다', () => {
  const b = tb(['012', '103', '432']);
  assert.equal(planCombo(b, 0, 1), null);
});

// ---------- 장애물 ----------

test('결빙은 제거 판정을 한 겹 흡수하고 타일은 살아남는다', () => {
  const b = tb(['012', '103', '432'], ['I..', '...', '...']);
  const phase = detonate(b, [{ index: 0 }]);
  assert.equal(b.cells[0].blocker, 'ice');
  assert.equal(b.cells[0].blockerHp, 1);
  assert.notEqual(b.cells[0].tile, null, '얼음이 남아 있으면 타일은 안 사라진다');
  assert.equal(b.cells[0].passage, false, '얼음이 남은 칸에는 물이 안 찬다');
  // 목표는 "장애물 N개 제거"다 — 아직 한 겹 남았으니 세지 않는다
  assert.equal(phase.collected.ice, 0);
  assert.equal(phase.tiles.length, 0);
});

test('결빙은 겹 수만큼 매치해야 뚫린다 — 리필 없이도 항상 뚫을 수 있다', () => {
  const b = tb(['012', '103', '432'], ['I..', '...', '...']);
  // 타일을 손으로 되돌려 놓지 않아도 된다. 흡수식이라 타일이 그대로 남기 때문이다.
  assert.equal(detonate(b, [{ index: 0 }]).collected.ice, 0);
  assert.equal(detonate(b, [{ index: 0 }]).collected.ice, 1);
  assert.equal(b.cells[0].blocker, 'none');
  assert.notEqual(b.cells[0].tile, null, '마지막 겹이 벗겨진 판정에서도 타일은 남는다');
  // 얼음이 사라진 뒤에야 타일이 지워지고 물길이 뚫린다
  const last = detonate(b, [{ index: 0 }]);
  assert.equal(last.tiles.length, 1);
  assert.equal(b.cells[0].passage, true);
});

test('결빙 칸 타일은 스왑할 수 있다 (어망과 다른 점)', () => {
  const b = tb(['012', '103', '432'], ['i.n', '...', '...']);
  assert.equal(isMovable(b.cells[0]), true, '결빙은 스왑을 막지 않는다');
  assert.equal(isMovable(b.cells[2]), false, '어망은 스왑을 막는다');
});

test('어망은 먼저 풀리고 타일은 살아남는다', () => {
  const b = tb(['012', '103', '432'], ['n..', '...', '...']);
  const phase = detonate(b, [{ index: 0 }]);
  assert.equal(b.cells[0].blocker, 'none');
  assert.notEqual(b.cells[0].tile, null);
  assert.equal(phase.collected.net, 1);
  assert.equal(phase.tiles.length, 0);
});

test('산호암은 인접한 타일이 사라질 때 피해를 받는다', () => {
  const b = tb(['.12', '103', '432'], ['r..', '...', '...']);
  const phase = detonate(b, [{ index: 1 }]); // (1,0) 타일 제거 → (0,0) 산호암 인접 피해
  assert.equal(b.cells[0].blocker, 'none');
  assert.equal(phase.collected.rock, 1);
});

test('인접 제거는 사라진 타일 하나당 한 번씩 피해를 준다', () => {
  const b = tb(['.12', '103', '432'], ['R..', '...', '...']);
  // (1,0) 과 (0,1) 을 한 판정에 제거하면 (0,0) 산호암은 2 를 맞고 부서진다.
  //
  // 예전엔 한 판정당 1 만 깎았다. 리필이 없는 판에서 그러면, 인접 타일을 한꺼번에
  // 태운 뒤 남은 내구도를 때릴 타일이 없어져 그 장애물이 영구히 남는다.
  const phase = detonate(b, [{ index: 1 }, { index: 3 }]);
  assert.equal(b.cells[0].blocker, 'none');
  assert.equal(phase.collected.rock, 1);
});

test('광역 제거가 잔해를 영구히 가두지 않는다 (소프트락 방지)', () => {
  // 2겹 잔해를 타일 세 칸이 감싼 형태. 기뢰 한 방이 셋을 동시에 태운다.
  const b = tb(['.12', '103', '432']);
  b.cells[0] = { hole: false, tile: null, blocker: 'rubble', blockerHp: 2, passage: false };
  detonate(b, [{ index: 1 }, { index: 3 }]);
  assert.equal(b.cells[0].blocker, 'none', '인접 타일을 다 쓰기 전에 부서져야 한다');
  assert.equal(b.cells[0].passage, true, '부순 자리는 물길이 된다');
});

test('폭발이 같은 장애물 칸을 겹쳐 덮어도 피해는 한 번이다', () => {
  const b = tb(['012', '103', '432'], ['R..', '...', '...']);
  // 해류와 기뢰가 같은 칸을 노려도 직접 타격은 한 판정에 1
  detonate(b, [{ index: 0 }, { index: 0 }]);
  assert.equal(b.cells[0].blocker, 'rock');
  assert.equal(b.cells[0].blockerHp, 1);
});

test('countBlockers 는 남은 장애물을 센다', () => {
  const b = tb(['012', '103', '432'], ['ri.', 'n..', '..I']);
  assert.deepEqual(countBlockers(b), { rock: 1, ice: 2, net: 1 });
});

test('잔해는 내구도만큼 인접 제거를 받아야 부서진다', () => {
  const b = tb(['.12', '103', '432'], undefined, 6);
  b.cells[0] = { hole: false, tile: null, blocker: 'rubble', blockerHp: 3, passage: false };

  for (let hit = 1; hit <= 2; hit++) {
    // 리필이 없으니 매번 인접 타일을 새로 놓고 때린다
    b.cells[1].tile = { color: 1, special: 'none' };
    b.cells[1].passage = false;
    const phase = detonate(b, [{ index: 1 }]);
    assert.equal(phase.collected.rubble, 0, `${hit}번째 타격에서는 아직 안 뚫린다`);
    assert.equal(b.cells[0].blocker, 'rubble');
  }
  b.cells[1].tile = { color: 1, special: 'none' };
  b.cells[1].passage = false;
  const last = detonate(b, [{ index: 1 }]);
  assert.equal(last.collected.rubble, 1);
  assert.equal(b.cells[0].blocker, 'none');
  assert.equal(b.cells[0].passage, true, '치운 자리는 물이 찬다');
});

// ---------- 보드 생성 / 셔플 ----------

test('생성된 보드는 즉시 매치가 없고 둘 수가 있다', () => {
  const level: LevelDef = { id: 1, w: 8, h: 8, moves: 20, colors: 6, goals: [] };
  for (let seed = 1; seed <= 40; seed++) {
    const b = createBoard(level, makeRng(seed));
    assert.equal(findRuns(b).length, 0, `seed ${seed}: 시작하자마자 매치가 생겼다`);
    assert.equal(hasPossibleMove(b), true, `seed ${seed}: 둘 수 있는 수가 없다`);
  }
});

test('셔플하면 다시 둘 수 있는 상태가 된다', () => {
  // 둘 수가 전혀 없는 체크무늬 보드
  const b = tb(['0123', '1032', '2301', '3210']);
  const before = hasPossibleMove(b);
  const ok = shuffleBoard(b, makeRng(3));
  assert.equal(ok, true);
  assert.equal(hasPossibleMove(b), true);
  assert.equal(typeof before, 'boolean');
});

test('장애물이 있는 레이아웃을 파싱한다', () => {
  const level: LevelDef = {
    id: 1,
    w: 3,
    h: 3,
    moves: 10,
    colors: 5,
    goals: [],
    layout: ['r.#', '.I.', 'n..'],
  };
  const b = createBoard(level, makeRng(1));
  assert.equal(b.cells[0].blocker, 'rock');
  assert.equal(b.cells[0].tile, null);
  assert.equal(b.cells[2].hole, true);
  assert.equal(b.cells[4].blocker, 'ice');
  assert.equal(b.cells[4].blockerHp, 2);
  assert.equal(b.cells[6].blocker, 'net');
});

// ---------- 레벨 진행 ----------

const BASE_ROWS = ['13434', '14343', '21434', '34343', '43434'];

function makeState(goals: Goal[], moves = 20) {
  const level: LevelDef = { id: 1, w: 5, h: 5, moves, colors: 5, goals };
  const state = startLevel(level, { seed: 11 });
  state.board = tb(BASE_ROWS, undefined, 5);
  state.goals = initGoals(goals, state.board);
  state.movesLeft = moves;
  state.totalMoves = moves;
  return state;
}

test('테스트 기준 보드에는 미리 성립된 매치가 없다', () => {
  assert.equal(findRuns(tb(BASE_ROWS, undefined, 5)).length, 0);
});

test('매치가 안 되는 스왑은 거부되고 보드가 되돌아간다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  const before = state.board.cells.map((c) => c.tile?.color ?? -1);
  const res = trySwap(state, 0, 1);
  assert.equal(res.ok, false);
  assert.deepEqual(
    state.board.cells.map((c) => c.tile?.color ?? -1),
    before,
  );
  assert.equal(state.movesLeft, 20);
});

test('매치가 되는 스왑은 이동 수를 소모하고 목표를 깎는다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  const res = trySwap(state, 10, 11); // (0,2)=2 <-> (1,2)=1 → 0열이 1,1,1
  assert.equal(res.ok, true);
  assert.equal(state.movesLeft, 19);
  assert.ok((res.collected.colors[1] ?? 0) >= 3);
  assert.ok(res.score > 0);
  assert.ok(res.phases.some((p) => p.kind === 'clear'));
});

test('지운 자리는 물이 차고 새 타일이 내려오지 않는다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  const res = trySwap(state, 10, 11);
  const cleared = res.phases.flatMap((p) => (p.kind === 'clear' ? p.tiles : []));
  assert.ok(cleared.length >= 3);
  for (const i of cleared) {
    assert.equal(state.board.cells[i].tile, null, '새 타일이 내려오면 안 된다');
    assert.equal(state.board.cells[i].passage, true, '지운 자리는 물이 찬다');
  }
});

test('물이 찬 칸은 매치에도 스왑에도 끼지 않는다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  trySwap(state, 10, 11);
  const water = state.board.cells.findIndex((c) => c.passage);
  assert.ok(water >= 0);
  const before = state.movesLeft;
  assert.equal(trySwap(state, water, water + 1).ok, false);
  assert.equal(state.movesLeft, before);
});

test('남은 타일은 제자리를 지킨다 (중력 없음)', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  const before = state.board.cells.map((c) => (c.tile ? `${c.tile.color}` : '-'));
  const res = trySwap(state, 10, 11);
  const cleared = new Set(res.phases.flatMap((p) => (p.kind === 'clear' ? p.tiles : [])));
  state.board.cells.forEach((c, i) => {
    if (cleared.has(i) || i === 10 || i === 11) return;
    assert.equal(c.tile ? `${c.tile.color}` : '-', before[i], `${i}번 칸이 움직였다`);
  });
});

test('구멍은 물이 차지 않는다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  trySwap(state, 10, 11);
  const holes = state.board.cells.filter((c) => c.hole && c.passage);
  assert.equal(holes.length, 0);
});

test('목표를 채우면 won 이 된다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  trySwap(state, 10, 11);
  assert.equal(state.status, 'won');
});

test('이동 수를 다 쓰고 목표가 남으면 lost 가 된다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 999 }], 1);
  trySwap(state, 10, 11);
  assert.equal(state.movesLeft, 0);
  assert.equal(state.status, 'lost');
});

test('광고 보상으로 이동 수를 더하면 다시 진행 상태가 된다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 999 }], 1);
  trySwap(state, 10, 11);
  assert.equal(state.status, 'lost');
  grantExtraMoves(state, 5);
  assert.equal(state.status, 'playing');
  assert.equal(state.movesLeft, 5);
  assert.equal(state.reviveCount, 1);
});

test('클리어 상태에서는 스왑이 무시된다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }]);
  trySwap(state, 10, 11);
  const moves = state.movesLeft;
  const res = trySwap(state, 0, 1);
  assert.equal(res.ok, false);
  assert.equal(state.movesLeft, moves);
});

// ---------- 부스터 ----------

test('작살은 타일 하나를 제거하고 이동 수를 쓰지 않는다', () => {
  const state = makeState([{ type: 'color', color: 3, count: 50 }]);
  const res = useBooster(state, 'harpoon', 12);
  assert.equal(res.ok, true);
  assert.equal(state.movesLeft, 20);
  assert.ok(res.phases.length > 0);
});

test('폭뢰는 3x3 을 터뜨린다', () => {
  const state = makeState([{ type: 'color', color: 3, count: 50 }]);
  const res = useBooster(state, 'depthCharge', 12);
  const first = res.phases[0];
  assert.equal(first.kind, 'clear');
  assert.ok(first.kind === 'clear' && first.tiles.length >= 9);
});

test('조류는 보드를 섞고 이동 수를 쓰지 않는다', () => {
  const state = makeState([{ type: 'color', color: 3, count: 50 }]);
  const before = state.board.cells.map((c) => c.tile?.color ?? -1).join('');
  const res = useBooster(state, 'tide');
  assert.equal(res.ok, true);
  assert.equal(state.movesLeft, 20);
  assert.notEqual(state.board.cells.map((c) => c.tile?.color ?? -1).join(''), before);
});

test('시작 부스터는 보드에 특수 타일을 심는다', () => {
  const level: LevelDef = { id: 1, w: 6, h: 6, moves: 20, colors: 5, goals: [] };
  const state = startLevel(level, { seed: 5, preBoosters: ['mine', 'pearl'] });
  const specials = state.board.cells.filter((c) => c.tile && c.tile.special !== 'none');
  assert.equal(specials.length, 2);
});

test('extraMoves 옵션이 총 이동 수에 더해진다', () => {
  const level: LevelDef = { id: 1, w: 6, h: 6, moves: 20, colors: 5, goals: [] };
  const state = startLevel(level, { seed: 5, extraMoves: 5 });
  assert.equal(state.movesLeft, 25);
  assert.equal(state.totalMoves, 25);
});

// ---------- 굴착 · 탈출로 ----------

function escapeLevel(layout: string[], oxygen = 20, moves = 30): LevelDef {
  return {
    id: 1,
    w: layout[0].length,
    h: layout.length,
    moves,
    colors: 5,
    oxygen,
    goals: [{ type: 'escape', count: 0 }],
    layout,
  };
}

test('S/E 는 처음부터 열린 통로이고 보드가 위치를 기억한다', () => {
  const b = createBoard(escapeLevel(['S..', '.x.', '..E']), makeRng(4));
  assert.equal(b.start, 0);
  assert.equal(b.exit, 8);
  assert.equal(b.cells[0].passage, true);
  assert.equal(b.cells[8].passage, true);
  assert.equal(b.cells[0].tile, null, '통로에는 타일이 없다');
  assert.equal(b.cells[8].tile, null);
});

test('잔해는 부수면 영구 통로가 된다', () => {
  const b = createBoard(escapeLevel(['S..', 'x..', '...']), makeRng(4));
  const rubble = idx(b, 0, 1);
  assert.equal(b.cells[rubble].blocker, 'rubble');
  assert.equal(countRubble(b), 1);

  // 내구도 2 — 두 번 맞아야 뚫린다
  detonate(b, [{ index: rubble }]);
  assert.equal(b.cells[rubble].passage, false);
  detonate(b, [{ index: rubble }]);
  assert.equal(b.cells[rubble].blocker, 'none');
  assert.equal(b.cells[rubble].passage, true);
  assert.equal(countRubble(b), 0);
});

test('뚫린 통로에는 타일이 다시 채워지지 않는다', () => {
  const b = createBoard(escapeLevel(['S..', 'x..', '...']), makeRng(4));
  const rubble = idx(b, 0, 1);
  detonate(b, [{ index: rubble }]);
  detonate(b, [{ index: rubble }]);
  assert.equal(b.cells[rubble].tile, null, '통로는 계속 비어 있어야 한다');
});

test('통로가 끊겨 있으면 탈출로가 없다', () => {
  const b = createBoard(escapeLevel(['S..', 'x..', 'E..']), makeRng(4));
  assert.equal(findEscapePath(b), null);
});

test('잔해를 다 뚫으면 시작에서 출구까지 경로가 생긴다', () => {
  const b = createBoard(escapeLevel(['S..', 'x..', 'E..']), makeRng(4));
  const rubble = idx(b, 0, 1);
  detonate(b, [{ index: rubble }]);
  detonate(b, [{ index: rubble }]);
  const path = findEscapePath(b);
  assert.deepEqual(path, [0, 3, 6], '위에서 아래로 이어진 세 칸');
});

test('경로는 꺾여도 찾는다', () => {
  const b = createBoard(escapeLevel(['So.', '.o.', '.oE']), makeRng(4));
  const path = findEscapePath(b);
  assert.notEqual(path, null);
  assert.equal(path![0], 0);
  assert.equal(path![path!.length - 1], 8);
});

test('길이 이어지면 그 수에 탈출하고 레벨이 끝난다', () => {
  const level = escapeLevel(['So....', 'xo....', 'Eo....', '......', '......', '......'], 20, 30);
  const state = startLevel(level, { seed: 7 });
  assert.equal(state.escaped, false);
  assert.equal(state.status, 'playing');

  // 잔해를 직접 뚫고 한 수를 두면 그 수에 탈출 판정이 난다
  const rubble = idx(state.board, 0, 1);
  detonate(state.board, [{ index: rubble }]);
  detonate(state.board, [{ index: rubble }]);

  const hint = findFirstHint(state.board);
  assert.notEqual(hint, null, '둘 수 있는 수가 있어야 한다');
  const res = trySwap(state, hint![0], hint![1]);
  assert.equal(res.ok, true);
  assert.equal(state.escaped, true);
  assert.equal(res.collected.escaped, 1);
  assert.ok(res.phases.some((p) => p.kind === 'escape'));
  assert.equal(state.status, 'won');
});

test('탈출은 한 번만 처리된다', () => {
  const level = escapeLevel(['So....', 'oo....', 'Eo....', '......', '......', '......'], 20, 30);
  const state = startLevel(level, { seed: 7 });
  const hint = findFirstHint(state.board);
  const first = trySwap(state, hint![0], hint![1]);
  assert.equal(first.collected.escaped, 1);
  state.status = 'playing'; // 계속 둘 수 있게 강제
  const hint2 = findFirstHint(state.board);
  if (hint2) {
    const second = trySwap(state, hint2[0], hint2[1]);
    assert.equal(second.collected.escaped, 0, '두 번 세면 안 된다');
  }
});

// ---------- 레벨 데이터 검증 ----------

test('모든 레벨이 탈출 미션이고 산소가 설정돼 있다', () => {
  for (const level of LEVELS) {
    assert.ok(
      level.goals.some((g) => g.type === 'escape'),
      `레벨 ${level.id}: escape 목표가 없다`,
    );
    assert.ok((level.oxygen ?? 0) > 0, `레벨 ${level.id}: 산소가 없다`);
    assert.ok(level.layout, `레벨 ${level.id}: 레이아웃이 없다`);
  }
});

test('레이아웃 크기가 w x h 와 맞는다', () => {
  for (const level of LEVELS) {
    const layout = level.layout!;
    assert.equal(layout.length, level.h, `레벨 ${level.id}: 행 수가 다르다`);
    for (const [y, row] of layout.entries()) {
      assert.equal(row.length, level.w, `레벨 ${level.id} ${y}행: 길이가 다르다`);
    }
  }
});

test('모든 레벨에 시작(S)과 탈출구(E)가 정확히 하나씩 있다', () => {
  for (const level of LEVELS) {
    const flat = level.layout!.join('');
    assert.equal((flat.match(/S/g) ?? []).length, 1, `레벨 ${level.id}: S 가 하나가 아니다`);
    assert.equal((flat.match(/E/g) ?? []).length, 1, `레벨 ${level.id}: E 가 하나가 아니다`);
  }
});

test('번역이 다 채워져 있다', () => {
  // 빠진 키는 `t()` 가 한국어로 되돌려주므로 화면이 깨지지 않는다 —
  // 그래서 **눈으로는 못 찾는다.** 영어 화면에 한국어가 한 줄 섞여 있어도 그냥 지나간다.
  const src = readFileSync(new URL('../i18n.ts', import.meta.url), 'utf8');
  const dict = (name: string): Record<string, string> => {
    const from = src.indexOf('{', src.indexOf(`const ${name}`));
    let depth = 0;
    let to = from;
    for (let i = from; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        to = i;
        break;
      }
    }
    const out: Record<string, string> = {};
    for (const m of src.slice(from, to).matchAll(/^ {2}([A-Za-z0-9_]+): '([^']*)'/gm)) {
      out[m[1]] = m[2];
    }
    return out;
  };

  const ko = dict('KO');
  const placeholders = (s: string): string => (s.match(/\{[a-z]\}/g) ?? []).sort().join(',');

  assert.ok(Object.keys(ko).length > 100, `KO 사전이 ${Object.keys(ko).length}개뿐이다`);

  for (const name of ['EN', 'JA', 'ZH']) {
    const other = dict(name);
    for (const key of Object.keys(ko)) {
      assert.ok(key in other, `${name} 에 '${key}' 가 없다`);
      // 한글은 어느 번역에도 남아 있으면 안 된다 (일본어·번체는 한자를 쓰므로 이 검사에 안 걸린다)
      assert.ok(!/[가-힣]/.test(other[key]), `${name} '${key}' 에 한글이 남아 있다: ${other[key]}`);
      assert.equal(
        placeholders(other[key]),
        placeholders(ko[key]),
        `${name} '${key}' 의 치환 자리가 다르다`,
      );
    }
    // 한국어에 없는 키가 번역에만 있으면 오타이거나 지우다 만 것이다
    for (const key of Object.keys(other)) {
      assert.ok(key in ko, `${name} 에만 있는 키: '${key}'`);
    }
  }
});

test('소스에 이모지가 없다', () => {
  // 이모지는 기기·OS 마다 그림이 달라서 게임 아트로 못 쓴다.
  // 전부 직접 만든 SVG 로 갈아치웠고, 다시 섞여 들어오지 않게 막는다.
  const pictographic = /\p{Extended_Pictographic}/u;
  const root = new URL('../..', import.meta.url);
  const offenders: string[] = [];

  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'assets') continue;
        walk(child);
      } else if (/\.(ts|css|html)$/.test(entry.name)) {
        for (const [n, line] of readFileSync(child, 'utf8').split('\n').entries()) {
          if (pictographic.test(line)) offenders.push(`${entry.name}:${n + 1}`);
        }
      }
    }
  };

  walk(root);
  assert.deepEqual(offenders, [], `이모지가 남아 있다: ${offenders.join(', ')}`);
});

test('시작(S)은 위쪽, 탈출구(E)는 아래쪽에 있다', () => {
  // 위 장면의 잠수부가 곰치를 피해 보드를 뚫고 아래로 내려오는 구조다.
  // S 가 아래에 있으면 연출과 퍼즐 방향이 어긋난다.
  for (const level of LEVELS) {
    const layout = level.layout!;
    const sy = layout.findIndex((row) => row.includes('S'));
    const ey = layout.findIndex((row) => row.includes('E'));
    assert.ok(sy >= 0 && ey >= 0, `레벨 ${level.id}: S/E 를 못 찾았다`);
    assert.ok(sy < ey, `레벨 ${level.id}: S(${sy}행) 가 E(${ey}행) 보다 아래에 있다`);
    // 실제로 맨 위/맨 아래 열린 행에 붙어 있어야 내려오는 그림이 산다
    const firstOpen = layout.findIndex((row) => /[^#]/.test(row));
    const lastOpen = layout.length - 1 - [...layout].reverse().findIndex((row) => /[^#]/.test(row));
    assert.equal(sy, firstOpen, `레벨 ${level.id}: S 가 맨 위 열린 행에 없다`);
    assert.equal(ey, lastOpen, `레벨 ${level.id}: E 가 맨 아래 열린 행에 없다`);
  }
});

test('모든 레벨에서 타일을 다 파내면 탈출로가 이어진다', () => {
  // 파낼 수 있는 칸을 전부 물로 바꿨을 때도 길이 안 이어지면 클리어 불가 레벨이다
  for (const level of LEVELS) {
    const board = createBoard(level, makeRng(level.id));
    for (const cell of board.cells) {
      if (cell.hole) continue;
      if (cell.tile || cell.blocker === 'rock') cell.passage = true;
    }
    assert.notEqual(findEscapePath(board), null, `레벨 ${level.id}: 통로가 끊겨 있다`);
  }
});

test('시작 상태에서는 아직 탈출로가 열려 있지 않다', () => {
  for (const level of LEVELS) {
    const board = createBoard(level, makeRng(level.id));
    assert.equal(findEscapePath(board), null, `레벨 ${level.id}: 시작부터 클리어 상태다`);
  }
});

test('파낼 타일이 충분히 있다', () => {
  // 리필이 없으므로 타일이 너무 적으면 길을 내기 전에 판이 마른다.
  // 보드가 직사각형이 아니므로 전체 칸이 아니라 **열린 칸** 대비로 본다.
  for (const level of LEVELS) {
    const board = createBoard(level, makeRng(level.id));
    const open = board.cells.filter((c) => !c.hole).length;
    const tiles = board.cells.filter((c) => c.tile !== null).length;
    assert.ok(open >= 20, `레벨 ${level.id}: 보드가 ${open}칸뿐이다`);
    assert.ok(tiles > open * 0.65, `레벨 ${level.id}: 타일이 ${tiles}/${open}`);
  }
});

test('보드가 자갈 속에 파인 불규칙한 형태다', () => {
  // 전부 직사각형이면 레퍼런스의 '자갈에 파인 구멍' 느낌이 안 난다
  let irregular = 0;
  for (const level of LEVELS) {
    const holes = level.layout!.join('').split('#').length - 1;
    if (holes > 0) irregular++;
  }
  assert.ok(irregular >= LEVELS.length - 2, `불규칙한 레벨이 ${irregular}개뿐이다`);
});

test('레벨이 진행될수록 대체로 어려워진다', () => {
  const first = LEVELS[0];
  const last = LEVELS[LEVELS.length - 1];
  assert.ok(last.moves > first.moves, '후반 레벨이 이동 수가 더 많아야 한다');
  assert.ok((last.oxygen ?? 0) > (first.oxygen ?? 0), '후반 레벨이 산소가 더 많아야 한다');
  // 산소는 이동 수보다 항상 빡빡해야 압박이 생긴다
  for (const level of LEVELS) {
    assert.ok(
      (level.oxygen ?? 0) < level.moves,
      `레벨 ${level.id}: 산소가 이동 수보다 많으면 제한이 무의미하다`,
    );
  }
});

test('포식자가 수심대로 갈린다 — 곰치 1~10 · 아귀 11~20 · 촉수 21~30', () => {
  // 경계가 반듯한 숫자로 안 떨어진다. 21단계는 20/29 = 0.6897 이라 문턱을 0.7 로 두면
  // 조용히 아귀 쪽에 남는다 — 눈으로는 한 단계 차이라 놓친다.
  for (let id = 1; id <= 30; id++) {
    const want = id <= 10 ? 'eel' : id <= 20 ? 'angler' : 'tentacle';
    assert.equal(predatorFor(depthT(id)), want, `레벨 ${id}`);
  }
});
test('장면 변형이 레이아웃의 장애물을 따라간다', () => {
  const variants = new Set(LEVELS.map(sceneVariantFor));
  assert.ok(variants.size >= 3, '레벨마다 같은 장면만 나오면 심심하다');
  for (const level of LEVELS) {
    const v = sceneVariantFor(level);
    assert.ok(['rescue', 'ice', 'rock', 'net'].includes(v), `레벨 ${level.id}: ${v}`);
  }
});

// ---------- 산소 (구조 타임어택) ----------

function rescueState(oxygen: number, moves = 20) {
  const level: LevelDef = {
    id: 1,
    w: 5,
    h: 5,
    moves,
    colors: 5,
    oxygen,
    goals: [{ type: 'escape', count: 2 }],
  };
  const state = startLevel(level, { seed: 11 });
  state.board = tb(BASE_ROWS, undefined, 5);
  state.goals = initGoals(level.goals, state.board);
  state.movesLeft = moves;
  state.totalMoves = moves;
  return state;
}

test('수를 둬도 남은 시간은 줄지 않는다', () => {
  // 시간은 실제 시간으로만 흐른다. 한 수마다 깎이면 손을 놓고 있는 동안이
  // 안전해져서 쫓기는 느낌이 사라진다.
  const state = rescueState(5);
  trySwap(state, 10, 11);
  assert.equal(state.oxygen, 5);
  assert.equal(state.status, 'playing');
});

test('시간이 흐르면 남은 시간이 줄어든다', () => {
  const state = rescueState(5);
  drainOxygen(state, 2);
  assert.equal(state.oxygen, 3);
  assert.equal(state.status, 'playing');
});

test('시간이 0이 되면 이동 수가 남아도 잡아먹힌다', () => {
  const state = rescueState(1, 20);
  drainOxygen(state, 1);
  assert.equal(state.oxygen, 0);
  assert.ok(state.movesLeft > 0, '이동 수는 아직 남아 있다');
  assert.equal(state.status, 'lost');
  assert.equal(loseReason(state), 'eaten');
});

test('시간이 다 된 판은 이동 수만 늘려도 살아나지 않는다', () => {
  const state = rescueState(1, 20);
  drainOxygen(state, 1);
  grantExtraMoves(state, 5);
  assert.equal(state.status, 'lost');
});

test('산소통 광고 보상은 시간과 이동 수를 같이 준다', () => {
  const state = rescueState(1, 1);
  drainOxygen(state, 1);
  assert.equal(state.status, 'lost');
  grantOxygen(state, 6, 4);
  assert.equal(state.status, 'playing');
  assert.equal(state.oxygen, 6);
  // 시간이 다 돼서 진 것이지 이동 수를 쓴 게 아니다 — 남아 있던 1 에 4 가 더해진다
  assert.equal(state.movesLeft, 5);
});

test('구조를 마친 뒤에는 시간이 흘러도 안전하다', () => {
  const state = rescueState(3);
  state.goals = initGoals([{ type: 'escape', count: 1 }], state.board);
  state.goals[0].done = 1;
  drainOxygen(state, 5);
  assert.equal(state.oxygen, 3, '구조가 끝나면 더 이상 안 줄어든다');
});

test('산소가 없는 레벨은 이동 수 부족으로만 진다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 999 }], 1);
  trySwap(state, 10, 11);
  assert.equal(state.status, 'lost');
  assert.equal(loseReason(state), 'moves');
  assert.equal(state.maxOxygen, 0);
});

test('판이 막혀서 진 경우는 이동 수 부족과 다르게 표시한다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 999 }], 20);
  // 이동 수는 넉넉히 남겨둔 채 판만 막힌 상황
  state.deadBoard = true;
  updateStatus(state);
  assert.equal(state.status, 'lost');
  assert.ok(state.movesLeft > 0, '이동 수는 아직 남아 있다');
  assert.equal(loseReason(state), 'deadBoard');
});

test('구조를 마치면 산소가 더 이상 줄지 않는다', () => {
  const state = rescueState(5);
  // 구조 완료 상태로 만든다 (다른 목표가 없으니 곧바로 won 이 되지 않게 목표를 하나 더 둔다)
  state.goals = initGoals(
    [
      { type: 'escape', count: 1 },
      { type: 'color', color: 3, count: 999 },
    ],
    state.board,
  );
  state.goals[0].done = 1;
  const before = state.oxygen;
  trySwap(state, 10, 11);
  assert.equal(state.oxygen, before);
  assert.equal(state.status, 'playing');
});

// ---------- 별 ----------

test('남은 이동 비율에 따라 별이 정해진다', () => {
  assert.equal(starsFor(10, 20), 3);
  assert.equal(starsFor(3, 20), 2);
  assert.equal(starsFor(1, 20), 1);
  assert.equal(starsFor(0, 20), 1);
});

test('levelStars 는 현재 상태에서 별을 계산한다', () => {
  const state = makeState([{ type: 'color', color: 1, count: 3 }], 20);
  trySwap(state, 10, 11);
  assert.equal(levelStars(state), 3);
});

// ---------- 목표 자동 수량 ----------

test('목표 수량을 0 으로 두면 보드에서 자동 계산한다', () => {
  const b = tb(['012', '103', '432'], ['rr.', '..i', '...']);
  const progress = initGoals(
    [
      { type: 'rock', count: 0 },
      { type: 'ice', count: 0 },
    ],
    b,
  );
  assert.equal(progress[0].target, 2);
  assert.equal(progress[1].target, 1);
});

