// Verse8(Agent8) 계정 서버와의 연결.
//
// 저장소 루트의 `server.js` 짝이다. 함수 이름이 양쪽에 하드코딩되므로 여기 상수와
// `server.js` 의 메서드 이름이 어긋나면 조용히 아무 일도 안 일어난다 (TowerWar
// `net/agent8.ts` 머리말과 같은 주의).
//
// ── 오프라인 우선을 지키는 방법 ────────────────────────────────────
//
// 이 게임은 지금까지 네트워크가 아예 없이 돌았다(디자인 요구사항: 접속 전에도, 연결이
// 끊겨도 게임이 멈추면 안 된다). 그래서 여기 있는 함수는 전부 **로컬이 이미 끝낸 일을
// 뒤늦게 서버에 알리는 배경 호출**이다 — 성공하면 서버가 계산한 값으로 로컬을 맞추고
// (`applyServerAccount`), 실패(오프라인·서버 없음·타임아웃)하면 그냥 삼킨다. 화면은
// `economy.ts` 의 로컬 함수가 이미 즉시 반영했으므로 이 호출의 결과를 기다리지 않는다.
//
// **예외 하나: 첫 접속 때의 마이그레이션(`initServerAccount`)은 로컬 상태를 서버 것으로
// 덮어쓸 수 있다** — 그래야 다른 기기에서 쌓은 진행도가 이 기기에도 나타난다. 그 외에는
// 전부 "로컬이 먼저, 서버는 따라온다" 다.
//
// **검증 범위**: 이 파일이 실제 Verse8 백엔드와 주고받는 것은 이 환경에서 확인할 수
// 없다(배포된 서버가 없다) — server.js 쪽 로직은 tools/server-harness.mjs 로 실행해
// 검증했지만, 이 클라이언트 쪽은 typecheck/build 로만 확인했다. 자세한 내용은
// server-persistence-report.md 참고.

import { GameServer } from '@agent8/gameserver';
import { getSave, hasStoredSave, mutateSave, type BoosterId } from '../storage.ts';
import type { PlacementId } from '../adPolicy.ts';

/** `server.js` 의 `normalizeAccount` 가 돌려주는 모양. 서버가 쥔 필드만 있다 —
 * `settings`(볼륨·햅틱)처럼 기기에 남는 값은 여기 없다. */
export interface RemoteAccount {
  account: string;
  nickname: string;
  lang: string;
  pearls: number;
  stars: number;
  hearts: number;
  heartsAt: number;
  infiniteHeartsUntil: number;
  boosters: Record<BoosterId, number>;
  tasksDone: string[];
  levelStars: Record<number, number>;
  highestUnlocked: number;
  piggy: number;
  dailyClaimedDay: string;
  dailyStreak: number;
  /** 오늘의 무료 스핀을 쓴 날짜 키(`storage.ts` 의 `dayKey`). 빈 문자열 = 쓴 적 없음 */
  wheelFreeDay: string;
  /** 광고제거 구매 여부. **오직 `server.js` 의 `$onItemPurchased` 만 이 값을 켠다** —
   * 클라이언트가 자칭할 수 있는 자리가 없다(`syncAccount` 의 patch 화이트리스트에도 없다). */
  noAds: boolean;
}

/** 서버 호출이 이 시간(ms) 안에 안 끝나면 포기한다. 로컬이 이미 할 일을 다 했으므로
 * 오래 기다릴 이유가 없다 — 실패해도 다음 기회(다음 조작·다음 부팅)에 다시 시도된다. */
const CALL_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server call timed out')), timeoutMs);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

let connectPromise: Promise<boolean> | null = null;

