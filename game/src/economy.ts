// 하트 · 진주 · 부스터 경제 규칙.

import type { BoosterId, SaveData } from './storage.ts';
import { dayKey, getSave, mutateSave } from './storage.ts';
import {
  buyBoosterRemote,
  buyHeartRefillRemote,
  claimDailyRemote,
  openPiggyBankRemote,
  reportLevelClearRemote,
} from './net/serverAccount.ts';

/**
 * 하트 풀 크기. **자연 회복이 멈추는 지점**이지 보유 상한이 아니다 —
 * 일일 보상·광고·룰렛으로 받은 하트는 이 값을 넘겨 쌓인다 (`addHearts`).
 */
export const MAX_HEARTS = 5;
export const HEART_REGEN_MS = 20 * 60 * 1000; // 20분에 1개

/**
 * 하트 풀 충전 가격.
 *
 * 파는 자리는 하트 모달 하나다 — 하트가 없어서 막힌 사람은 상점이 아니라 거기서 막히므로,
 * "막혔다 → 바로 살 수 있다"가 한 화면 안에서 끝난다.
 */
export const HEART_REFILL_PRICE = 500;

/**
 * 개발 빌드에서는 하트를 무제한으로 둔다.
 *
 * 연출을 확인하려면 같은 레벨을 수십 번 들어가야 하는데 20분에 하나씩 차는 하트로는
 * 검증 자체가 막힌다. `import.meta.env.DEV` 는 `vite build` 에서 false 로 상수 치환되고
 * 이 분기는 통째로 사라지므로 배포본에는 들어가지 않는다.
 *
 * 개발 중에도 하트 소모를 보고 싶으면 URL 에 `?hearts` 를 붙인다.
 */
function devInfiniteHearts(): boolean {
  if (!import.meta.env?.DEV) return false;
  if (typeof location !== 'undefined' && location.search.includes('hearts')) return false;
  return true;
}

export interface HeartState {
  hearts: number;
  /** 다음 하트까지 남은 ms. 가득 찼거나 무한 하트면 0 */
  msToNext: number;
  infinite: boolean;
  infiniteMsLeft: number;
}

/** 경과 시간만큼 하트를 회복시키고 현재 상태를 돌려준다. */
export function refreshHearts(now: number = Date.now()): HeartState {
  const save = getSave();
  const infinite = devInfiniteHearts() || save.infiniteHeartsUntil > now;

  if (save.hearts >= MAX_HEARTS) {
    mutateSave((s) => {
      s.heartsAt = now;
    });
    return {
      hearts: save.hearts,
      msToNext: 0,
      infinite,
      infiniteMsLeft: Math.max(0, save.infiniteHeartsUntil - now),
    };
  }

  const elapsed = Math.max(0, now - save.heartsAt);
  const gained = Math.floor(elapsed / HEART_REGEN_MS);
  if (gained > 0) {
    mutateSave((s) => {
      s.hearts = Math.min(MAX_HEARTS, s.hearts + gained);
      s.heartsAt = s.hearts >= MAX_HEARTS ? now : s.heartsAt + gained * HEART_REGEN_MS;
    });
  }

  const cur = getSave();
  const msToNext =
    cur.hearts >= MAX_HEARTS ? 0 : Math.max(0, HEART_REGEN_MS - (now - cur.heartsAt));

  return {
    hearts: cur.hearts,
    msToNext,
    infinite,
    infiniteMsLeft: Math.max(0, cur.infiniteHeartsUntil - now),
  };
}

export function canPlay(now: number = Date.now()): boolean {
  const state = refreshHearts(now);
  return state.infinite || state.hearts > 0;
}

/** 레벨 진입 시 하트 1개 소모. 무한 하트면 소모하지 않는다. */
export function spendHeart(now: number = Date.now()): boolean {
  const state = refreshHearts(now);
  if (state.infinite) return true;
  if (state.hearts <= 0) return false;
  mutateSave((s) => {
    if (s.hearts >= MAX_HEARTS) s.heartsAt = now;
    s.hearts -= 1;
  });
  return true;
}

/**
 * 하트를 더한다. **가득 찬 상태에서 받아도 버리지 않는다** — 5/5 에서 일일 보상이나
 * 광고로 받은 하트는 6, 7 … 로 그대로 쌓인다.
 *
 * 예전에는 `MAX_HEARTS` 로 잘랐다. 그러면 가득 찬 사람에게는 일일 보상의 하트 칸과
 * 광고 보상이 아무 일도 안 하는 버튼이 된다 — 받았다는 토스트는 뜨는데 숫자는 그대로다.
 * 받은 것은 받은 대로 준다.
 *
 * 상한을 넘은 만큼은 **자연 회복으로는 절대 안 생긴다** (`refreshHearts` 는 `MAX_HEARTS`
 * 에서 멈춘다). 넘겨 받은 하트는 써서 상한 아래로 내려가야 회복 타이머가 다시 돈다.
 */
