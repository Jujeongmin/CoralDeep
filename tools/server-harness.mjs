/**
 * server.js 로직 검증 하네스. TowerWar `tools/server-harness.mjs` 를 본으로 따랐다.
 *
 * Verse8 에 배포하지 않고 돌려 보려고 $global/$lock/$sender 를 메모리 스텁으로 물린다.
 * server.js 는 export 를 금지당했으므로 소스를 읽어 마지막에 노출 한 줄만 붙여 평가한다
 * (파일 자체는 손대지 않는다). CoralDeep 은 룸이 없는 1인 게임이라 $room/$roomTick 스텁은
 * 아예 안 만든다 — TowerWar 하네스와 갈라지는 지점이 이거다.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

// ── 스텁 ────────────────────────────────────────────────────────
let sender = null;
const userStates = new Map();

/** 분산 락. 하네스는 단일 스레드라 그냥 실행한다 — 락 안에서 도는지만 재현한다. */
const lockCalls = [];
async function $lock(key, fn) {
  lockCalls.push(key);
  return await fn();
}

const $global = {
  async getMyState() {
    return userStates.get(sender.account) ?? null;
  },
  async updateMyState(state) {
    userStates.set(sender.account, { ...state });
    return state;
  },
  async getUserState(account) {
    return userStates.get(account) ?? null;
  },
  async updateUserState(account, state) {
    userStates.set(account, { ...state });
    return state;
  },
};

const ctx = vm.createContext({
  $global,
  $lock,
  get $sender() {
    return sender;
  },
  // server.js 는 setTimeout 도 fetch 도 안 쓴다 (광고 서버 검증 없음, TowerWar 와 같은 결정).
  console, Date, Math, Number, Object, Array, Set, JSON, String, Error,
});
vm.runInContext(src + '\nglobalThis.__Server = Server;', ctx);
const server = new ctx.__Server();

// ── 시나리오 ────────────────────────────────────────────────────
const results = [];
const check = (name, cond, extra) => results.push({ name, ok: !!cond, ...(cond ? {} : { extra }) });

const A = { account: '0xAAA' };
const B = { account: '0xBBB' };
const as = (s) => (sender = s);

/** 계정 하나를 지우고 새로 시작한다. 시나리오끼리 상태가 섞이지 않게 쓴다. */
function reset(account) {
  userStates.delete(account);
}

// 1) 처음 부르면 기본 계정이 생긴다 (localStorage 의 defaultSave() 와 같은 출발선)
as(A);
{
  const acct = await server.getAccount();
  check('새 계정은 진주 300으로 시작', acct.pearls === 300, acct.pearls);
  check('새 계정은 하트가 가득 찼다', acct.hearts === 5, acct.hearts);
  check('새 계정은 1번 레벨까지 열려 있다', acct.highestUnlocked === 1, acct.highestUnlocked);
  check('새 계정은 시작 부스터를 들고 있다', acct.boosters.harpoon === 2, acct.boosters);
  check('저장된 것은 아직 없다 (getAccount 는 안 쓴다)', userStates.get('0xAAA') === undefined);
}

// 2) syncAccount 마이그레이션 — 계정에 한 번도 저장된 적 없으면 로컬 스냅샷을 통째로 받는다
reset('0xAAA');
as(A);
{
  const migrated = await server.syncAccount({
    pearls: 950, stars: 12, highestUnlocked: 7,
    levelStars: { 1: 3, 2: 2, 3: 1 },
    tasksDone: ['zoneA.task1'],
    nickname: '깊바다', lang: 'en',
    boosters: { harpoon: 5, depthCharge: 0, tide: 0, preCurrent: 0, preMine: 0, prePearl: 1 },
  });
  check('마이그레이션: 진주를 그대로 받는다', migrated.pearls === 950, migrated.pearls);
  check('마이그레이션: 별점을 그대로 받는다', migrated.stars === 12, migrated.stars);
  check('마이그레이션: 열린 레벨을 그대로 받는다', migrated.highestUnlocked === 7, migrated.highestUnlocked);
  check('마이그레이션: 레벨별 별점을 받는다', migrated.levelStars[1] === 3 && migrated.levelStars[3] === 1, migrated.levelStars);
  check('마이그레이션: 완료 태스크를 받는다', migrated.tasksDone.includes('zoneA.task1'), migrated.tasksDone);
  check('마이그레이션: 닉네임·언어를 받는다', migrated.nickname === '깊바다' && migrated.lang === 'en', migrated);
  check('마이그레이션: 부스터를 받는다', migrated.boosters.harpoon === 5 && migrated.boosters.prePearl === 1, migrated.boosters);
}