/**
 * 연결을 시도한다. 이미 붙어 있으면 그대로, 실패해도 던지지 않고 false 를 돌려준다 —
 * 부르는 쪽이 오프라인을 특별 취급할 필요가 없게.
 *
 * **동시에 부르면 하나로 합친다.** Verse8 은 살아 있는 연결이 하나뿐이라 `connect()` 를
 * 겹쳐 부르면 앞 소켓을 닫는다 (TowerWar `net/agent8.ts` 의 같은 주석). 이 게임은
 * 판을 깨는 순간 `reportLevelClear` 와 `syncAccount` 가 거의 동시에 나가므로, 합치지
 * 않으면 서로의 소켓을 닫아 **둘 다 실패**할 수 있다 — 그 판이 계정에 안 올라간다.
 */
function connect(): Promise<boolean> {
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      const server = GameServer.getInstance();
      if (server.connected) return true;
      return await withTimeout(server.connect());
    } catch {
      return false;
    }
  })().then(
    (ok) => {
      // 성공했으면 그대로 둔다 — 다음 호출은 `server.connected` 를 보고 즉시 통과한다.
      // 실패했으면 캐시를 비워 다음 호출이 새로 붙어 보게 한다.
      if (!ok) connectPromise = null;
      return ok;
    },
    () => {
      connectPromise = null;
      return false;
    },
  );
  return connectPromise;
}


async function call<T>(fn: string, args: unknown[] = []): Promise<T | null> {
  try {
    const ok = await connect();
    if (!ok) return null;
    const server = GameServer.getInstance();
    return (await withTimeout(server.remoteFunction(fn, args))) as T;
  } catch (e) {
    console.warn(`[net] ${fn} 실패`, e);
    return null;
  }
}

/**
 * 서버가 돌려준 계정을 로컬 저장에 반영한다.
 *
 * **덮어쓰는 필드는 서버가 전용 함수로만 올리는 것들뿐이다** (§ server.js 머리말의
 * "동기화 모델"). `settings`(볼륨·햅틱)처럼 기기에 남아야 하는 값과 `updatedAt`/
 * `accountId`/`version` 같은 로컬 저장 뼈대는 안 건드린다.
 */
function applyServerAccount(remote: RemoteAccount): void {
  mutateSave((s) => {
    s.pearls = remote.pearls;
    s.stars = remote.stars;
    s.hearts = remote.hearts;
    s.heartsAt = remote.heartsAt;
    s.infiniteHeartsUntil = remote.infiniteHeartsUntil;
    s.piggy = remote.piggy;
    s.boosters = { ...s.boosters, ...remote.boosters };
    // 레벨 별점은 **칸마다 높은 쪽**을 남긴다. 서버 값으로 그냥 덮으면, 방금 깬 판이
    // 아직 서버에 안 올라간 사이에 온 응답 하나가 그 별점을 지운다 — 화면에서는
    // "깬 게 저장이 안 된다"로 보인다. 진행도(highestUnlocked)를 max 로 두는 것과 같은 규칙.
    s.levelStars = { ...remote.levelStars, ...s.levelStars };
    for (const [id, stars] of Object.entries(remote.levelStars)) {
      const key = Number(id);
      s.levelStars[key] = Math.max(s.levelStars[key] ?? 0, stars);
    }
    s.highestUnlocked = Math.max(s.highestUnlocked, remote.highestUnlocked);
    s.tasksDone = [...new Set([...s.tasksDone, ...remote.tasksDone])];
    s.dailyClaimedDay = remote.dailyClaimedDay;
    s.dailyStreak = remote.dailyStreak;
    // 무료 스핀은 **늦은 날짜가 이긴다.** 날짜 키는 `YYYY-MM-DD` 라 문자열 비교가 곧
    // 날짜 비교다. 서버 값을 그냥 덮어쓰면, 로컬에서 방금 쓰고 아직 못 올린 기록이
    // 지워져 무료 스핀이 하루에 두 번 돌아간다 — localStorage 를 지우는 것만으로도
    // 마찬가지가 된다. 반대로 로컬만 믿으면 다른 기기에서 쓴 것이 안 넘어온다.
    if (remote.wheelFreeDay > s.wheelFreeDay) s.wheelFreeDay = remote.wheelFreeDay;
    // 한 번 켜지면 끄는 함수가 없다 — 서버도 `noAds` 를 내리는 경로가 없으므로
    // (§ server.js `$onItemPurchased`), 여기서도 그대로 옮겨 적기만 한다.
    s.noAds = remote.noAds;
  });
}