export function addHearts(n: number, now: number = Date.now()): void {
  refreshHearts(now);
  mutateSave((s) => {
    if (s.hearts >= MAX_HEARTS) s.heartsAt = now;
    s.hearts += n;
  });
}

/** 하트 풀 충전(진주 결제). 이미 상한을 넘겨 들고 있으면 깎지 않는다. */
export function fillHearts(now: number = Date.now()): void {
  mutateSave((s) => {
    s.hearts = Math.max(s.hearts, MAX_HEARTS);
    s.heartsAt = now;
  });
}

// 무한 하트는 판매하지 않는다.
//
// 하트 상품을 '풀 충전'과 '60분 무제한' 둘로 나눠 팔면 무엇을 사야 하는지가 안 읽히고,
// 무제한을 켠 동안에는 하트라는 제약 자체가 사라져 레벨 설계의 압박이 무의미해진다.
// 지금은 하트 상품이 하나다: **진주 500 = 하트 5/5**.
//
// `infiniteHeartsUntil` 은 읽기만 남겨둔다 — 예전에 구매해 아직 시간이 남은 저장을
// 그대로 존중해야 하기 때문이다. 새로 켜는 경로는 개발용 `devInfiniteHearts()` 뿐이다.

// ---- 진주 ----

export function addPearls(n: number): void {
  mutateSave((s) => {
    s.pearls += n;
    // 소비하지 않은 진주의 일부가 저금통에 쌓인다 (저금통 = 광고/결제 유도 지점)
    s.piggy = Math.min(PIGGY_CAP, s.piggy + Math.ceil(n * 0.3));
  });
}

export function spendPearls(n: number): boolean {
  if (getSave().pearls < n) return false;
  mutateSave((s) => {
    s.pearls -= n;
  });
  return true;
}

export const PIGGY_CAP = 1200;

/** 저금통이 꽉 찼는가 (열 수 있는가) */
export function piggyReady(): boolean {
  return getSave().piggy >= PIGGY_CAP;
}

// ---- 불가사리 (수족관 복원 재화) ----

export function addStars(n: number): void {
  mutateSave((s) => {
    s.stars += n;
  });
}

export function spendStars(n: number): boolean {
  if (getSave().stars < n) return false;
  mutateSave((s) => {
    s.stars -= n;
  });
  return true;
}

// ---- 부스터 ----

export const BOOSTER_PRICE: Record<BoosterId, number> = {
  harpoon: 150,
  depthCharge: 250,
  tide: 200,
  preCurrent: 300,
  preMine: 400,
  prePearl: 600,
};

export function addBooster(id: BoosterId, n = 1): void {
  mutateSave((s) => {
    s.boosters[id] = (s.boosters[id] ?? 0) + n;
  });
}

export function useBoosterItem(id: BoosterId): boolean {
  if ((getSave().boosters[id] ?? 0) <= 0) return false;
  mutateSave((s) => {
    s.boosters[id] -= 1;
  });
  return true;
}

export function buyBooster(id: BoosterId): boolean {
  if (!spendPearls(BOOSTER_PRICE[id])) return false;
  addBooster(id, 1);
  // 계정 서버에도 같은 구매를 알린다. 로컬은 이미 위에서 끝났으므로(오프라인 우선)
  // 이 호출은 배경에서 최선노력으로 돈다 — 실패해도 이 기기의 플레이는 안 막힌다.
  buyBoosterRemote(id);
  return true;
}

// ---- 일일 보상 ----

export const DAILY_REWARDS: { pearls: number; booster?: BoosterId; hearts?: number }[] = [
  { pearls: 50 },
  { pearls: 80, hearts: 1 },
  { pearls: 120, booster: 'harpoon' },
  { pearls: 150, hearts: 2 },
  { pearls: 200, booster: 'depthCharge' },
  { pearls: 260, booster: 'tide' },
  { pearls: 400, booster: 'prePearl' },
];

export function dailyAvailable(now: number = Date.now()): boolean {
  return getSave().dailyClaimedDay !== dayKey(now);
}