// 2.5) 마이그레이션 patch 에 서버 전용 포인터(lastDaily/lastLevelClear)를 심어도 못 먹는다
//
// 이 둘은 storage.ts 의 SaveData 에 아예 없는 필드다 — 정상 클라이언트는 절대 안 보내지만,
// syncAccount 인자를 조작해 직접 부르면(콘솔 등) 보낼 수 있다. 심어서 곧바로
// claimAdReward('double-coins') 를 불러 공짜 진주를 타낼 수 있는지 본다.
reset('0xCCC');
const C = { account: '0xCCC' };
as(C);
{
  await server.syncAccount({
    pearls: 100,
    lastLevelClear: { levelId: 1, pearls: 999999, doubled: false },
    lastDaily: { day: '2999-01-01', pearls: 999999, doubled: false },
  });
  let err = null;
  try {
    await server.claimAdReward('double-coins');
  } catch (e) {
    err = e.message;
  }
  check(
    '조작된 lastLevelClear 포인터는 안 먹는다 (no_reward)',
    err === 'no_reward',
    err,
  );
  err = null;
  try {
    await server.claimAdReward('daily-chest');
  } catch (e) {
    err = e.message;
  }
  check('조작된 lastDaily 포인터도 안 먹는다', err === 'no_reward' || err === 'ad_daily_cap', err);
}

// 3) syncAccount 래칫 — 두 번째부터는 화폐성 필드가 min-wins 다 (부풀리는 재동기화 차단,
//    소비는 반영)
reset('0xAAA');
as(A);
await server.syncAccount({ pearls: 500, stars: 5, highestUnlocked: 3, levelStars: { 1: 2 } });
{
  const inflated = await server.syncAccount({ pearls: 999999, stars: 999, highestUnlocked: 999 });
  check('재동기화로 진주를 부풀릴 수 없다', inflated.pearls === 500, inflated.pearls);
  check('재동기화로 별을 부풀릴 수 없다', inflated.stars === 5, inflated.stars);
  check('재동기화로 열린 레벨을 부풀릴 수 없다', inflated.highestUnlocked === 3, inflated.highestUnlocked);

  const spent = await server.syncAccount({ pearls: 300 });
  check('로컬에서 쓴 만큼(소비)은 반영된다', spent.pearls === 300, spent.pearls);

  const spentAgainHigher = await server.syncAccount({ pearls: 400 });
  check('한 번 내려간 값은 다시 안 올라간다', spentAgainHigher.pearls === 300, spentAgainHigher.pearls);
}

// 3.5) syncAccount 가 boosters 없이(부분 patch) 불려도 기존 부스터를 안 지운다
//   (cleanBoosters 가 없는 필드를 전부 0으로 채우는 것과 min-wins 가 겹치면 전멸하는
//   버그가 있었다 — 그 회귀를 여기 고정해 둔다)
reset('0xAAA');
as(A);
await server.syncAccount({ pearls: 100, boosters: { harpoon: 4, depthCharge: 2, tide: 0, preCurrent: 0, preMine: 0, prePearl: 0 } });
{
  const noBoosterField = await server.syncAccount({ pearls: 100 });
  check(
    'boosters 없는 patch 는 기존 부스터를 안 건드린다',
    noBoosterField.boosters.harpoon === 4 && noBoosterField.boosters.depthCharge === 2,
    noBoosterField.boosters,
  );
}