/** `syncAccount` 에 실어 보낼 로컬 스냅샷. server.js 의 `pickClientPatch` 화이트리스트와
 * 겹치는 필드만 뽑는다 — 그 밖의 필드를 보내 봐야 서버가 무시한다. */
function snapshotForSync(): Record<string, unknown> {
  const s = getSave();
  return {
    nickname: s.nickname,
    lang: s.settings.lang,
    pearls: s.pearls,
    stars: s.stars,
    hearts: s.hearts,
    heartsAt: s.heartsAt,
    infiniteHeartsUntil: s.infiniteHeartsUntil,
    boosters: s.boosters,
    tasksDone: s.tasksDone,
    levelStars: s.levelStars,
    highestUnlocked: s.highestUnlocked,
    piggy: s.piggy,
    // 이 기기에서 오늘 무료 스핀을 썼다는 사실. 서버는 이 값을 그대로 받아 두고
    // (`server.js` 의 pickClientPatch 화이트리스트에 이미 있다) 다음 부팅 때
    // applyServerAccount 가 늦은 날짜 쪽으로 맞춘다.
    wheelFreeDay: s.wheelFreeDay,
  };
}

let initDone = false;

/**
 * 부팅 연결 재시도 간격(ms).
 *
 * **한 번 실패하면 그 세션 내내 오프라인이었다.** 회선이 느리거나 서버가 콜드 스타트면
 * 첫 시도가 8초 타임아웃(`CALL_TIMEOUT_MS`)에 걸려 그냥 죽고, `initDone` 이 이미 켜져
 * 있어 다시 시도하지도 않았다 — 그 세션에 깬 판은 전부 계정에 안 올라갔다. TowerWar 가
 * 같은 증상으로 `connectWithRetry`(BOOT_RETRY_MS)를 넣은 자리다.
 *
 * 뒤로 갈수록 벌리는 이유는 정말로 서버가 없을 때(배포 전, 완전 오프라인) 헛호출을
 * 세 번으로 막기 위해서다.
 */
