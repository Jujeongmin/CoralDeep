/**
 * CoralDeep — Verse8(Agent8) 게임 서버.
 *
 * 규약 (docs.verse8.io/ko/docs/gameserver/sdk/server.js), TowerWar server.js 를 본으로 따랐다:
 *   - 파일명은 정확히 `server.js`, 저장소 루트에 있어야 한다
 *   - `class Server` 를 정의만 하고 **절대 export 하지 않는다** (module.exports / export default 금지)
 *   - `setTimeout` / `setInterval` 금지. 이 파일은 주기 작업이 없어서 `$roomTick` 도 안 쓴다
 *     (룸 개념 자체가 없다 — 아래 "안 하는 것" 참고)
 *   - **클래스 변수는 요청마다 초기화된다.** 그래서 이 파일에는 상태를 들지 않는다 —
 *     모든 상태는 계정 상태(`$global.getMyState`/`updateMyState`)에만 산다
 *   - 배포: `npx -y @agent8/deploy`
 *
 * ── 이 파일이 하는 것과 안 하는 것 ─────────────────────────────
 *
 * **한다**: 계정 하나에 진행도·재화·인벤토리·광고 카운터를 묶어 저장한다. `localStorage` 를
 * 지우거나 기기를 바꿔도 이 계정을 다시 불러오면 그대로다.
 *
 * **안 한다**: 매치메이킹도 룸도 없다 — CoralDeep 은 1인 매치3 게임이라 TowerWar 처럼
 * 실시간으로 맞대는 상대가 없다. 그래서 이 파일에는 `$room`/`$roomTick`/`$sender.roomId`
 * 가 전혀 등장하지 않는다.
 *
 * ── 서버가 진짜로 쥐는 것과, 여전히 클라이언트를 믿는 것 ──────────────
 *
 * 매치3 판 자체(보드, 이동, 점수)는 서버에서 시뮬레이션하지 않는다 — 그러려면 `game/src/core/`
 * 전체를 이 파일에 옮겨야 하는데, 이 파일은 단일 JS라 TS 모듈을 import 할 수 없다
 * (TowerWar server.js 머리말의 같은 항목과 같은 이유). 그래서 "레벨을 정말로 깼는가"는
 * 클라이언트 보고를 믿는다 — `reportLevelClear` 의 주석에 이 한계를 그대로 적었다.
 *
 * 대신 아래는 서버가 값을 직접 계산하거나 자물쇠를 쥐어 클라이언트가 숫자를 못 부르게 한다:
 *   - **레벨 클리어 보상(진주)**: 클라이언트가 액수를 안 보낸다. `levelId`/`stars` 만 받고
 *     서버가 `game/src/levels.ts` 의 `levelReward` 공식을 그대로 계산한다.
 *   - **광고 보상**: 금액·쿨다운·하루 상한을 전부 서버 표에서 정한다. TowerWar 와 같은 이유로
 *     (`claimAdReward` 주석) 광고를 실제로 봤는지는 검증하지 않는다 — 클라이언트가
 *     "봤다"고 부르는 순간 지급한다. 대신 **얼마를, 얼마나 자주**는 서버가 쥔다.
 *   - **부스터·하트 구매, 저금통 열기**: 가격표와 잔액 검사를 서버가 하고 한 번에 원자적으로
 *     깎고 지급한다(계정 자물쇠 `$lock` 안에서).
 *   - **일일 보상**: 스트릭·요일 판정을 서버 시계로 계산한다.
 *   - **광고제거 구매**: 클라이언트는 구매 여부를 자칭할 수 없다. VXShop 결제가 끝나면
 *     Verse8 플랫폼이 `$sender` 문맥 없이 서버에 직접 `$onItemPurchased` 를 불러
 *     `noAds` 를 켠다 — TowerWar server.js 의 `entitlements`/`vxPurchaseIds` 와 같은
 *     자리(§ `$onItemPurchased` 주석). 광고제거를 사도 광고 지면의 하루 상한·쿨다운은
 *     그대로 적용된다 — 서버 표(`AD_PLACEMENTS`)를 그대로 쓴다. 없애는 것은 광고
 *     재생뿐이고, 지면이 버는 재화 페이스는 광고를 계속 보는 사람과 같게 둔다(그렇지
 *     않으면 "광고제거"가 사실상 "무제한 재화"가 된다).
 *
 * 룰렛(`lucky-wheel-spin`)과 부활용 광고(`revive-extra-moves`/`oxygen-refill`)는 이번에는
 * 서버로 안 옮겼다 — 아래 각 자리에 이유를 적어 뒀다. 정직하게 미룬 것이지 숨긴 게 아니다.
 *
 * ── 동기화 모델: getAccount / syncAccount ─────────────────────────
 *
 * 클라이언트는 오프라인에서도 완전히 돌아가야 한다(디자인 요구사항). 그래서 진행도·소비는
 * 여전히 로컬(`game/src/storage.ts`)이 먼저다 — 이 서버는 "매 조작마다 승인받는 권위자"가
 * 아니라 "계정에 매달린 지속 저장소"에 가깝다.
 *
 * `getAccount()` 는 계정을 읽는다(없으면 기본값으로 만든다). `syncAccount(patch)` 는
 * 클라이언트의 로컬 스냅샷 일부를 계정에 반영한다. 두 규칙이 있다:
 *
 *   1. **첫 동기화(계정이 서버에 한 번도 저장된 적 없음)는 통째로 받아들인다.** 이게
 *      마이그레이션이다 — 그 기기에서 `localStorage` 에 쌓아온 진행도가 유일한 기록이므로
 *      서버의(존재하지도 않는) 값과 비교할 이유가 없다.
 *   2. **그 다음부터는 화폐성 필드에 래칫을 건다.** `claimAdReward`/`reportLevelClear`/
 *      `buyBooster` 같은 전용 함수만 값을 **올릴 수 있다.** `syncAccount` 는 그 필드들에서
 *      `min(서버값, 클라이언트값)` 을 취한다 — 즉 로컬에서 쓴 만큼(소비) 내려가는 것은
 *      반영하지만, `syncAccount` 를 직접 불러 값을 부풀리는 것은 막는다. 광고 카운터는
 *      반대 방향(`max`) 이다 — 카운트를 되돌리면 쿨다운이 초기화되므로.
 *
 * **알려진 한계**: 오프라인에서 번 재화·진행도는 그 즉시 전용 함수를 불러 서버에 반영하려
 * 시도하지만(클라이언트가 실패해도 무시하고 넘어가는 fire-and-forget 호출), 완전히
 * 오프라인인 세션이 끝날 때까지 한 번도 온라인으로 안 돌아오면 그 이득은 **그 기기에는
 * 그대로 남지만 계정에는 안 올라간다.** 영구 오프라인 큐(재접속 시 반드시 재생)는 이번에
 * 안 만들었다 — "판을 깬 걸 잃지 않는다"는 로컬에서 항상 지켜지고, "다른 기기에서도
 * 보인다"는 다음에 온라인 상태로 한 번 열어야 채워진다는 뜻이다.
 *
 * **하루 경계는 UTC 다.** 서버는 클라이언트의 시간대를 모른다 — 그래서 일일 보상·광고
 * 하루 상한의 "오늘"은 UTC 자정 기준이다. 사용자의 로컬 자정과 최대 반나절 어긋날 수
 * 있다(예: 로컬로는 자정이 지나 "오늘 다시 가능"인데 서버는 아직 어제로 본다). 화면
 * 문구가 잠깐 어긋나는 정도의 문제이고, 시간대를 클라이언트가 실어 보내게 하는 것은
 * 다음 과제로 남긴다.
 */

