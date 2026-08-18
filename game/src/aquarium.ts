// 메타 진행: 버려진 해저 연구소를 수족관으로 되살린다.
// 레벨을 깨서 얻은 불가사리(stars)로 태스크를 하나씩 완료한다.

import { getSave, mutateSave } from './storage.ts';

/** 수족관 화면에 그릴 장식 종류 */
export type DecorKind =
  | 'glass' // 수조 유리 복구
  | 'sand' // 바닥 모래
  | 'coral' // 산호
  | 'kelp' // 해초
  | 'rock' // 바위
  | 'lamp' // 조명
  | 'wreck' // 난파선
  | 'jelly' // 해파리
  | 'fish' // 물고기 무리
  | 'turtle' // 바다거북
  | 'ray' // 가오리
  | 'whale'; // 심해 고래

export interface Decor {
  kind: DecorKind;
  /** 수조 안 상대 좌표 0..1 */
  x: number;
  y: number;
  scale: number;
  hue: number;
}

export interface AquariumTask {
  id: string;
  zoneId: string;
  ko: string;
  en: string;
  /** 필요한 불가사리 */
  cost: number;
  decor: Decor[];
}

export interface Zone {
  id: string;
  ko: string;
  en: string;
  /** 배경 색상 (윗쪽, 아랫쪽) */
  bg: [string, string];
  tasks: AquariumTask[];
}

function task(
  zoneId: string,
  id: string,
  ko: string,
  en: string,
  cost: number,
  decor: Decor[],
): AquariumTask {
  return { id: `${zoneId}.${id}`, zoneId, ko, en, cost, decor };
}