export function claimDaily(now: number = Date.now()): { index: number; pearls: number } {
  const save = getSave();
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  const streak = save.dailyClaimedDay === yesterday ? save.dailyStreak : 0;
  const index = streak % DAILY_REWARDS.length;
  const reward = DAILY_REWARDS[index];

  mutateSave((s) => {
    s.dailyClaimedDay = dayKey(now);
    s.dailyStreak = streak + 1;
  });
  addPearls(reward.pearls);
  if (reward.hearts) addHearts(reward.hearts, now);
  if (reward.booster) addBooster(reward.booster, 1);

  // 계정 서버도 스트릭을 자기 시계(UTC)로 따로 센다 — 자정 부근에서 어느 칸을
  // 받았는지가 살짝 어긋날 수 있다는 한계가 있다 (claimDailyRemote 주석 참고).
  claimDailyRemote();

  return { index, pearls: reward.pearls };
}

// ---- 룰렛 ----

export interface WheelSlot {
  kind: 'pearls' | 'booster' | 'hearts' | 'stars';
  amount: number;
  booster?: BoosterId;
}

export const WHEEL: WheelSlot[] = [
  { kind: 'pearls', amount: 50 },
  { kind: 'booster', amount: 1, booster: 'harpoon' },
  { kind: 'pearls', amount: 120 },
  { kind: 'hearts', amount: 1 },
  { kind: 'pearls', amount: 200 },
  { kind: 'booster', amount: 1, booster: 'depthCharge' },
  { kind: 'stars', amount: 1 },
  { kind: 'booster', amount: 1, booster: 'prePearl' },
];

export function wheelFreeAvailable(now: number = Date.now()): boolean {
  return getSave().wheelFreeDay !== dayKey(now);
}

export function markWheelFreeUsed(now: number = Date.now()): void {
  mutateSave((s) => {
    s.wheelFreeDay = dayKey(now);
  });
}

export function grantWheel(slot: WheelSlot, now: number = Date.now()): void {
  switch (slot.kind) {
    case 'pearls':
      addPearls(slot.amount);
      break;
    case 'hearts':
      addHearts(slot.amount, now);
      break;
    case 'stars':
      addStars(slot.amount);
      break;
    case 'booster':
      if (slot.booster) addBooster(slot.booster, slot.amount);
      break;
  }
}

/** 레벨 클리어 기록. 이미 더 좋은 별이 있으면 유지한다. */
export function recordLevelClear(levelId: number, stars: number, save: SaveData = getSave()): number {
  const prev = save.levelStars[levelId] ?? 0;
  const gainedStars = Math.max(0, stars - prev);
  mutateSave((s) => {
    s.levelStars[levelId] = Math.max(prev, stars);
    s.highestUnlocked = Math.max(s.highestUnlocked, levelId + 1);
    s.stars += gainedStars;
  });
  // 보상 진주는 호출부(screens/level.ts)가 levelReward(levelId, stars) 로 따로 계산해
  // addPearls 한다 — 계정 서버도 같은 공식으로 스스로 계산하므로(server.js 의
  // reportLevelClear) 여기서는 levelId/stars 만 알리면 된다. 승패 자체(보드를 정말
  // 깼는가)는 서버가 검증하지 않는다 — 매치3 시뮬레이션을 옮기지 않는 한 볼 방법이
  // 없다는 한계를 그대로 안고 간다(server.js 머리말 참고).
  reportLevelClearRemote(levelId, stars);
  return gainedStars;
}

// ---- 하트 풀 충전 (진주 결제) ----

/**
 * 진주로 하트 풀을 채운다.
 *
 * **이미 가득 찼으면 아무것도 팔지 않는다.** 채울 칸이 없는데 결제만 되면 진주 500 이
 * 사라지고 화면은 그대로다 — 사용자 눈에는 돈만 먹은 고장이다. 화면(하트 모달)도
 * 이 경우 버튼을 비활성으로 그리지만, 여기서도 막아 둔다: 파는 자리가 하나뿐이라도
 * 결제를 실제로 수행하는 곳은 여기라, 판단을 화면에만 맡기면 호출 경로가 하나 늘 때
 * 같은 구멍이 다시 열린다.
 */
export function buyHeartRefill(price: number, now: number = Date.now()): boolean {
  if (getSave().hearts >= MAX_HEARTS) return false;
  if (!spendPearls(price)) return false;
  fillHearts(now);
  buyHeartRefillRemote();
  return true;
}

// ---- 저금통 ----

/** 저금통을 비우고 쌓인 진주를 받는다. 덜 찼으면 아무 일도 안 하고 0을 돌려준다. */
export function openPiggyBank(): number {
  const amount = getSave().piggy;
  if (amount < PIGGY_CAP) return 0;
  mutateSave((s) => {
    s.piggy = 0;
  });
  addPearls(amount);
  openPiggyBankRemote();
  return amount;
}
