// 저장 어댑터.
//
// 지금은 localStorage 구현체만 쓴다. 나중에 Verse8 게임 서버(@agent8/gameserver)의
// globalUserState 로 갈아끼울 때는 StorageAdapter 만 새로 구현하면 된다.
// (게임 코드는 loadSave/mutateSave 만 부른다 — 어댑터 종류를 알지 못한다.)

export type BoosterId = 'harpoon' | 'depthCharge' | 'tide' | 'preCurrent' | 'preMine' | 'prePearl';

export interface AdCounter {
  /** 오늘 날짜 키 (YYYY-MM-DD) */
  day: string;
  count: number;
  /** 마지막 시청 시각 (epoch ms) */
  lastAt: number;
}

/**
 * 계정 단위로 따라다녀야 하는 상태를 전부 여기에 모은다.
 * (localStorage 는 기기 단위지만, 키를 계정으로 나누고 로그인 시 guest 데이터를 옮긴다.
 *  나중에 서버 어댑터로 바꾸면 이 구조 그대로 계정에 실린다.)
 *
 * 계정 스코프 항목 점검표
 *  - 진행도:   levelStars, highestUnlocked, tasksDone
 *  - 재화:     pearls, stars, piggy
 *  - 생명:     hearts, heartsAt, infiniteHeartsUntil
 *  - 인벤토리: boosters
 *  - 주기 보상: dailyClaimedDay, dailyStreak, wheelFreeDay
 *  - 광고 제한: adCounters   ← 계정에 붙어야 상한 우회가 안 된다
 *  - 사용자:   settings, nickname, accountId
 */
/**
 * 저장에 들어가는 언어 코드.
 *
 * `i18n.ts` 의 `Lang` 을 import 하지 않는다 — storage 는 계층상 아래에 있어서
 * 위쪽(i18n)을 가져오면 순환 의존이 된다. 대신 여기서 정의하고 i18n 이 이걸 따른다.
 */
export type SaveLang = 'ko' | 'en' | 'ja' | 'zh';

export interface SaveData {
  version: number;
  /** 이 저장이 속한 Verse8 계정 (guest 면 null) */
  accountId: string | null;
  /** 마지막으로 저장된 시각. 서버 어댑터로 옮길 때 병합 기준이 된다. */
  updatedAt: number;
  /** levelId -> 획득한 최고 별 (1~3) */
  levelStars: Record<number, number>;
  highestUnlocked: number;
  /** 재화: 진주 */
  pearls: number;
  /** 수족관 복원에 쓰는 불가사리 */
  stars: number;
  hearts: number;
  /** 하트가 마지막으로 갱신된 시각 */
  heartsAt: number;
  /** 무한 하트 만료 시각 (0 = 없음) */
  infiniteHeartsUntil: number;
  boosters: Record<BoosterId, number>;
  /** 완료한 수족관 태스크 id */
  tasksDone: string[];
  /** 마지막 일일 보상 수령 날짜 키 */
  dailyClaimedDay: string;
  dailyStreak: number;
  /** 룰렛 무료 스핀 날짜 키 */
  wheelFreeDay: string;
  /** 저금통에 쌓인 진주 */
  piggy: number;
  adCounters: Record<string, AdCounter>;
  /**
   * 소리는 배경음과 효과음을 따로 잡는다 (0..1).
   *
   * 하나의 on/off 로 묶어두면 "음악만 끄고 효과음은 듣고 싶다"를 못 한다 —
   * 모바일에서 흔한 요구다. 0 이면 그 계열은 아예 재생하지 않는다.
   */
  settings: { bgmVolume: number; sfxVolume: number; haptics: boolean; lang: SaveLang };
  nickname: string;
}

export const SAVE_VERSION = 1;

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    accountId: null,
    updatedAt: 0,
    levelStars: {},
    highestUnlocked: 1,
    pearls: 300,
    stars: 0,
    hearts: 5,
    heartsAt: Date.now(),
    infiniteHeartsUntil: 0,
    boosters: { harpoon: 2, depthCharge: 1, tide: 1, preCurrent: 1, preMine: 0, prePearl: 0 },
    tasksDone: [],
    dailyClaimedDay: '',
    dailyStreak: 0,
    wheelFreeDay: '',
    piggy: 0,
    adCounters: {},
    // 배경음은 효과음보다 낮게 깔아야 효과음이 묻히지 않는다
    settings: { bgmVolume: 0.7, sfxVolume: 1, haptics: true, lang: 'ko' },
    nickname: '',
  };
}

export interface StorageAdapter {
  load(): Promise<SaveData>;
  save(data: SaveData): Promise<void>;
}