export const ZONES: Zone[] = [
  {
    id: 'lobby',
    ko: '입구 수조',
    en: 'Entrance Tank',
    bg: ['#0b4c6b', '#052736'],
    tasks: [
      task('lobby', 'glass', '깨진 유리 교체', 'Replace the cracked glass', 1, [
        { kind: 'glass', x: 0.5, y: 0.5, scale: 1, hue: 190 },
      ]),
      task('lobby', 'sand', '바닥 모래 깔기', 'Lay down fresh sand', 1, [
        { kind: 'sand', x: 0.5, y: 0.92, scale: 1, hue: 40 },
      ]),
      task('lobby', 'lamp', '수조 조명 켜기', 'Turn the tank lights on', 2, [
        { kind: 'lamp', x: 0.2, y: 0.08, scale: 1, hue: 50 },
        { kind: 'lamp', x: 0.8, y: 0.08, scale: 1, hue: 50 },
      ]),
      task('lobby', 'kelp', '해초 심기', 'Plant the first kelp', 2, [
        { kind: 'kelp', x: 0.15, y: 0.9, scale: 1.1, hue: 130 },
        { kind: 'kelp', x: 0.86, y: 0.9, scale: 0.9, hue: 140 },
      ]),
      task('lobby', 'fish', '첫 손님 입주 — 흰동가리', 'Welcome the clownfish', 3, [
        { kind: 'fish', x: 0.45, y: 0.45, scale: 1, hue: 25 },
        { kind: 'fish', x: 0.6, y: 0.55, scale: 0.8, hue: 25 },
      ]),
    ],
  },
  {
    id: 'coral',
    ko: '산호 정원',
    en: 'Coral Garden',
    bg: ['#0d5f7a', '#06303f'],
    tasks: [
      task('coral', 'rock', '기반암 배치', 'Set the base rocks', 2, [
        { kind: 'rock', x: 0.25, y: 0.88, scale: 1, hue: 210 },
        { kind: 'rock', x: 0.75, y: 0.9, scale: 1.2, hue: 205 },
      ]),
      task('coral', 'coral1', '분홍 산호 이식', 'Transplant pink coral', 2, [
        { kind: 'coral', x: 0.22, y: 0.84, scale: 1, hue: 340 },
      ]),
      task('coral', 'coral2', '보라 산호 이식', 'Transplant purple coral', 3, [
        { kind: 'coral', x: 0.72, y: 0.86, scale: 1.15, hue: 285 },
      ]),
      task('coral', 'kelp', '해초 숲 확장', 'Grow the kelp forest', 3, [
        { kind: 'kelp', x: 0.4, y: 0.92, scale: 1.3, hue: 120 },
        { kind: 'kelp', x: 0.55, y: 0.92, scale: 1.1, hue: 145 },
      ]),
      task('coral', 'school', '자리돔 무리 입주', 'Introduce a damselfish school', 4, [
        { kind: 'fish', x: 0.35, y: 0.35, scale: 0.7, hue: 200 },
        { kind: 'fish', x: 0.45, y: 0.3, scale: 0.7, hue: 200 },
        { kind: 'fish', x: 0.55, y: 0.38, scale: 0.7, hue: 200 },
        { kind: 'fish', x: 0.65, y: 0.32, scale: 0.7, hue: 200 },
      ]),
    ],
  },
  {
    id: 'jelly',
    ko: '해파리 홀',
    en: 'Jelly Hall',
    bg: ['#3b2a6b', '#140f30'],
    tasks: [
      task('jelly', 'dark', '암막 커튼 설치', 'Install the blackout curtain', 2, [
        { kind: 'glass', x: 0.5, y: 0.5, scale: 1, hue: 265 },
      ]),
      task('jelly', 'uv', 'UV 조명 설치', 'Install the UV lights', 3, [
        { kind: 'lamp', x: 0.5, y: 0.06, scale: 1.4, hue: 280 },
      ]),
      task('jelly', 'moon', '문 젤리 입주', 'Introduce moon jellies', 3, [
        { kind: 'jelly', x: 0.3, y: 0.4, scale: 1, hue: 190 },
        { kind: 'jelly', x: 0.68, y: 0.5, scale: 0.85, hue: 195 },
      ]),
      task('jelly', 'lion', '라이온스메인 입주', 'Introduce a lion’s mane', 4, [
        { kind: 'jelly', x: 0.5, y: 0.3, scale: 1.5, hue: 25 },
      ]),
      task('jelly', 'crowd', '해파리 군무 완성', 'Complete the jelly drift', 4, [
        { kind: 'jelly', x: 0.15, y: 0.6, scale: 0.7, hue: 300 },
        { kind: 'jelly', x: 0.85, y: 0.35, scale: 0.7, hue: 320 },
        { kind: 'jelly', x: 0.42, y: 0.72, scale: 0.6, hue: 210 },
      ]),
    ],
  },
  {
    id: 'wreck',
    ko: '난파선 구역',
    en: 'Shipwreck Wing',
    bg: ['#1c4a52', '#07222a'],
    tasks: [
      task('wreck', 'hull', '선체 인양', 'Raise the hull', 3, [
        { kind: 'wreck', x: 0.5, y: 0.72, scale: 1, hue: 30 },
      ]),
      task('wreck', 'mast', '돛대 세우기', 'Right the mast', 3, [
        { kind: 'wreck', x: 0.35, y: 0.6, scale: 0.6, hue: 35 },
      ]),
      task('wreck', 'coral', '선체에 산호 정착', 'Let coral settle on the wreck', 4, [
        { kind: 'coral', x: 0.6, y: 0.68, scale: 0.8, hue: 15 },
        { kind: 'coral', x: 0.42, y: 0.74, scale: 0.7, hue: 350 },
      ]),
      task('wreck', 'ray', '가오리 입주', 'Introduce the stingray', 4, [
        { kind: 'ray', x: 0.5, y: 0.42, scale: 1, hue: 220 },
      ]),
      task('wreck', 'turtle', '바다거북 입주', 'Welcome the sea turtle', 5, [
        { kind: 'turtle', x: 0.3, y: 0.3, scale: 1, hue: 110 },
      ]),
    ],
  },
  {
    id: 'abyss',
    ko: '심해관',
    en: 'Abyss Hall',
    bg: ['#08243a', '#010a12'],
    tasks: [
      task('abyss', 'pressure', '수압 격벽 보강', 'Reinforce the pressure wall', 4, [
        { kind: 'glass', x: 0.5, y: 0.5, scale: 1, hue: 210 },
      ]),
      task('abyss', 'vent', '열수구 재현', 'Recreate the hydrothermal vent', 4, [
        { kind: 'rock', x: 0.5, y: 0.9, scale: 1.4, hue: 15 },
      ]),
      task('abyss', 'glow', '발광 생물 도입', 'Add the bioluminescents', 5, [
        { kind: 'jelly', x: 0.22, y: 0.5, scale: 0.6, hue: 165 },
        { kind: 'jelly', x: 0.78, y: 0.45, scale: 0.6, hue: 165 },
        { kind: 'fish', x: 0.5, y: 0.6, scale: 0.6, hue: 165 },
      ]),
      task('abyss', 'ray2', '심해 가오리 입주', 'Introduce the deep-sea ray', 5, [
        { kind: 'ray', x: 0.65, y: 0.35, scale: 1.2, hue: 190 },
      ]),
      task('abyss', 'whale', '고래 홀로그램 개관', 'Open the whale hologram', 6, [
        { kind: 'whale', x: 0.5, y: 0.35, scale: 1, hue: 200 },
      ]),
    ],
  },
];

export const ALL_TASKS: AquariumTask[] = ZONES.flatMap((z) => z.tasks);
export const TOTAL_STAR_COST = ALL_TASKS.reduce((sum, t) => sum + t.cost, 0);

export function isTaskDone(id: string): boolean {
  return getSave().tasksDone.includes(id);
}

/** 지금 진행할 수 있는 (아직 안 끝난) 태스크. 앞에서부터 순서대로 열린다. */
export function nextTasks(limit = 3): AquariumTask[] {
  const done = new Set(getSave().tasksDone);
  return ALL_TASKS.filter((t) => !done.has(t.id)).slice(0, limit);
}

export function currentZone(): Zone {
  const done = new Set(getSave().tasksDone);
  const zone = ZONES.find((z) => z.tasks.some((t) => !done.has(t.id)));
  return zone ?? ZONES[ZONES.length - 1];
}

/** 완료 처리. 불가사리는 호출부에서 미리 차감한다. */
export function completeTask(id: string): void {
  mutateSave((s) => {
    if (!s.tasksDone.includes(id)) s.tasksDone.push(id);
  });
}

/** 지금까지 배치된 모든 장식 */
export function placedDecor(): Decor[] {
  const done = new Set(getSave().tasksDone);
  return ALL_TASKS.filter((t) => done.has(t.id)).flatMap((t) => t.decor);
}

export function progressPercent(): number {
  const done = getSave().tasksDone.length;
  return Math.round((done / ALL_TASKS.length) * 100);
}