// 4) reportLevelClear — 서버가 공식으로 보상을 계산한다 (클라이언트는 액수를 안 보낸다)
//
// 새 계정은 진주 300에서 출발한다(§ defaultAccount, storage.ts 의 defaultSave() 와 맞춘
// 값) — 그래서 여기서는 syncAccount 로 0까지 낮춰 두고 계산을 단순하게 만든다. min-wins
// 래칫이 있어도 "내려가는 것"이므로 그대로 받아들여진다(§ 3의 검사가 이미 그 규칙을 본다).
reset('0xAAA');
as(A);
await server.syncAccount({ pearls: 0 });
{
  // levels.ts 의 levelReward(id, stars) = 30 + floor(id*1.5) + (stars-1)*15 를 그대로 따라간다.
  const r1 = await server.reportLevelClear(1, 3);
  check('1레벨 3별 보상 = 30 + 1 + 30 = 61', r1.pearls === 61, r1.pearls);
  check('별점이 기록된다', r1.levelStars[1] === 3, r1.levelStars);
  check('다음 레벨이 열린다', r1.highestUnlocked === 2, r1.highestUnlocked);
  check('처음 깬 별만큼 stars 재화가 오른다', r1.stars === 3, r1.stars);

  let err = null;
  try {
    await server.reportLevelClear(5, 3);
  } catch (e) {
    err = e.message;
  }
  check('아직 안 열린 레벨은 거부한다 (level_locked)', err === 'level_locked', err);

  const replay = await server.reportLevelClear(1, 3);
  check('같은 별점으로 재도전하면 stars 재화가 또 안 오른다', replay.stars === 3, replay.stars);
  check('재도전해도 코인은 다시 나온다 (승패 검증은 못 하므로)', replay.pearls === 61 + 61, replay.pearls);

  const better = await server.reportLevelClear(2, 2);
  check('2레벨 2별 보상 = 30 + 3 + 15 = 48', better.pearls === 61 + 61 + 48, better.pearls);
  check('3레벨까지 열린다', better.highestUnlocked === 3, better.highestUnlocked);
}