// ── 저장 스키마 ────────────────────────────────────────────────────
//
// `game/src/storage.ts` 의 `SaveData` 와 겹치되, 기기별로 남는 게 자연스러운 것들은 뺐다:
//   - `settings.bgmVolume`/`sfxVolume`/`haptics` — 이어폰 유무·기기 진동 지원처럼 그 기기의
//     사정이라 계정을 따라다니면 오히려 낯설다. `settings.lang` 만 계정을 따라간다(언어는
//     사람의 선택이지 기기의 사정이 아니다).
//   - `version`/`updatedAt`/`accountId` — 로컬 저장 포맷의 뼈대일 뿐 계정에 실을 값이 아니다.
//
// 화폐성 필드(재화·인벤토리·진행도)는 **전용 함수로만 올라간다** — 위 머리말의 동기화
// 모델 참고. `defaultAccount` 의 초기값은 `storage.ts` 의 `defaultSave()` 와 맞춰 뒀다
// (새 계정이 신규 게스트 저장과 같은 출발선에 서게).

const MAX_HEARTS = 5;
/**
 * 보유 하트의 절대 상한. `MAX_HEARTS` 는 **자연 회복이 멈추는 지점**일 뿐이고,
 * 일일 보상·광고·룰렛으로 받은 하트는 그 위로 쌓인다 (`economy.ts` 의 `addHearts`).
 *
 * 그래도 무한대로 두지는 않는다 — 손으로 고친 계정이 하트를 10만 개 들고 들어오면
 * 정상 플레이와 구분이 안 된다. 하루에 정상적으로 얻을 수 있는 양(광고 5 + 일일 2 +
 * 룰렛 몇 개)보다 훨씬 위라 실제 플레이를 막지는 않는다.
 */
const HEART_HARD_CAP = 99;
const HEART_REGEN_MS = 20 * 60 * 1000; // 20분에 1개. `economy.ts` 의 같은 이름과 맞춰 둔다.
const HEART_REFILL_PRICE = 500;
const PIGGY_CAP = 1200;

/** `economy.ts` 의 `BOOSTER_PRICE` 와 같아야 한다. 어긋나면 상점 가격표가 거짓말을 한다. */
const BOOSTER_PRICE = {
  harpoon: 150,
  depthCharge: 250,
  tide: 200,
  preCurrent: 300,
  preMine: 400,
  prePearl: 600,
};

function isKnownBooster(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BOOSTER_PRICE, id);
}

/** `storage.ts` 의 `SaveLang` 과 같아야 한다. */
const LANGS = ['ko', 'en', 'ja', 'zh'];
const DEFAULT_LANG = 'ko';

