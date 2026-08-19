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
import { getSave, mutateSave, type BoosterId } from '../storage.ts';
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

/** 연결을 시도한다. 이미 붙어 있으면 그대로, 실패해도 던지지 않고 false 를 돌려준다 —
 * 부르는 쪽이 오프라인을 특별 취급할 필요가 없게. */
function connect(): Promise<boolean> {
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      const server = GameServer.getInstance();
      if (server.connected) return true;
      return await withTimeout(server.connect());
    } catch {
      return false;
    } finally {
      // 다음 시도가 새로 붙어 보게 캐시를 비운다 (연결이 끊겼을 수도 있으므로).
      connectPromise = null;
    }
  })();
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
    s.levelStars = { ...s.levelStars, ...remote.levelStars };
    s.highestUnlocked = Math.max(s.highestUnlocked, remote.highestUnlocked);
    s.tasksDone = [...new Set([...s.tasksDone, ...remote.tasksDone])];
    s.dailyClaimedDay = remote.dailyClaimedDay;
    s.dailyStreak = remote.dailyStreak;
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
  };
}

let initDone = false;

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
export async function initServerAccount(): Promise<void> {
  if (initDone) return;
  initDone = true;
  const remote = await call<RemoteAccount>('syncAccount', [snapshotForSync()]);
  if (remote) applyServerAccount(remote);
}

/** 탭을 벗어나기 직전 등, 로컬에 쌓인 소비(부스터·하트 사용, 태스크 완료)를 최선노력으로
 * 계정에 반영한다. 실패해도 다음 기회에 다시 보내면 된다. */
export function syncNow(): void {
  void call<RemoteAccount>('syncAccount', [snapshotForSync()]).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
}

/** 레벨 클리어. `economy.ts` 의 `recordLevelClear` 가 로컬을 이미 반영한 뒤 부른다. */
export function reportLevelClearRemote(levelId: number, stars: number): void {
  void call<RemoteAccount>('reportLevelClear', [levelId, stars]).then((remote) => {
    if (remote) applyServerAccount(remote);
  });
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
