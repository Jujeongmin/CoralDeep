// 광고 지면 정의와 빈도 제어.
//
// 광고를 많이 붙이되 사용자가 도망가지 않게 하려면 지면마다 쿨다운과 일일 상한이 필요하다.
// 여기서 한 곳에 모아 관리한다 — 화면 코드는 canShow()/noteShown() 만 부른다.

import { dayKey, getSave, mutateSave } from './storage.ts';

export type PlacementId =
  | 'revive-extra-moves' // 실패 시 이동 +5
  | 'oxygen-refill' // 산소 고갈 시 산소통 보충 (구조 미션)
  | 'refill-hearts' // 하트 1개
  | 'free-booster-prelevel' // 레벨 시작 전 부스터 무료
  | 'free-booster-ingame' // 인게임 부스터 무료 1회
  | 'double-coins' // 클리어 보상 2배
  | 'extra-star' // 불가사리 1개
  | 'daily-chest' // 일일 보상 상자 2배
  | 'lucky-wheel-spin' // 룰렛 추가 스핀
  | 'shop-free-coin' // 상점 무료 진주
  | 'piggy-bank-boost'; // 저금통 보너스

export interface PlacementDef {
  id: PlacementId;
  /** 하루 최대 시청 횟수 */
  dailyCap: number;
  /** 같은 지면 재시청까지 최소 간격 (ms) */
  cooldownMs: number;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const PLACEMENTS: Record<PlacementId, PlacementDef> = {
  'revive-extra-moves': { id: 'revive-extra-moves', dailyCap: 20, cooldownMs: 0 },
  'oxygen-refill': { id: 'oxygen-refill', dailyCap: 20, cooldownMs: 0 },
  // 보상이 '하트 1개'로 줄었으므로 쿨다운을 없앤다.
  //
  // 20분 쿨다운은 하트 자연 회복 주기(`HEART_REGEN_MS`)와 정확히 같다 — 그대로 두면
  // 광고를 봐도 기다리는 것과 속도가 똑같아서 볼 이유가 없다.
  // 대신 일일 상한(5)이 하루에 얻을 수 있는 총량을 잡아준다.
  'refill-hearts': { id: 'refill-hearts', dailyCap: 5, cooldownMs: 0 },
  // 'skip-heart-timer' 는 없앴다.
  //
  // 보상이 '회복 타이머 즉시 완료' = 사실상 하트 1개였는데, `refill-hearts` 가
  // 그대로 하트 1개가 되면서 같은 값을 파는 버튼이 하트 모달에 둘 생겼다.
  // 같은 보상을 두 버튼으로 내밀면 뭘 눌러야 하는지가 안 읽히고, 지면끼리 상한을
  // 우회하는 통로도 된다. 하트 관련 보상형 지면은 `refill-hearts` 하나다.
  'free-booster-prelevel': {
    id: 'free-booster-prelevel',
    dailyCap: 15,
    cooldownMs: 0,
  },
  'free-booster-ingame': {
    id: 'free-booster-ingame',
    dailyCap: 15,
    cooldownMs: 0,
  },
  'double-coins': { id: 'double-coins', dailyCap: 20, cooldownMs: 0 },
  'extra-star': { id: 'extra-star', dailyCap: 6, cooldownMs: 10 * MIN },
  'daily-chest': { id: 'daily-chest', dailyCap: 1, cooldownMs: 0 },
  'lucky-wheel-spin': { id: 'lucky-wheel-spin', dailyCap: 5, cooldownMs: 3 * MIN },
  'shop-free-coin': { id: 'shop-free-coin', dailyCap: 6, cooldownMs: 4 * HOUR },
  'piggy-bank-boost': { id: 'piggy-bank-boost', dailyCap: 3, cooldownMs: 30 * MIN },
  // 'aquarium-return' 은 없앴다.
  //
  // 수족관은 이 게임의 보상 화면이다 — 모은 불가사리로 뭘 복원할지 보러 오는 자리.
  // 그 앞에 광고를 세우면 보상을 받으러 가는 길에 통행료를 물리는 꼴이라,
  // 들르는 빈도가 줄고 메타 진행 자체가 죽는다.
};

// SDK 가 이 환경에서는 광고를 못 튼다(unsupported_env)고 답하면 세션 동안 래치한다
// (ads.ts, 프로덕션에서만 건다). 되돌릴 방법이 없어서 지면마다 따로 잠그지 않고
// canShow() 한 곳에서 전부 막는다 -- 안 그러면 열두 지면 버튼이 하나씩 눌러 봐야만
// 죽은 걸 알 수 있는데, 그런 버튼은 고장으로 읽힌다.
let unsupportedEnv = false;

/** ads.ts 가 unsupported_env 를 받았을 때 부른다. 이후 이 세션에서는 모든 지면이 닫힌다. */
export function setAdsUnsupported(): void {
  unsupportedEnv = true;
}

// ---- 재고 없음(no fill) 백오프 ----
//
// 광고 네트워크가 "지금 틀 광고가 없다"(AdSense no fill / frequency cap)고 답하는 일이
// 있다. SDK 에는 미리 물어볼 수 있는 준비 상태 API 가 없어서(showRewarded 하나뿐),
// 그것을 알 수 있는 시점은 **한 번 요청해 본 뒤**다. 그러면 그 다음부터가 문제다 —
// 재고가 없는 동안 버튼을 그대로 두면 누를 때마다 빈 광고 창이 떴다 사라지고,
// 사용자는 "광고가 고장났다"로 읽는다.
//
// 그래서 no fill 을 한 번 받으면 잠깐 동안 모든 지면을 닫는다. 지면 하나가 아니라
// 전부 닫는 이유는 재고가 계정·세션 단위로 비기 때문이다 — 지면만 바꿔 다시 눌러도
// 같은 답이 온다. `unsupportedEnv` 와 달리 **시간이 지나면 저절로 풀린다**: 재고는
// 채워지는 것이라 세션 내내 잠글 이유가 없다.
const NOT_READY_BACKOFF_MS = 5 * MIN;
let adsNotReadyUntil = 0;

/** ads.ts 가 no fill(= 재고 없음)을 받았을 때 부른다. */
export function noteAdsNotReady(now: number = Date.now()): void {
  adsNotReadyUntil = now + NOT_READY_BACKOFF_MS;
}

/** 재고 없음 백오프가 풀릴 때까지 남은 ms (0 = 지금 요청해도 된다) */
export function adsNotReadyLeft(now: number = Date.now()): number {
  return Math.max(0, adsNotReadyUntil - now);
}

function counterFor(id: string, now: number): { day: string; count: number; lastAt: number } {
  const save = getSave();
  const c = save.adCounters[id];
  const today = dayKey(now);
  if (!c || c.day !== today) return { day: today, count: 0, lastAt: c?.lastAt ?? 0 };
  return c;
}

/** 하루 상한·쿨다운만 본다. 광고 SDK 가 이 환경에서 막혔는가(unsupportedEnv)는 안 본다 —
 * canShow() 와 canClaim() 이 이 위에서 갈라진다. */
function withinLimits(id: PlacementId, now: number): boolean {
  const def = PLACEMENTS[id];
  const c = counterFor(id, now);
  if (c.count >= def.dailyCap) return false;
  if (c.lastAt > 0 && now - c.lastAt < def.cooldownMs) return false;
  return true;
}

/** 이 지면의 광고를 지금 보여줄 수 있는가 */
export function canShow(id: PlacementId, now: number = Date.now()): boolean {
  if (unsupportedEnv) return false;
  // 재고가 없다고 답한 직후에는 아예 요청하지 않는다 — 어차피 같은 답이 온다.
  if (adsNotReadyLeft(now) > 0) return false;
  return withinLimits(id, now);
}

/**
 * 광고제거를 산 사람이 이 지면을 지금 '받기'로 쓸 수 있는가.
 *
 * **하루 상한·쿨다운은 canShow() 와 똑같이 적용한다** — 광고제거는 광고 재생을 없앨
 * 뿐, 지면이 버는 재화의 페이스까지 없애면 사실상 "무제한 재화" 상품이 된다
 * (`ui.ts` 의 `adAvailability` 주석 참고).
 *
 * **`unsupportedEnv` 는 안 본다.** 그 래치는 광고 SDK 가 이 환경에서 광고를 못 튼다는
 * 뜻인데(ads.ts), 광고제거 구매자는 애초에 광고를 안 트니 상관없는 사정이다 — 이 래치
 * 때문에 이미 돈을 낸 사람의 '받기' 버튼까지 죽으면 안 된다.
 */
export function canClaim(id: PlacementId, now: number = Date.now()): boolean {
  return withinLimits(id, now);
}

/** 쿨다운이 끝날 때까지 남은 ms (0 = 지금 가능) */
export function cooldownLeft(id: PlacementId, now: number = Date.now()): number {
  const def = PLACEMENTS[id];
  const c = counterFor(id, now);
  if (c.lastAt === 0) return 0;
  return Math.max(0, def.cooldownMs - (now - c.lastAt));
}

/** 오늘 남은 시청 가능 횟수 */
export function remainingToday(id: PlacementId, now: number = Date.now()): number {
  return Math.max(0, PLACEMENTS[id].dailyCap - counterFor(id, now).count);
}

/** 광고를 실제로 본 뒤 호출 (ads.ts 가 자동으로 부른다) */
export function noteShown(id: PlacementId, now: number = Date.now()): void {
  const today = dayKey(now);
  mutateSave((s) => {
    const cur = s.adCounters[id];
    const count = cur && cur.day === today ? cur.count + 1 : 1;
    s.adCounters[id] = { day: today, count, lastAt: now };
  });
}