function cleanLang(v) {
  return LANGS.includes(v) ? v : DEFAULT_LANG;
}

/** 닉네임 정리. 지금은 화면에 남 앞에 노출되는 자리(순위표 등)가 없지만, 나중에
 * 생겼을 때 제어문자·과도한 길이가 저장에 남지 않도록 미리 걸러 둔다. */
const NICKNAME_MAX = 24;
function cleanNickname(v) {
  const s = String(v == null ? "" : v);
  let out = "";
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // 제어문자·서식 문자(널부터 유닛분리자, DEL, C1 제어, 폭 없는 공백류,
    // 줄과 문단 구분자, 방향 제어)를 코드값 비교로 걸러낸다.
    // 정규식 리터럴로 문자 범위를 적으면 이 파일을 옮기는 도구 체인 어딘가에서
    // 그 표기를 실제 문자로 바꿔치기해 소스에 제어문자가 섞여 들어간 적이 있어
    // 코드값 비교로 우회한다.
    if (c <= 31 || (c >= 127 && c <= 159)) continue;
    if (c >= 8192 && c <= 8303) continue;
    const isSpace = c === 32;
    if (isSpace && prevSpace) continue;
    prevSpace = isSpace;
    out += s[i];
  }
  return out.trim().slice(0, NICKNAME_MAX);
}

/** `economy.ts` 의 `DAILY_REWARDS` 와 같은 순서·같은 값이어야 한다. */
const DAILY_REWARDS = [
  { pearls: 50 },
  { pearls: 80, hearts: 1 },
  { pearls: 120, booster: 'harpoon' },
  { pearls: 150, hearts: 2 },
  { pearls: 200, booster: 'depthCharge' },
  { pearls: 260, booster: 'tide' },
  { pearls: 400, booster: 'prePearl' },
];

/**
 * 광고 지면. `adPolicy.ts` 의 `PLACEMENTS` 와 겹치되, **서버가 값을 쥐는 지면만** 여기 있다.
 *
 * 뺀 세 지면과 그 이유:
 *   - `lucky-wheel-spin`: 룰렛은 당첨 칸을 뽑고 그 칸으로 원반을 돌리는 애니메이션이
 *     한 함수 안에서 동기적으로 이어진다(`wheelView.ts`). 서버가 당첨 칸을 정하게 하려면
 *     "서버 응답을 기다린 뒤에 돌기 시작"으로 화면 흐름을 바꿔야 하는데, 그러면 오프라인일
 *     때 룰렛 자체가 안 돌아간다 — 이번 작업 범위(오프라인 우선을 지키면서 계정 지속성을
 *     넣는 것)와 부딪힌다. 그래서 이번엔 안 건드렸다: 룰렛은 당첨도 빈도도 그대로
 *     클라이언트가 정하고, 그 결과로 바뀐 재화만 `syncAccount` 로 최선노력 반영된다.
 *   - `revive-extra-moves`/`oxygen-refill`: 보상이 "이동 수/산소 연장"이라 저장에 안 남는
 *     일시적 효과다 — 계정에 실을 화폐가 없으므로 서버가 쥘 "숫자"가 없다. 지면 자체의
 *     쿨다운/상한도 이번엔 로컬에 남겨 뒀다(§ 마이그레이션 문단의 "이번엔 안 옮겼다" 목록).
 */
const AD_PLACEMENTS = {
  'refill-hearts': { dailyCap: 5, cooldownMs: 0 },
  'free-booster-prelevel': { dailyCap: 15, cooldownMs: 0 },
  'free-booster-ingame': { dailyCap: 15, cooldownMs: 0 },
  'extra-star': { dailyCap: 6, cooldownMs: 10 * 60 * 1000 },
  'daily-chest': { dailyCap: 1, cooldownMs: 0 },
  'shop-free-coin': { dailyCap: 6, cooldownMs: 4 * 60 * 60 * 1000 },
  'piggy-bank-boost': { dailyCap: 3, cooldownMs: 30 * 60 * 1000 },
  'double-coins': { dailyCap: 20, cooldownMs: 0 },
};

/**
 * 고정 보상 지면의 지급표. `daily-chest`/`double-coins` 는 고정값이 아니라(방금 번 것의
 * 두 배) `claimAdReward` 안에서 따로 계산한다 — 여기 넣지 않는다.
 *
 * `boosterAny: true` 인 지면은 어느 부스터를 줄지 호출자가 골라 보낸다(`extra` 인자) —
 * `free-booster-prelevel`/`free-booster-ingame` 모달이 부스터별로 버튼을 따로 두기 때문이다.
 */
const AD_GRANTS = {
  'refill-hearts': { hearts: 1 },
  'free-booster-prelevel': { boosterAny: true },
  'free-booster-ingame': { boosterAny: true },
  'extra-star': { stars: 1 },
  'shop-free-coin': { pearls: 120 },
  'piggy-bank-boost': { piggy: 150 },
};