/** 누락된 필드를 기본값으로 채운다 (저장 포맷이 늘어나도 안전하게) */
function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Partial<SaveData>;
  return {
    ...base,
    ...data,
    version: SAVE_VERSION,
    levelStars: { ...base.levelStars, ...(data.levelStars ?? {}) },
    boosters: { ...base.boosters, ...(data.boosters ?? {}) },
    adCounters: { ...(data.adCounters ?? {}) },
    tasksDone: [...(data.tasksDone ?? [])],
    settings: migrateSettings(base.settings, data.settings),
  };
}

/**
 * 예전 저장의 `settings.sound` (on/off 하나) 를 배경음·효과음 두 값으로 옮긴다.
 *
 * 그냥 기본값으로 덮으면 **소리를 꺼뒀던 사람이 다음 실행에서 소리를 맞는다.**
 * 껐던 의사는 그대로 지켜야 한다 — 껐으면 둘 다 0 으로 시작한다.
 */
function migrateSettings(
  base: SaveData['settings'],
  raw: unknown,
): SaveData['settings'] {
  const old = (raw ?? {}) as Partial<SaveData['settings']> & { sound?: boolean };
  // 옛 키(`sound`)는 여기서 떨군다. 그대로 흘려보내면 저장 파일에 영원히 남아
  // 다음에 포맷을 볼 사람이 아직 쓰이는 값인 줄 안다.
  const merged: SaveData['settings'] = {
    bgmVolume: old.bgmVolume ?? base.bgmVolume,
    sfxVolume: old.sfxVolume ?? base.sfxVolume,
    haptics: old.haptics ?? base.haptics,
    lang: old.lang ?? base.lang,
  };
  const hasNew = typeof old.bgmVolume === 'number' || typeof old.sfxVolume === 'number';
  if (!hasNew && old.sound === false) {
    merged.bgmVolume = 0;
    merged.sfxVolume = 0;
  }
  // 손상된 저장이나 옛 포맷이 섞여 들어와도 슬라이더가 범위를 벗어나지 않게 한다
  merged.bgmVolume = clamp01(merged.bgmVolume);
  merged.sfxVolume = clamp01(merged.sfxVolume);
  return merged;
}

function clamp01(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.min(1, Math.max(0, n));
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly key: string) {}

  async load(): Promise<SaveData> {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return defaultSave();
      return migrate(JSON.parse(raw));
    } catch {
      return defaultSave();
    }
  }

  async save(data: SaveData): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch {
      // 사파리 프라이빗 모드 등 저장 실패는 조용히 무시 (플레이는 계속되어야 한다)
    }
  }
}

// ---- 계정 스코프 키 ----

const KEY_PREFIX = 'coraldeep.save.';
export const GUEST_KEY = `${KEY_PREFIX}guest`;

export function saveKeyFor(account: string | null): string {
  return `${KEY_PREFIX}${account ?? 'guest'}`;
}

/**
 * 로그인 전에 guest 로 플레이한 기록을 계정으로 옮긴다.
 * 계정 저장이 이미 있으면 손대지 않는다 (기존 계정 진행도가 우선).
 */
export function migrateGuestSave(account: string | null): 'migrated' | 'kept' | 'none' {
  if (!account) return 'none';
  const accountKey = saveKeyFor(account);
  try {
    if (localStorage.getItem(accountKey)) return 'kept';
    const guest = localStorage.getItem(GUEST_KEY);
    if (!guest) return 'none';
    const data = migrate(JSON.parse(guest));
    data.accountId = account;
    localStorage.setItem(accountKey, JSON.stringify(data));
    localStorage.removeItem(GUEST_KEY);
    return 'migrated';
  } catch {
    return 'none';
  }
}

// ---- 전역 저장소 ----

let adapter: StorageAdapter = new LocalStorageAdapter(GUEST_KEY);
let cache: SaveData = defaultSave();
let flushTimer: number | null = null;
let currentAccount: string | null = null;

export function setAdapter(next: StorageAdapter): void {
  adapter = next;
}

/** Verse8 계정별로 저장을 분리한다. 계정을 못 받으면 guest 로 떨어진다. */
export function makeLocalAdapter(account: string | null): StorageAdapter {
  currentAccount = account;
  return new LocalStorageAdapter(saveKeyFor(account));
}

export function getAccount(): string | null {
  return currentAccount;
}

export async function loadSave(): Promise<SaveData> {
  cache = await adapter.load();
  cache.accountId = currentAccount;
  return cache;
}

export function getSave(): SaveData {
  return cache;
}

/** 저장 데이터를 바꾸고 디바운스 저장한다. */
export function mutateSave(fn: (data: SaveData) => void): SaveData {
  fn(cache);
  scheduleFlush();
  return cache;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    cache.updatedAt = Date.now();
    void adapter.save(cache);
  }, 250);
}

/** 즉시 저장 (화면 이탈 직전 등) */
export async function flushSave(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  cache.updatedAt = Date.now();
  await adapter.save(cache);
}

/** YYYY-MM-DD 날짜 키 (로컬 시간대 기준) */
export function dayKey(at: number = Date.now()): string {
  const d = new Date(at);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
