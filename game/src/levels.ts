// 레벨 데이터. 30 스테이지 전부 '탈출' 미션이다.
//
// 규칙: 타일을 지우면 그 칸에 **물이 찬다** (새 타일이 내려오지 않는다).
//       물이 잠수부(S)부터 탈출구(E)까지 이어지면 탈출 성공.
//       산소는 한 수마다 1씩 줄고, 다 떨어지면 이동 수가 남아도 실패.
//
// 보드는 직사각형이 아니다. **자갈 더미('#') 속에 파인 불규칙한 구멍**이 보드다
// (계단 · L자 · 십자 · 모래시계 · 대각 띠 · 지그재그 · 방).
// S 와 E 는 그 형태 안에서 서로 가장 먼 두 칸으로 잡는다.
//
// layout 문자
//   '.' 일반 타일 칸 / '#' 자갈 더미 (보드에 없는 칸)
//   'S' 잠수부 / 'E' 탈출구
//   'r' 산호암1 / 'R' 산호암2 (타일 없음, 인접 제거로만 부순다 — 부수면 물이 찬다)
//   'i' 결빙1 / 'I' 결빙2 (타일 위에 덮인 층) / 'n' 어망

import type { LevelDef } from './core/types.ts';
import type { PredatorKind, SceneVariant } from './render/levelScene.ts';