// 5) claimDaily — 스트릭·요일은 서버 시계(UTC)로 판정한다
reset('0xAAA');
as(A);
await server.syncAccount({ pearls: 0 });
{
  const first = await server.claimDaily();
  check('첫 일일 보상은 50 진주 (0번 칸)', first.pearls === 50, first.pearls);
  check('스트릭이 1이 된다', first.dailyStreak === 1, first.dailyStreak);

  let err = null;
  try {
    await server.claimDaily();
  } catch (e) {
    err = e.message;
  }
  check('같은 날 두 번은 거부한다', err === 'already_claimed', err);

  // 하루 이상 건너뛰면 스트릭이 끊긴다. dailyClaimedDay 를 이틀 전으로 되돌려 흉내낸다.
  const stale = { ...userStates.get('0xAAA'), dailyClaimedDay: '2000-01-01' };
  userStates.set('0xAAA', stale);
  const afterGap = await server.claimDaily();
  check('며칠 건너뛰면 스트릭이 끊긴다', afterGap.dailyStreak === 1, afterGap.dailyStreak);

  // 어제 받았다고 하면 스트릭이 이어진다.
  const yesterdayKey = (() => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${d.getUTCDate()}`.padStart(2, '0');
    return `${d.getUTCFullYear()}-${m}-${day}`;
  })();
  userStates.set('0xAAA', { ...userStates.get('0xAAA'), dailyClaimedDay: yesterdayKey });
  const chained = await server.claimDaily();
  check('어제 받았으면 스트릭이 이어진다', chained.dailyStreak === 2, chained.dailyStreak);
  // afterGap 이 이미 0번 칸(50진주)을 한 번 더 받았으므로, 여기서 보는 건 그 위에
  // 1번 칸(80진주 + 하트1)이 더해졌는가다.
  check('2번째 칸 보상 (80진주 + 하트1)', chained.pearls === afterGap.pearls + 80, chained.pearls);
}

// 6) claimAdReward — 고정 지급표 지면
reset('0xAAA');
as(A);
{
  const before = await server.getAccount();
  const r = await server.claimAdReward('extra-star');
  check('extra-star 는 별 1개', r.stars === before.stars + 1, r.stars);

  let err = null;
  try {
    await server.claimAdReward('no-such-placement');
  } catch (e) {
    err = e.message;
  }
  check('모르는 지면은 거부한다', err === 'unknown_placement', err);

  // 하루 상한 (extra-star 는 6회/일, 쿨다운 10분). 실제 호출을 6번 연달아 하면 쿨다운에
  // 먼저 걸리므로(같은 밀리초에 다시 부르는 것과 같다), 카운터를 직접 상한 직전까지
  // 심어 두고 "상한" 조건만 따로 본다 — 쿨다운은 6.5절이 이미 검사한다.
  const beforeCap = userStates.get('0xAAA');
  const today = beforeCap.adCounters['extra-star'].day; // 첫 claimAdReward('extra-star') 호출이 이미 남긴 오늘 날짜 키
  userStates.set('0xAAA', {
    ...beforeCap,
    adCounters: { ...beforeCap.adCounters, 'extra-star': { day: today, count: 6, lastAt: 0 } },
  });
  err = null;
  try {
    await server.claimAdReward('extra-star');
  } catch (e) {
    err = e.message;
  }
  check('하루 상한을 넘기면 거부한다', err === 'ad_daily_cap', err);
}

// 6.5) claimAdReward — 쿨다운이 있는 지면 (piggy-bank-boost, 30분)
reset('0xBBB');
as(B);
{
  const r1 = await server.claimAdReward('piggy-bank-boost');
  check('첫 저금통 부스트는 +150', r1.piggy === 150, r1.piggy);
  let err = null;
  try {
    await server.claimAdReward('piggy-bank-boost');
  } catch (e) {
    err = e.message;
  }
  check('쿨다운 안에 다시 부르면 거부한다', err === 'ad_cooldown', err);

  // 쿨다운이 끝난 것처럼 lastAt 을 되돌린다.
  const st = userStates.get('0xBBB');
  st.adCounters['piggy-bank-boost'].lastAt = Date.now() - 31 * 60 * 1000;
  userStates.set('0xBBB', st);
  const r2 = await server.claimAdReward('piggy-bank-boost');
  check('쿨다운이 지나면 다시 받을 수 있다', r2.piggy === 300, r2.piggy);
}

// 7) claimAdReward — 부스터를 고르는 지면 + 상속 키 방어
reset('0xAAA');
as(A);
{
  // 새 계정은 tide 를 이미 1개 들고 시작한다(defaultAccount) — 여기서 보는 건 광고로 1이
  // 더 올라가 2가 되는가다.
  const r = await server.claimAdReward('free-booster-prelevel', 'tide');
  check('고른 부스터가 올라간다', r.boosters.tide === 2, r.boosters);

  let err = null;
  try {
    await server.claimAdReward('free-booster-ingame', 'dragon');
  } catch (e) {
    err = e.message;
  }
  check('모르는 부스터는 거부한다', err === 'unknown_booster', err);

  for (const bad of ['toString', 'constructor', 'hasOwnProperty']) {
    err = null;
    try {
      await server.claimAdReward('free-booster-ingame', bad);
    } catch (e) {
      err = e.message;
    }
    check(`상속 키 부스터 거부: ${bad}`, err === 'unknown_booster', err);
  }
}

// 8) claimAdReward — daily-chest / double-coins (방금 번 것의 두 배, 서버가 액수를 기억한다)
reset('0xAAA');
as(A);
{
  const daily = await server.claimDaily();
  const doubled = await server.claimAdReward('daily-chest');
  check('일일 보상 2배 지급', doubled.pearls === daily.pearls + 50, doubled.pearls);
  let err = null;
  try {
    await server.claimAdReward('daily-chest');
  } catch (e) {
    err = e.message;
  }
  // daily-chest 는 dailyCap 이 1이라 카운트 상한이 doubled 플래그보다 먼저 막는다 —
  // 결과(다시 못 받는다)는 같지만 걸리는 문턱이 다르다. doubled 플래그 자체가 실제로
  // 갈리는 자리는 하루에 여러 번 부를 수 있는 double-coins 쪽이다 (바로 아래 검사).
  check('같은 날 두 번 더블은 안 된다 (하루 상한이 막는다)', err === 'ad_daily_cap', err);

  const cleared = await server.reportLevelClear(1, 1);
  const doubledLevel = await server.claimAdReward('double-coins');
  check('레벨 보상 2배 지급 = 30+1+0 = 31', doubledLevel.pearls === cleared.pearls + 31, doubledLevel.pearls);
  err = null;
  try {
    await server.claimAdReward('double-coins');
  } catch (e) {
    err = e.message;
  }
  check('같은 레벨 클리어를 두 번 더블은 안 된다', err === 'no_reward', err);
}

// 9) buyBooster / buyHeartRefill / openPiggyBank — 서버가 가격표와 잔액을 쥔다
reset('0xAAA');
as(A);
{
  const start = await server.syncAccount({ pearls: 1000 });
  check('테스트용 진주 세팅', start.pearls === 1000, start.pearls);

  let err = null;
  try {
    await server.buyBooster('dragon');
  } catch (e) {
    err = e.message;
  }
  check('모르는 부스터 구매는 거부', err === 'unknown_booster', err);

  const bought = await server.buyBooster('depthCharge');
  check('depthCharge 구매: 1000 - 250, 인벤토리 +1', bought.pearls === 750 && bought.boosters.depthCharge === 2, bought);

  err = null;
  try {
    await server.buyBooster('prePearl'); // 600원, 잔액 750 이므로 이건 성공해야 한다
  } catch (e) {
    err = e.message;
  }
  const afterPrePearl = await server.getAccount();
  check('잔액이 충분하면 성공한다', err === null && afterPrePearl.pearls === 150, { err, pearls: afterPrePearl.pearls });

  err = null;
  try {
    await server.buyBooster('harpoon'); // 150원, 잔액 150 이므로 정확히 맞아야 성공
  } catch (e) {
    err = e.message;
  }
  check('정확히 맞는 잔액은 성공', err === null, err);

  err = null;
  try {
    await server.buyBooster('harpoon');
  } catch (e) {
    err = e.message;
  }
  check('잔액이 모자라면 거부', err === 'not_enough_pearls', err);
}

// 9.5) 하트 구매
reset('0xBBB');
as(B);
{
  await server.syncAccount({ pearls: 500 });
  // 하트를 먼저 깎아 둬야 리필의 효과가 보인다.
  const st = userStates.get('0xBBB');
  userStates.set('0xBBB', { ...st, hearts: 2, heartsAt: Date.now() });
  const refilled = await server.buyHeartRefill();
  check('하트 리필: 500 - 500 = 0, 하트 5/5', refilled.pearls === 0 && refilled.hearts === 5, refilled);

  let err = null;
  try {
    await server.buyHeartRefill();
  } catch (e) {
    err = e.message;
  }
  check('잔액이 모자라면 거부', err === 'not_enough_pearls', err);
}

// 9.7) 저금통
reset('0xAAA');
as(A);
{
  let err = null;
  try {
    await server.openPiggyBank();
  } catch (e) {
    err = e.message;
  }
  check('덜 찬 저금통은 못 연다', err === 'not_ready', err);

  const st = userStates.get('0xAAA') ?? (await server.getAccount());
  userStates.set('0xAAA', { ...st, piggy: 1200, pearls: 100 });
  const opened = await server.openPiggyBank();
  check('가득 찬 저금통은 열려서 진주로 바뀐다', opened.pearls === 1300 && opened.piggy === 0, opened);
}

// 10) 하트 자연 회복 — 경과 시간만큼만 회복하고, 회복 뒤에는 저장하지 않아도 다시
//     계산해도 같은 값이 나온다 (순수 함수라 저장에 의존하지 않는다)
reset('0xAAA');
as(A);
{
  await server.getAccount(); // 계정 생성만
  const st = { ...(await server.getAccount()), hearts: 2, heartsAt: Date.now() - 45 * 60 * 1000 };
  userStates.set('0xAAA', st);
  // 20분에 1개, 45분 지났으면 2개 회복 → 2+2=4
  const regened = await server.getAccount();
  check('경과 시간만큼 하트가 회복된다 (2 + 2 = 4)', regened.hearts === 4, regened.hearts);
  const regenedAgain = await server.getAccount();
  check('다시 불러도 같은 값 (순수 계산)', regenedAgain.hearts === 4, regenedAgain.hearts);

  const capSt = { ...st, hearts: 4, heartsAt: Date.now() - 999 * 60 * 1000 };
  userStates.set('0xAAA', capSt);
  const capped = await server.getAccount();
  check('자연 회복은 풀(5)에서 멈춘다', capped.hearts === 5, capped.hearts);

  // 상한을 넘겨 들고 있어도 자연 회복이 그 값을 건드리지 않는다 (깎지도, 더하지도 않는다)
  userStates.set('0xAAA', { ...st, hearts: 7, heartsAt: Date.now() - 999 * 60 * 1000 });
  const over = await server.getAccount();
  check('상한을 넘긴 하트는 회복 계산이 건드리지 않는다', over.hearts === 7, over.hearts);
}

// 10.5) 하트 상한 초과 — 광고·일일 보상으로 받은 하트는 풀(5)을 넘겨 쌓인다
reset('0xAAA');
as(A);
{
  const st = { ...(await server.getAccount()), hearts: 5, heartsAt: Date.now() };
  userStates.set('0xAAA', st);
  const rewarded = await server.claimAdReward('refill-hearts');
  check('가득 찬 상태에서 광고로 받으면 6개가 된다', rewarded.hearts === 6, rewarded.hearts);

  userStates.set('0xAAA', { ...rewarded, pearls: 500 });
  const refilled = await server.buyHeartRefill();
  check('풀 충전은 넘겨 든 하트를 깎지 않는다', refilled.hearts === 6, refilled.hearts);
}

// 11) 손으로 고친 계정은 정규화된다
reset('0xAAA');
as(A);
{
  userStates.set('0xAAA', {
    pearls: -50,
    hearts: 999,
    boosters: { harpoon: -3, dragon: 10 },
    highestUnlocked: 0,
    levelStars: { 0: 5, abc: 2, 3: 99 },
    lang: 'fr',
  });
  const norm = await server.getAccount();
  check('음수 진주는 0', norm.pearls === 0, norm.pearls);
  check('하트는 절대 상한(99)을 넘지 않는다', norm.hearts === 99, norm.hearts);
  check('음수 부스터는 0', norm.boosters.harpoon === 0, norm.boosters.harpoon);
  check('모르는 부스터 키는 사라진다', norm.boosters.dragon === undefined, norm.boosters);
  check('열린 레벨은 최소 1', norm.highestUnlocked === 1, norm.highestUnlocked);
  check('레벨 0은 버려진다', norm.levelStars[0] === undefined, norm.levelStars);
  check('별점은 3을 넘지 않는다', norm.levelStars[3] === 3, norm.levelStars);
  check('모르는 언어는 기본값(ko)', norm.lang === 'ko', norm.lang);
}

// 12) 계정은 서로 분리된다
{
  as(A);
  const a = await server.getAccount();
  as(B);
  const b = await server.getAccount();
  check('서로 다른 계정이다', a.account !== b.account, { a: a.account, b: b.account });
}

// 13) $onItemPurchased — 광고제거 구매. **플랫폼이 $sender 문맥 없이 직접 부른다** —
//     그래서 as() 로 세션을 잡지 않고 account 를 인자로 그대로 넣는다. 결과 확인만
//     as(A) 로 세션을 잡아 getAccount()/syncAccount() 를 부른다.
reset('0xAAA');
{
  const wrongProduct = await server.$onItemPurchased({
    account: '0xAAA',
    purchaseId: 'p1',
    productId: 'not_remove_ads',
  });
  check('모르는 상품 ID는 거부한다 (success:false)', wrongProduct.success === false, wrongProduct);

  as(A);
  const before = await server.getAccount();
  check('구매 전에는 광고제거가 꺼져 있다', before.noAds === false, before.noAds);
  check('아직 저장된 것이 없다 (조회만으로는 계정을 안 만든다)', userStates.get('0xAAA') === undefined);

  const result = await server.$onItemPurchased({ account: '0xAAA', purchaseId: 'p1', productId: 'remove_ads' });
  check('정상 결제는 성공으로 응답한다', result.success === true, result);

  const after = await server.getAccount();
  check('광고제거가 켜진다', after.noAds === true, after.noAds);
  check('구매 ID가 기록된다', after.vxPurchaseIds.includes('p1'), after.vxPurchaseIds);

  // 결제 웹훅이 같은 purchaseId 로 두 번 와도(재시도·중복 전달) 두 번 처리하지 않는다.
  // noAds 는 불리언이라 "두 번 켜짐"이 값으로는 안 보이므로, vxPurchaseIds 에 중복이
  // 안 쌓이는가로 실제 중복 처리 여부를 확인한다.
  await server.$onItemPurchased({ account: '0xAAA', purchaseId: 'p1', productId: 'remove_ads' });
  const afterDup = await server.getAccount();
  check(
    '같은 purchaseId 는 중복 처리되지 않는다 (vxPurchaseIds 에 한 번만)',
    afterDup.vxPurchaseIds.filter((id) => id === 'p1').length === 1,
    afterDup.vxPurchaseIds,
  );

  const missingAccount = await server.$onItemPurchased({ account: '', purchaseId: 'p2', productId: 'remove_ads' });
  check('account 가 비어 있으면 거부한다', missingAccount.success === false, missingAccount);

  const missingPurchaseId = await server.$onItemPurchased({ account: '0xAAA', purchaseId: '', productId: 'remove_ads' });
  check('purchaseId 가 비어 있으면 거부한다', missingPurchaseId.success === false, missingPurchaseId);

  // syncAccount 의 patch 화이트리스트(pickClientPatch)에 noAds/vxPurchaseIds 가 없으므로
  // 클라이언트가 재동기화로 값을 건드려도(끄려는 시도) 안 먹는다.
  const afterSync = await server.syncAccount({ pearls: 10, noAds: false, vxPurchaseIds: [] });
  check('syncAccount 로는 광고제거를 끌 수 없다', afterSync.noAds === true, afterSync.noAds);
  check('syncAccount 로는 vxPurchaseIds 를 비울 수 없다', afterSync.vxPurchaseIds.includes('p1'), afterSync.vxPurchaseIds);
}

// 13.5) syncAccount 의 **첫 동기화(마이그레이션)** 로도 noAds 를 심을 수 없다 —
//   조작된 클라이언트가 첫 접속인 척 noAds:true 를 실어 보내는 경로까지 막혀야 한다.
reset('0xDDD');
const D = { account: '0xDDD' };
as(D);
{
  const migrated = await server.syncAccount({ pearls: 10, noAds: true, vxPurchaseIds: ['fake'] });
  check('마이그레이션 patch 로도 noAds 를 켤 수 없다', migrated.noAds === false, migrated.noAds);
  check('마이그레이션 patch 로도 vxPurchaseIds 를 심을 수 없다', migrated.vxPurchaseIds.length === 0, migrated.vxPurchaseIds);
}

// 13.7) 계정끼리 광고제거 상태가 섞이지 않는다 (0xAAA 만 샀다, 0xBBB 는 그대로)
{
  as(B);
  const b = await server.getAccount();
  check('다른 계정은 광고제거의 영향을 안 받는다', b.noAds === false, b.noAds);
}

// ── 결과 ────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'ok ' : 'FAIL'} - ${r.name}`);
  if (!r.ok) console.log('     ', JSON.stringify(r.extra));
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log(`\n${failed.length} FAILED:`);
  for (const r of failed) console.log(` - ${r.name}`);
  process.exit(1);
}