/**
 * 광고제거 상품 ID. **Verse8 대시보드에 등록된 상품 ID와 정확히 같아야 한다.**
 * `game/src/net/vx.ts` 의 `REMOVE_ADS_PRODUCT` 와도 같아야 한다 — 셋(대시보드·이
 * 상수·클라이언트 상수) 중 하나라도 어긋나면 `$onItemPurchased` 가 결제를 못 알아봐서
 * 돈은 나갔는데 지급은 조용히 안 일어난다.
 */
const REMOVE_ADS_PRODUCT = 'remove_ads';

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** UTC 자정 기준 날짜 키. 서버는 사용자의 시간대를 모른다 (머리말 참고). */
function dayKeyUTC(at) {
  const d = new Date(at);
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function defaultAccount(account) {
  const now = Date.now();
  return {
    account,
    nickname: '',
    lang: DEFAULT_LANG,
    // storage.ts 의 defaultSave() 와 맞춘 출발선 — 새 계정이 신규 게스트 저장과 같아야
    // 마이그레이션 전에 우연히 읽혀도(레이스) 이상한 값을 안 보여준다.
    pearls: 300,
    stars: 0,
    hearts: MAX_HEARTS,
    heartsAt: now,
    infiniteHeartsUntil: 0,
    boosters: { harpoon: 2, depthCharge: 1, tide: 1, preCurrent: 1, preMine: 0, prePearl: 0 },
    tasksDone: [],
    levelStars: {},
    highestUnlocked: 1,
    piggy: 0,
    adCounters: {},
    dailyClaimedDay: '',
    dailyStreak: 0,
    wheelFreeDay: '',
    // "방금 번 것의 두 배" 지급용 포인터. claimAdReward 의 daily-chest/double-coins 가 쓴다.
    lastDaily: null,
    lastLevelClear: null,
    // 광고제거 구매 여부. **`$onItemPurchased` 로만 켜진다** — syncAccount 의 patch
    // 화이트리스트(pickClientPatch)에 없으므로 클라이언트가 직접 켤 방법이 없다.
    noAds: false,
    // 이미 처리한 VXShop 구매 ID. 결제 웹훅이 중복 전달돼도(재시도 등) 두 번 지급하지
    // 않는 자물쇠다 — TowerWar server.js 의 같은 이름, 같은 자리.
    vxPurchaseIds: [],
  };
}

function cleanBoosters(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const id of Object.keys(BOOSTER_PRICE)) {
      out[id] = num(raw[id]);
    }
  } else {
    for (const id of Object.keys(BOOSTER_PRICE)) out[id] = 0;
  }
  return out;
}

/** 레벨별 별점(1~3)만 남긴다. 문자열 키를 정수로, 값은 1~3으로 자른다. */
function cleanLevelStars(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw)) {
    const id = Math.floor(Number(key));
    if (!Number.isInteger(id) || id < 1) continue;
    const stars = Math.max(1, Math.min(3, Math.floor(Number(raw[key]) || 0)));
    if (stars >= 1) out[id] = stars;
  }
  return out;
}

/**
 * `syncAccount` 의 patch 에서 받아들일 수 있는 키만 골라낸다.
 *
 * **`lastDaily`/`lastLevelClear` 는 여기 없다.** 이 둘은 클라이언트 저장(`SaveData`)에
 * 아예 없는, 서버 전용 포인터다 — `claimAdReward` 의 daily-chest/double-coins 가 "방금
 * 지불한 금액을 한 번 더 준다"고 판단하는 근거이므로, 마이그레이션(첫 동기화)이라도
 * 그대로 받아들이면 조작된 값을 심어 두고 바로 `claimAdReward('double-coins')` 를 불러
 * 무제한으로 진주를 받아 갈 수 있다. `dailyClaimedDay`/`dailyStreak` 도 같은 이유로 뺐다 —
 * `claimDaily` 만 쓰는 값이라 여기서 받을 이유가 없다.
 *
 * **`noAds`/`vxPurchaseIds` 도 여기 없다.** 결제 상태다 — 화이트리스트에 넣으면
 * `syncAccount({ noAds: true })` 한 번으로 돈 안 내고 광고제거를 자칭할 수 있다.
 * 오직 `$onItemPurchased` 만 이 값을 켠다.
 */
function pickClientPatch(p) {
  const out = {};
  const keys = [
    'nickname', 'lang', 'pearls', 'stars', 'hearts', 'heartsAt', 'infiniteHeartsUntil',
    'boosters', 'tasksDone', 'levelStars', 'highestUnlocked', 'piggy', 'wheelFreeDay',
    'adCounters',
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(p, key)) out[key] = p[key];
  }
  return out;
}

function cleanAdCounters(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of Object.keys(AD_PLACEMENTS)) {
    const c = raw[id];
    if (!c || typeof c !== 'object') continue;
    if (typeof c.day !== 'string') continue;
    out[id] = { day: c.day, count: num(c.count), lastAt: num(c.lastAt) };
  }
  return out;
}