const ESCAPE = { type: 'escape', count: 0 } as const;

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    w: 8, h: 9, moves: 26, colors: 4, oxygen: 19,
    goals: [ESCAPE],
    layout: [
      '##.S.###',
      '##...###',
      '##....##',
      '........',
      '........',
      '........',
      '##....##',
      '##...###',
      '##E..###',
    ],
  },
  {
    id: 2,
    w: 8, h: 9, moves: 26, colors: 4, oxygen: 19,
    goals: [ESCAPE],
    layout: [
      '###S.###',
      '###..###',
      '##....##',
      '.......#',
      '......##',
      '......##',
      '#.......',
      '##....##',
      '###..E##',
    ],
  },
  {
    id: 3,
    w: 8, h: 9, moves: 26, colors: 4, oxygen: 19,
    goals: [ESCAPE],
    layout: [
      '###S..##',
      '##....##',
      '#.......',
      '##......',
      '##......',
      '##......',
      '##....##',
      '###..###',
      '###.E###',
    ],
  },
  {
    id: 4,
    w: 8, h: 9, moves: 26, colors: 5, oxygen: 19,
    goals: [ESCAPE],
    layout: [
      '##.S.###',
      '##....##',
      '.......#',
      '........',
      '........',
      '##......',
      '##....##',
      '###..###',
      '###.E###',
    ],
  },
  {
    id: 5,
    w: 8, h: 9, moves: 26, colors: 5, oxygen: 19,
    goals: [ESCAPE],
    layout: [
      '###S.###',
      '##....##',
      '#......#',
      '##......',
      '......##',
      '......##',
      '#.......',
      '##....##',
      '###..E##',
    ],
  },
  {
    id: 6,
    w: 9, h: 10, moves: 39, colors: 5, oxygen: 28,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##..i..##',
      '##.......',
      '##.......',
      '..i......',
      '.........',
      '.......##',
      '.......##',
      '##.....##',
      '##...E###',
    ],
  },
  {
    id: 7,
    w: 9, h: 10, moves: 39, colors: 5, oxygen: 28,
    goals: [ESCAPE],
    layout: [
      '###S..###',
      '###....##',
      '##......#',
      '##.......',
      '##.......',
      '##.r.....',
      '........#',
      '##.......',
      '###....##',
      '###...E##',
    ],
  },
  {
    id: 8,
    w: 9, h: 10, moves: 39, colors: 5, oxygen: 28,
    goals: [ESCAPE],
    layout: [
      '###S..###',
      '###...###',
      '##.....##',
      '##.......',
      '##.......',
      '#........',
      '#........',
      '##r....r.',
      '##.....##',
      '##....E##',
    ],
  },
  {
    id: 9,
    w: 9, h: 10, moves: 42, colors: 5, oxygen: 30,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '#......##',
      '.........',
      '.........',
      '##......#',
      '.....n...',
      '..r....i.',
      '#...r.r..',
      '##.....##',
      '###...E##',
    ],
  },
  {
    id: 10,
    w: 9, h: 10, moves: 42, colors: 5, oxygen: 30,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##.....##',
      '......r..',
      '#....r...',
      '.........',
      '.r...i.r.',
      '.........',
      '..r....##',
      '##....###',
      '##...E###',
    ],
  },
  {
    id: 11,
    w: 9, h: 10, moves: 42, colors: 5, oxygen: 30,
    goals: [ESCAPE],
    layout: [
      '###S..###',
      '##r...###',
      '#......##',
      '.........',
      '.........',
      '....rin..',
      '#......##',
      '##.....##',
      '###...r##',
      '###...E##',
    ],
  },
  {
    id: 12,
    w: 9, h: 10, moves: 42, colors: 5, oxygen: 30,
    goals: [ESCAPE],
    layout: [
      '###S..###',
      '##.....##',
      '##..i..i#',
      '##i...n##',
      '.......##',
      '.x.......',
      '....i....',
      '.....r.##',
      '##.n..###',
      '##...E###',
    ],
  },
  {
    id: 13,
    w: 9, h: 11, moves: 46, colors: 6, oxygen: 33,
    goals: [ESCAPE],
    layout: [
      '##.S..###',
      '##n.i.###',
      '#x...x.##',
      '.........',
      '..i..x...',
      '........#',
      '.........',
      '.........',
      '.......n.',
      '##.i...##',
      '##....E##',
    ],
  },
  {
    id: 14,
    w: 9, h: 11, moves: 46, colors: 6, oxygen: 33,
    goals: [ESCAPE, { type: 'color', color: 1, count: 18 }],
    layout: [
      '##.S...##',
      '##.n..x##',
      '........#',
      '....i...#',
      '...ii....',
      '#.....x..',
      '#...x....',
      '..x.i....',
      '##.......',
      '##.....##',
      '###...E##',
    ],
  },
  {
    id: 15,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##......#',
      '..i......',
      '.........',
      '##..x.n..',
      '.......n.',
      '..i.x....',
      '..nn...i.',
      '.x.....##',
      '##....###',
      '##...E###',
    ],
  },
  {
    id: 16,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '###S...##',
      '##.I.r.##',
      '#......n#',
      '.r......#',
      '.........',
      '..i......',
      '...x...##',
      '...niI...',
      '.........',
      '##...I.##',
      '##....E##',
    ],
  },
  {
    id: 17,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '###S...##',
      '###....n#',
      '##...i...',
      '.n..x....',
      '......i..',
      '.........',
      '...Rr....',
      '.......x.',
      '#R.....##',
      '##x....##',
      '##....E##',
    ],
  },
  {
    id: 18,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S..###',
      '##.....##',
      '.....xx.#',
      '.n.x.n...',
      '##.n.....',
      '.I.x..R..',
      '..i......',
      '.........',
      '##...i...',
      '##.....##',
      '##....E##',
    ],
  },
  {
    id: 19,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '###S..###',
      '###n..###',
      '##...n.##',
      '.i..n.x##',
      '....R..##',
      '##.R.....',
      '##.xr....',
      '#........',
      '#........',
      '##.....##',
      '###...E##',
    ],
  },
  {
    id: 20,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '###S...##',
      '##..xn.##',
      '#........',
      '.........',
      '.n...i...',
      '......nr.',
      '..Rr.....',
      '....I...#',
      '#x......#',
      '##...n.##',
      '###...E##',
    ],
  },
  {
    id: 21,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S..###',
      '##n.R..##',
      '#.......#',
      '#........',
      '.x...I...',
      '.I....rn.',
      '.........',
      '.......n.',
      '......R.#',
      '##.n..i##',
      '##...E###',
    ],
  },
  {
    id: 22,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '###S...##',
      '###.n..##',
      '##.....x#',
      '.....i..#',
      '..n......',
      '.....r...',
      '.........',
      '...r..nn.',
      '#.i......',
      '##I.i..##',
      '##....E##',
    ],
  },
  {
    id: 23,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE, { type: 'color', color: 3, count: 20 }],
    layout: [
      '##.S..###',
      '##.....##',
      '..n..n..#',
      '........#',
      '...iR..##',
      '..i...i..',
      '.r.......',
      '.........',
      '...n...##',
      '##..i..##',
      '##....E##',
    ],
  },
  {
    id: 24,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S..###',
      '##....###',
      '..I.rxr##',
      '.....i..#',
      '....x....',
      '.....r...',
      '.......##',
      '..i......',
      '...n.....',
      '##....I.#',
      '##....E##',
    ],
  },
  {
    id: 25,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##.n....#',
      '#....rn..',
      '#......##',
      '.........',
      '.........',
      '....x..i.',
      '#........',
      '#i.n.....',
      '##.inR.##',
      '##....E##',
    ],
  },
  {
    id: 26,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##.....##',
      '##...x...',
      '##....nI.',
      '##....x..',
      '.........',
      '.........',
      '.....n...',
      '..I..R...',
      '##.Rnr.##',
      '##....E##',
    ],
  },
  {
    id: 27,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##...x.##',
      '.......##',
      '.x..x....',
      '.r.......',
      '...n.....',
      '.........',
      '#........',
      '##...r...',
      '###.I..##',
      '###...E##',
    ],
  },
  {
    id: 28,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##...x.##',
      '....n....',
      '......i..',
      '....i.I..',
      '....i....',
      '.r.....##',
      '.xI.i..##',
      '#........',
      '##.....##',
      '###...E##',
    ],
  },
  {
    id: 29,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##.....##',
      '.........',
      '..i..xn..',
      '#..x.....',
      '#....n...',
      '....x..##',
      '.n.....##',
      '..r......',
      '##i..n.##',
      '##....E##',
    ],
  },
  {
    id: 30,
    w: 9, h: 11, moves: 47, colors: 6, oxygen: 34,
    goals: [ESCAPE],
    layout: [
      '##.S...##',
      '##.....##',
      '.nnx...x.',
      '##..i....',
      '....i....',
      '..n....n#',
      '#....x...',
      '.........',
      '#........',
      '##.I...##',
      '###...E##',
    ],
  },
];