const BOOT_RETRY_MS = [2000, 5000, 10000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 부팅 시 한 번 부른다. 로컬 저장을 다 읽은(`loadSave`) 뒤에 불러야 한다.
 *
 * 서버에 이 계정이 처음이면(마이그레이션) 로컬 스냅샷이 그대로 계정이 되고, 이미 있으면
 * (다른 기기에서 이어 하던 계정이면) 서버 값이 이 기기의 로컬을 덮어쓴다 — "이 기기가
 * 유일한 기록"이 아닌 경우에는 계정 쪽을 진실로 본다.
 *
 * **로컬 로딩·첫 화면 진입을 절대 막지 않는다.** `main.ts` 가 이 함수의 완료를 기다리지
 * 않고 다음 단계로 넘어가도 안전하다 — 실패해도 이미 로컬로 정상 동작 중이다.
 */
export async function initServerAccount(onApplied?: () => void): Promise<void> {
  if (initDone) return;

  for (let attempt = 0; ; attempt++) {
    // 밀린 클리어부터 올린다. 계정 값을 받아오기 **전에** 보내야 서버가 그 판까지
    // 반영한 최신 계정을 돌려준다 — 순서가 반대면 방금 올린 판이 빠진 값으로 화면을
    // 덮었다가 다음 부팅에야 맞는다.
    await flushPendingClears();
    const remote = await pushOrPull();
    if (remote) {
      initDone = true;
      applyServerAccount(remote);
      onApplied?.();
      return;
    }
    if (attempt >= BOOT_RETRY_MS.length) return; // 정말 서버가 없다 — 오프라인으로 간다
    await wait(BOOT_RETRY_MS[attempt]);
  }
}

/**
 * 로컬 스냅샷을 올릴지, 서버 값을 받아만 올지 고른다.
 *
 * **저장된 기록 없이 시작한 세션은 아무것도 올리지 않는다.** 그 세션의 로컬 값은 방금
 * 만든 기본값(진행도 0, 진주 300)이라 계정에 올릴 자격이 없다 — `syncAccount` 는
 * 화폐성 필드를 `min(서버, 클라이언트)` 로 받으므로, 기본값을 한 번 올리는 것만으로
 * 계정이 그 바닥값으로 깎인다. localStorage 가 막히는 환경(사파리 프라이빗 모드,
 * iframe 저장소 분리)에서는 매 세션이 그 상태라, 실제 증상이 "깬 판이 저장이 안 된다"
 * 였다: 판마다 서버에 올라간 진행도를 다음 부팅이 다시 0 으로 끌어내렸다.
 *
 * 그런 세션에서는 `getAccount` 로 서버 값을 받아 오기만 한다 — 그러면 저장소가 막힌
 * 기기에서도 계정 진행도로 계속 이어서 플레이할 수 있다(TowerWar 가 "붙어 있으면
 * 서버가 진짜"로 두는 것과 같은 자리다).
 */
function pushOrPull(): Promise<RemoteAccount | null> {
  if (!hasStoredSave()) return call<RemoteAccount>('getAccount', []);
  return call<RemoteAccount>('syncAccount', [snapshotForSync()]);
}

/** 탭을 벗어나기 직전 등, 로컬에 쌓인 소비(부스터·하트 사용, 태스크 완료)를 최선노력으로
 * 계정에 반영한다. 실패해도 다음 기회에 다시 보내면 된다. */
export function syncNow(): void {
  void pushOrPull().then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/**
 * 서버 계정을 로컬 스냅샷 없이 그냥 다시 읽어 반영한다.
 *
 * `syncAccount` 와 달리 로컬이 알고 있던 것을 실어 보내지 않는다 — **서버에서 방금
 * 일어난, 로컬은 아직 모르는 변화를 끌어올 때** 쓴다. 지금 이 함수를 부르는 유일한
 * 자리는 광고제거 결제 직후(`net/vx.ts` 의 `watchVxShop` 콜백) 뿐이다: 결제는
 * `server.js` 의 `$onItemPurchased` 가 서버에서 직접 지급하므로, 클라이언트는 "샀다"는
 * 사실 자체를 로컬에 들고 있지 않다 — 서버에 물어봐야만 안다.
 */
export function refreshAccountRemote(): Promise<void> {
  return call<RemoteAccount>('getAccount', []).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/**
 * 레벨 클리어. `economy.ts` 의 `recordLevelClear` 가 로컬을 이미 반영한 뒤 부른다.
 *
 * **보내기 전에 저장에 적어 둔다.** 이 호출은 최선노력이라 오프라인·타임아웃이면 그냥
 * 실패하는데, 예전에는 거기서 끝이었다 — 그 판은 로컬에만 남고 계정에는 영영 안
 * 올라갔다. 큐에 남겨 두면 다음 부팅(`initServerAccount`)이 순서대로 다시 보낸다.
 */
export function reportLevelClearRemote(levelId: number, stars: number): void {
  mutateSave((s) => {
    s.pendingClears = [...s.pendingClears, { levelId, stars }];
  });
  void flushPendingClears();
}

/**
 * 큐에 쌓인 클리어를 **순서대로** 다시 보낸다.
 *
 * 순서를 지키는 이유: 서버 보상은 레벨 번호로 계산되고 진행도는 누적이라, 뒤엣것을
 * 먼저 보내면 중간이 빈 채로 해금 지점만 뛴다. 하나라도 실패하면 거기서 멈춘다 —
 * 남은 것은 큐에 그대로 남아 다음 기회에 이어서 나간다.
 *
 * 동시에 두 번 돌지 않게 잠근다. 부팅 재시도와 클리어 직후 호출이 겹칠 수 있다.
 */
let flushing = false;

export async function flushPendingClears(): Promise<void> {
  if (flushing) return;
  if (getSave().pendingClears.length === 0) return;
  flushing = true;
  try {
    for (;;) {
      const next = getSave().pendingClears[0];
      if (!next) return;
      const remote = await call<RemoteAccount>('reportLevelClear', [next.levelId, next.stars]);
      if (!remote) return; // 오프라인 — 큐를 그대로 두고 물러난다
      mutateSave((s) => {
        s.pendingClears = s.pendingClears.slice(1);
      });
      applyServerAccount(remote);
    }
  } finally {
    flushing = false;
  }
}


/**
 * 일일 보상. `economy.ts` 의 `claimDaily` 가 로컬을 이미 반영한 뒤 부른다.
 *
 * **알려진 한계**: 스트릭·요일 판정을 서버는 UTC로, 로컬은 기기 시간대로 한다. 자정
 * 부근에서는 어느 칸을 받았는지가 두 쪽에서 하루 어긋날 수 있다 — 화면에 뜬 보상과
 * 계정에 실제로 쌓이는 값이 그 좁은 창에서만 살짝 다를 수 있다는 뜻이다.
 */
export function claimDailyRemote(): void {
  void call<RemoteAccount>('claimDaily', []).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/**
 * `adPolicy.ts` 의 11개 지면 중 서버가 금액·쿨다운·하루 상한을 쥐는 8개.
 * `server.js` 의 `AD_PLACEMENTS` 키 목록과 같아야 한다.
 *
 * 나머지 셋(`lucky-wheel-spin`, `revive-extra-moves`, `oxygen-refill`)은 이번 작업
 * 범위에서 서버로 안 옮겼다 — `server.js` 머리말에 이유를 적어 뒀다. 그 지면은 이
 * 집합에 없으므로 `claimAdRewardIfOwned` 가 조용히 아무 것도 안 한다(로컬 보상은
 * `economy.ts`/호출부가 그대로 준다 — 지금까지와 같다).
 */
const SERVER_OWNED_PLACEMENTS = new Set<PlacementId>([
  'refill-hearts',
  'free-booster-prelevel',
  'free-booster-ingame',
  'extra-star',
  'shop-free-coin',
  'piggy-bank-boost',
  'daily-chest',
  'double-coins',
]);

/**
 * 광고 보상을 계정에도 반영한다. `ui.ts` 의 `watchRewarded` 단 한 곳에서 부른다 —
 * 광고 지면마다 호출부를 따로 고치지 않아도 되게 여기서 한 번에 걸러낸다.
 *
 * `extra` 는 부스터를 고르는 두 지면(`free-booster-prelevel`/`free-booster-ingame`)
 * 에서만 쓴다.
 */
export function claimAdRewardIfOwned(placementId: PlacementId, extra?: BoosterId): void {
  if (!SERVER_OWNED_PLACEMENTS.has(placementId)) return;
  void call<RemoteAccount>('claimAdReward', [placementId, extra]).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/** 부스터 구매. `economy.ts` 의 `buyBooster` 가 로컬 차감·지급을 이미 마친 뒤 부른다. */
export function buyBoosterRemote(id: BoosterId): void {
  void call<RemoteAccount>('buyBooster', [id]).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/** 하트 풀 충전. */
export function buyHeartRefillRemote(): void {
  void call<RemoteAccount>('buyHeartRefill', []).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/** 저금통 개봉. */
export function openPiggyBankRemote(): void {
  void call<RemoteAccount>('openPiggyBank', []).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}