/** 손으로 고친 계정이 들어와도 말이 되는 계정으로 만든다. TowerWar `normalizeAccount` 와 같은 자리. */
function normalizeAccount(raw, account) {
  const d = defaultAccount(account);
  if (!raw || typeof raw !== 'object') return d;
  const levelStars = cleanLevelStars(raw.levelStars);
  return {
    account,
    nickname: cleanNickname(raw.nickname),
    lang: cleanLang(raw.lang),
    pearls: num(raw.pearls),
    stars: num(raw.stars),
    hearts: Math.max(0, Math.min(HEART_HARD_CAP, num(raw.hearts))),
    heartsAt: typeof raw.heartsAt === 'number' && Number.isFinite(raw.heartsAt) ? raw.heartsAt : Date.now(),
    infiniteHeartsUntil: num(raw.infiniteHeartsUntil),
    boosters: cleanBoosters(raw.boosters),
    tasksDone: Array.isArray(raw.tasksDone)
      ? [...new Set(raw.tasksDone.filter((t) => typeof t === 'string'))]
      : [],
    levelStars,
    highestUnlocked: Math.max(1, num(raw.highestUnlocked) || 1),
    piggy: Math.min(PIGGY_CAP, num(raw.piggy)),
    adCounters: cleanAdCounters(raw.adCounters),
    dailyClaimedDay: typeof raw.dailyClaimedDay === 'string' ? raw.dailyClaimedDay : '',
    dailyStreak: num(raw.dailyStreak),
    wheelFreeDay: typeof raw.wheelFreeDay === 'string' ? raw.wheelFreeDay : '',
    lastDaily:
      raw.lastDaily && typeof raw.lastDaily === 'object'
        ? {
            day: String(raw.lastDaily.day ?? ''),
            pearls: num(raw.lastDaily.pearls),
            doubled: raw.lastDaily.doubled === true,
          }
        : null,
    lastLevelClear:
      raw.lastLevelClear && typeof raw.lastLevelClear === 'object'
        ? {
            levelId: num(raw.lastLevelClear.levelId),
            pearls: num(raw.lastLevelClear.pearls),
            doubled: raw.lastLevelClear.doubled === true,
          }
        : null,
    noAds: raw.noAds === true,
    vxPurchaseIds: Array.isArray(raw.vxPurchaseIds)
      ? [...new Set(raw.vxPurchaseIds.filter((id) => typeof id === 'string'))].slice(-50)
      : [],
  };
}

/**
 * 경과 시간만큼 하트를 회복시킨다. `economy.ts` 의 `refreshHearts` 와 같은 공식이다.
 *
 * **저장하지 않고 그때그때 계산한다.** 이 값은 `heartsAt` 과 지금 시각만으로 매번 다시
 * 구할 수 있는 순수 함수라, 읽을 때마다 새로 써 넣을 이유가 없다 — 실제로 하트가 바뀌는
 * 함수(구매·광고·일일 보상)가 저장할 때 이 값을 함께 반영하면 그걸로 충분하다.
 */
function withHeartRegen(a, now) {
  if (a.hearts >= MAX_HEARTS) return a;
  const elapsed = Math.max(0, now - a.heartsAt);
  const gained = Math.floor(elapsed / HEART_REGEN_MS);
  if (gained <= 0) return a;
  const hearts = Math.min(MAX_HEARTS, a.hearts + gained);
  const heartsAt = hearts >= MAX_HEARTS ? now : a.heartsAt + gained * HEART_REGEN_MS;
  return { ...a, hearts, heartsAt };
}

/** 하트를 grant 만큼 더한다. 가득 찬 상태에서 더 받으면 회복 타이머를 지금으로 되돌린다
 * (`economy.ts` 의 `addHearts` 와 같은 규칙 — 안 그러면 꽉 찬 채로 광고를 봐도 다음 회복
 * 타이머가 옛 시각 기준으로 남아 있어 계산이 어긋난다). */
function grantHearts(a, n, now) {
  const heartsAt = a.hearts >= MAX_HEARTS ? now : a.heartsAt;
  return { hearts: Math.min(HEART_HARD_CAP, a.hearts + n), heartsAt };
}

class Server {
  /** 연결 확인용. 배포가 실제로 반영됐는지 보는 데 쓴다. */
  ping() {
    return { ok: true, at: Date.now(), account: $sender.account };
  }