export const LEVEL_COUNT = LEVELS.length;

export function getLevel(id: number): LevelDef {
  const found = LEVELS.find((l) => l.id === id);
  if (found) return found;
  // 마지막 레벨 이후는 30번을 반복하되 산소를 조금씩 조인다.
  const last = LEVELS[LEVELS.length - 1];
  const over = id - last.id;
  return {
    ...last,
    id,
    moves: Math.max(28, last.moves - Math.min(10, over)),
    oxygen: Math.max(22, (last.oxygen ?? 30) - Math.min(12, over)),
  };
}

/** 레벨 클리어 보상 (진주) */
export function levelReward(levelId: number, stars: number): number {
  return 30 + Math.floor(levelId * 1.5) + (stars - 1) * 15;
}

/**
 * 진행도를 0..1 로 (1단계 = 0, 마지막 단계 = 1).
 *
 * 수심과 장면 연출이 **같은 값**을 봐야 지도의 '320m' 와 그 판의 어둠이 어긋나지 않는다.
 */
export function depthT(id: number): number {
  return Math.max(0, Math.min(1, (id - 1) / Math.max(1, LEVEL_COUNT - 1)));
}

/**
 * 레벨의 수심(m).
 *
 * 진행 = 하강이다. 번호만 있으면 '몇 번째 판'이지만 수심이 붙으면 얼마나 내려왔는지가
 * 읽힌다. 1단계 12m 에서 마지막 640m 까지 지수적으로 깊어진다 — 뒤로 갈수록 한 판의
 * 무게가 커지는 체감과 맞다.
 */
export function depthOf(id: number): number {
  return Math.round((12 * (640 / 12) ** depthT(id)) / 2) * 2;
}

/**
 * 이 레벨 위에 그릴 장면을 고른다.
 *
 * 전 레벨이 탈출 미션이므로 '갇힌 잠수부 + 다가오는 곰치'는 항상 나온다.
 * 앞을 막는 소품만 레이아웃에 깔린 장애물에서 고른다.
 */

/**
 * 수심대별 포식자 경계.
 *
 * 곰치 1~10 · 아귀 11~20 · 촉수 21~30 이 되도록 잡았다. `depthT` 는 (id-1)/29 이라
 * 경계가 반듯한 숫자로 안 떨어진다 — 21단계가 0.6897 이라 문턱을 0.7 로 두면 21이
 * 아귀 쪽에 남는다. 눈으로는 한 단계 차이라 놓치기 쉬워서 테스트로 고정해 둔다.
 */
const ANGLER_FROM = 0.34;
const TENTACLE_FROM = 0.68;

/** 수심 0..1 → 포식자 */
export function predatorFor(depth: number): PredatorKind {
  if (depth < ANGLER_FROM) return 'eel';
  if (depth < TENTACLE_FROM) return 'angler';
  return 'tentacle';
}

export function sceneVariantFor(level: LevelDef): SceneVariant {
  const layout = (level.layout ?? []).join('');
  const ice = (layout.match(/[iI]/g) ?? []).length;
  const rock = (layout.match(/[rR]/g) ?? []).length;
  const net = (layout.match(/n/g) ?? []).length;

  const max = Math.max(ice, rock, net);
  // 앞을 막은 장애물이 하나도 없으면 바위 틈에 낀 잠수부만 보여준다
  if (max === 0) return 'rescue';
  if (max === ice) return 'ice';
  if (max === rock) return 'rock';
  return 'net';
}