  /** 내 계정. 없으면 만들어서 돌려준다. 하트 회복은 그때그때 계산해서 실어 보낸다. */
  async getAccount() {
    return withHeartRegen(await this.#loadAccount(), Date.now());
  }

  /**
   * 로컬 스냅샷을 계정에 반영한다. 머리말의 "동기화 모델" 문단이 규칙 전체를 설명한다 —
   * 요약하면 **처음 한 번은 통째로 받고, 그 다음부터는 화폐성 필드에 하한(min) 래칫을
   * 걸어 값을 부풀리는 재동기화를 막는다.** 진행도가 없어서 걱정 없는 필드(닉네임·언어·
   * 완료한 태스크)는 그냥 클라이언트를 믿는다.
   *
   * @param patch storage.ts 의 SaveData 에서 계정에 실을 부분만 뽑아 보낸 것. 모르는
   *   키는 무시한다 — 클라이언트가 미래에 새 필드를 보내도 이 서버가 깨지지 않아야 한다.
   */
  async syncAccount(patch) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const account = $sender.account;
      const raw = await $global.getUserState(account);
      const isFirstSync = raw === null || raw === undefined;
      const a = normalizeAccount(raw, account);
      const p = pickClientPatch(patch && typeof patch === 'object' ? patch : {});
      const now = Date.now();

      if (isFirstSync) {
        // 마이그레이션: 이 기기의 로컬 저장이 유일한 기록이므로 받아들인다. `p` 는
        // pickClientPatch 를 거쳐 이미 화이트리스트만 남은 값이고(위 함수 주석 참고),
        // normalizeAccount 를 한 번 더 태워 타입·범위까지 정리한다 (손상된 로컬 저장 방어).
        return await this.#saveAccount(normalizeAccount({ ...a, ...p, account }, account));
      }

      const server = withHeartRegen(a, now);
      const clientLevelStars = cleanLevelStars(p.levelStars);
      const mergedLevelStars = { ...server.levelStars };
      for (const id of Object.keys(clientLevelStars)) {
        // 레벨 별점은 reportLevelClear 로만 올라간다 — 여기서는 하한(min)만 반영해
        // "재동기화로 별점을 자칭"하는 길을 막는다. 서버에 그 레벨 기록이 아직 없으면
        // (min 비교 대상이 없으면) 클라이언트 값도 안 받아들인다 — 같은 이유다.
        if (server.levelStars[id] !== undefined) {
          mergedLevelStars[id] = Math.min(server.levelStars[id], clientLevelStars[id]);
        }
      }

      // patch 에 boosters 자체가 없으면(부분 patch) 손대지 않는다 — cleanBoosters 는
      // 없는 필드를 전부 0으로 채우므로, 여기서 무조건 min 을 취하면 부스터가 하나도
      // 없다고 보낸 것과 같아져 min-wins 가 전부 0으로 쓸어버린다.
      const clientBoosters = p.boosters && typeof p.boosters === 'object' ? cleanBoosters(p.boosters) : null;
      const mergedBoosters = { ...server.boosters };
      if (clientBoosters) {
        for (const id of Object.keys(BOOSTER_PRICE)) {
          mergedBoosters[id] = Math.min(server.boosters[id], clientBoosters[id]);
        }
      }

      const merged = {
        ...server,
        // 화폐성 필드: min-wins. 로컬에서 쓴 만큼(소비) 반영하되, 값을 올리는 재동기화는
        // 안 먹는다 — 올리는 것은 claimAdReward/reportLevelClear/buyBooster 같은 전용
        // 함수만 할 수 있다.
        pearls: Math.min(server.pearls, num(p.pearls ?? server.pearls)),
        stars: Math.min(server.stars, num(p.stars ?? server.stars)),
        piggy: Math.min(server.piggy, Math.min(PIGGY_CAP, num(p.piggy ?? server.piggy))),
        hearts: Math.min(server.hearts, Math.max(0, Math.min(HEART_HARD_CAP, num(p.hearts ?? server.hearts)))),
        // infiniteHeartsUntil 을 지금 새로 켜는 경로는 없다(§ storage.ts 주석) — 그래도
        // 값을 올리는 재동기화를 막아 둔다. 만료 시각이 지나는 것(내려가는 것)만 반영된다.
        infiniteHeartsUntil: Math.min(server.infiniteHeartsUntil, num(p.infiniteHeartsUntil ?? server.infiniteHeartsUntil)),
        boosters: mergedBoosters,
        levelStars: mergedLevelStars,
        highestUnlocked: Math.min(server.highestUnlocked, Math.max(1, num(p.highestUnlocked ?? server.highestUnlocked) || 1)),
        // 진행도·소비 걱정이 없는 필드: 클라이언트를 그대로 믿는다.
        nickname: p.nickname !== undefined ? cleanNickname(p.nickname) : server.nickname,
        lang: p.lang !== undefined ? cleanLang(p.lang) : server.lang,
        tasksDone: Array.isArray(p.tasksDone)
          ? [...new Set([...server.tasksDone, ...p.tasksDone.filter((t) => typeof t === 'string')])]
          : server.tasksDone,
        wheelFreeDay: typeof p.wheelFreeDay === 'string' ? p.wheelFreeDay : server.wheelFreeDay,
        // 광고 카운터·일일 보상 기록은 전용 함수만 쓴다 — 여기서는 아예 안 받는다
        // (patch 에 있어도 무시). 받으면 재동기화 한 번으로 쿨다운·하루 상한이 초기화된다.
      };
      return await this.#saveAccount(merged);
    });
  }

  /**
   * Verse8 가 VXShop 결제를 마친 뒤 서버에서 직접 부른다. **`$sender` 문맥이 아니다** —
   * 플랫폼이 계정을 인자로 실어 보낸다(TowerWar server.js 의 같은 메서드와 같은 자리).
   * 클라이언트는 이 경로를 부를 수 없으므로 구매 여부를 자칭할 방법이 없다 — 지급은
   * 오직 여기서만 일어난다.
   *
   * **`purchaseId` 로 중복 지급을 막는다.** 결제 웹훅은 재시도·중복 전달될 수 있다 —
   * 이미 처리한 `purchaseId` 면 조용히 넘어간다(에러도, 추가 지급도 아니다). 어디까지나
   * `vxPurchaseIds`(최근 50개, TowerWar 와 같은 상한)에 있는지만 본다.
   *
   * 상한이 왜 문제가 안 되는가: 이 계정이 같은 상품을 50번 넘게 살 일은 없다 — 광고제거는
   * 계정당 한 번이면 충분한 상품이라(재구매해도 `noAds` 는 이미 true), 오래된
   * `purchaseId` 가 상한 밖으로 밀려나 다시 처리돼도 실질적인 문제가 없다(다시 `noAds:
   * true` 를 쓸 뿐).
   */
  async $onItemPurchased({ account, purchaseId, productId }) {
    if (!account || !purchaseId || productId !== REMOVE_ADS_PRODUCT) {
      return { success: false };
    }
    await $lock(`acct:${account}`, async () => {
      const raw = await $global.getUserState(account);
      const a = normalizeAccount(raw, account);
      if (a.vxPurchaseIds.includes(purchaseId)) return;
      await $global.updateUserState(account, {
        ...a,
        noAds: true,
        vxPurchaseIds: [...a.vxPurchaseIds, purchaseId].slice(-50),
      });
    });
    return { success: true };
  }

  /**
   * 레벨 클리어 보상. **승패 자체(보드를 실제로 깼는가)는 검증하지 않는다** — 매치3
   * 시뮬레이션 전체를 이 파일로 옮겨야 하는데, 이 파일은 단일 JS라 `game/src/core/` 를
   * import 할 수 없다(TowerWar server.js 의 "서버 권위 아님" 항목과 같은 사정).
   *
   * **대신 서버가 확실히 쥐는 것: 보상 액수.** 클라이언트는 액수를 안 보낸다 — `levelId`
   * 와 `stars` 만 받아 `levels.ts` 의 `levelReward` 공식을 여기서 그대로 계산한다.
   * 클라이언트가 진주를 몇 개 불러도 이 함수를 거치는 한 계정에는 공식대로만 들어간다.
   *
   * **`levelId` 는 이미 열린 레벨까지만 받는다** (`highestUnlocked` 이하). 안 그러면
   * "9999번 레벨을 3별로 깼다"고 불러 한 번에 큰 보상을 타낼 수 있다 — 이미 열린 레벨을
   * 다시 깨서 별을 올리는 정상적인 재도전은 그대로 허용된다.
   */
  async reportLevelClear(levelId, stars) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = withHeartRegen(await this.#loadAccount(), Date.now());
      const id = Math.max(1, Math.floor(Number(levelId) || 1));
      const clampedStars = Math.max(1, Math.min(3, Math.floor(Number(stars) || 1)));
      if (id > a.highestUnlocked) throw new Error('level_locked');

      const pearls = 30 + Math.floor(id * 1.5) + (clampedStars - 1) * 15;
      const prevStars = a.levelStars[id] ?? 0;
      const starsGained = Math.max(0, clampedStars - prevStars);

      return await this.#saveAccount({
        ...a,
        pearls: a.pearls + pearls,
        stars: a.stars + starsGained,
        levelStars: { ...a.levelStars, [id]: Math.max(prevStars, clampedStars) },
        highestUnlocked: Math.max(a.highestUnlocked, id + 1),
        lastLevelClear: { levelId: id, pearls, doubled: false },
      });
    });
  }

  /**
   * 일일 보상. 스트릭·요일 판정을 서버 시계로 한다 — 클라이언트 시계를 믿으면 기기
   * 시각을 앞당겨 하루에 여러 번 받을 수 있다.
   *
   * **오늘·어제는 UTC 기준이다** (머리말의 "하루 경계" 문단 참고).
   */
  async claimDaily() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = withHeartRegen(await this.#loadAccount(), Date.now());
      const now = Date.now();
      const today = dayKeyUTC(now);
      if (a.dailyClaimedDay === today) throw new Error('already_claimed');

      const yesterday = dayKeyUTC(now - 24 * 60 * 60 * 1000);
      const streak = a.dailyClaimedDay === yesterday ? a.dailyStreak : 0;
      const index = streak % DAILY_REWARDS.length;
      const reward = DAILY_REWARDS[index];

      const heartPatch = reward.hearts ? grantHearts(a, reward.hearts, now) : {};
      const boosters = reward.booster
        ? { ...a.boosters, [reward.booster]: a.boosters[reward.booster] + 1 }
        : a.boosters;

      return await this.#saveAccount({
        ...a,
        ...heartPatch,
        pearls: a.pearls + reward.pearls,
        boosters,
        dailyClaimedDay: today,
        dailyStreak: streak + 1,
        lastDaily: { day: today, pearls: reward.pearls, doubled: false },
      });
    });
  }

  /**
   * 광고 보상. **광고를 실제로 봤는지는 검증하지 않는다** (TowerWar server.js 의
   * `claimAdCoins` 와 같은 결정, 같은 이유 — `ads-verifier` 가 광고 직후 `pending` 에
   * 걸리는데 이 파일은 `setTimeout` 을 못 써 지연 재시도를 못 한다). 클라이언트가
   * "다 봤다"고 부르면 그대로 지급한다.
   *
   * **여전히 서버가 쥐는 것: 금액·쿨다운·하루 상한.** `localStorage` 를 지워도 이 계정의
   * 광고 카운터는 그대로다 — 이번 작업이 노린 것이 정확히 이거다("ad counters... the
   * thing a player would most obviously reset by clearing storage").
   *
   * `daily-chest`/`double-coins` 는 고정 지급표가 없다 — 방금 `claimDaily`/
   * `reportLevelClear` 가 지불한 액수를 서버가 기억해 두었다가 그대로 한 번 더 준다.
   * 클라이언트가 액수를 부르게 하면 무한 진주가 된다.
   *
   * @param extra `free-booster-prelevel`/`free-booster-ingame` 전용 — 어느 부스터를
   *   받을지. 그 외 지면에서는 안 쓴다.
   */
  async claimAdReward(placementId, extra) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = withHeartRegen(await this.#loadAccount(), Date.now());
      const def = AD_PLACEMENTS[placementId];
      if (!def) throw new Error('unknown_placement');

      const now = Date.now();
      const today = dayKeyUTC(now);
      const prevCounter = a.adCounters[placementId];
      const counter = prevCounter && prevCounter.day === today
        ? prevCounter
        : { day: today, count: 0, lastAt: prevCounter ? prevCounter.lastAt : 0 };
      if (counter.count >= def.dailyCap) throw new Error('ad_daily_cap');
      if (counter.lastAt > 0 && now - counter.lastAt < def.cooldownMs) throw new Error('ad_cooldown');

      let patch = {};
      if (placementId === 'daily-chest') {
        if (!a.lastDaily || a.lastDaily.day !== today || a.lastDaily.doubled) throw new Error('no_reward');
        patch = { pearls: a.pearls + a.lastDaily.pearls, lastDaily: { ...a.lastDaily, doubled: true } };
      } else if (placementId === 'double-coins') {
        if (!a.lastLevelClear || a.lastLevelClear.doubled) throw new Error('no_reward');
        patch = {
          pearls: a.pearls + a.lastLevelClear.pearls,
          lastLevelClear: { ...a.lastLevelClear, doubled: true },
        };
      } else {
        const grant = AD_GRANTS[placementId];
        if (grant.pearls) patch.pearls = a.pearls + grant.pearls;
        if (grant.stars) patch.stars = a.stars + grant.stars;
        if (grant.piggy) patch.piggy = Math.min(PIGGY_CAP, a.piggy + grant.piggy);
        if (grant.hearts) Object.assign(patch, grantHearts(a, grant.hearts, now));
        if (grant.boosterAny) {
          if (!isKnownBooster(extra)) throw new Error('unknown_booster');
          patch.boosters = { ...a.boosters, [extra]: a.boosters[extra] + 1 };
        }
      }

      return await this.#saveAccount({
        ...a,
        ...patch,
        adCounters: { ...a.adCounters, [placementId]: { day: today, count: counter.count + 1, lastAt: now } },
      });
    });
  }

  /** 부스터 구매. 사면 바로 인벤토리에 들어간다(외형이 아니라 소모품이라 "착용" 개념이 없다). */
  async buyBooster(id) {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      if (!isKnownBooster(id)) throw new Error('unknown_booster');
      const price = BOOSTER_PRICE[id];
      if (a.pearls < price) throw new Error('not_enough_pearls');
      return await this.#saveAccount({
        ...a,
        pearls: a.pearls - price,
        boosters: { ...a.boosters, [id]: a.boosters[id] + 1 },
      });
    });
  }

  /** 하트 풀 충전. `economy.ts` 의 `HEART_REFILL_PRICE` 와 같아야 한다. */
  async buyHeartRefill() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      if (a.pearls < HEART_REFILL_PRICE) throw new Error('not_enough_pearls');
      return await this.#saveAccount({
        ...a,
        pearls: a.pearls - HEART_REFILL_PRICE,
        // 이미 상한을 넘겨 들고 있으면 깎지 않는다 (`economy.ts` 의 `fillHearts` 와 같은 규칙).
        hearts: Math.max(a.hearts, MAX_HEARTS),
        heartsAt: Date.now(),
      });
    });
  }

  /** 저금통을 연다. 가득 찼을 때만(`PIGGY_CAP`) 열 수 있다 — `economy.ts` 의 `piggyReady()` 와 같은 규칙. */
  async openPiggyBank() {
    return await $lock(`acct:${$sender.account}`, async () => {
      const a = await this.#loadAccount();
      if (a.piggy < PIGGY_CAP) throw new Error('not_ready');
      return await this.#saveAccount({ ...a, pearls: a.pearls + a.piggy, piggy: 0 });
    });
  }

  // ── 내부 ───────────────────────────────────────────────────────

  async #loadAccount() {
    return normalizeAccount(await $global.getMyState(), $sender.account);
  }

  /** 유저 상태는 덮어쓰기다 (TowerWar server.js 와 같은 주의) — 항상 계정 전체를 쓴다. */
  async #saveAccount(a) {
    await $global.updateMyState(a);
    return a;
  }
}
