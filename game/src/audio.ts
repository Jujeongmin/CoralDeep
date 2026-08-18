// 오디오.
//
// 예전에는 오실레이터로 삑삑거리는 소리를 합성했다. 번들은 0 이었지만 어느 게임에서나
// 나는 그 소리라 '만들다 만 것' 처럼 들렸다. 지금은 실제 녹음 샘플을 쓴다.
//
// 에셋 (전부 CC0):
//   Kenney (https://kenney.nl/assets) — tap · swap · invalid · clear · special ·
//                                       break · coin · star · win · lose
//   Freesound CC0 — ambience(504641 fission9) · flow(852478 kolbyrfx) ·
//                   bubble(539823 ristooooo1) · growl(171178 yatoimtop)
//
// 큰 원본은 tools 하네스(/dev-audio.html)에서 잘라 모노·저샘플레이트 WAV 로 구웠다.

import ambienceUrl from './assets/audio/ambience.wav';
import breakUrl from './assets/audio/break.ogg';
import bubbleUrl from './assets/audio/bubble.wav';
import clearUrl from './assets/audio/clear-1.ogg';
import coinUrl from './assets/audio/coin.ogg';
import flowUrl from './assets/audio/flow.wav';
import growlUrl from './assets/audio/growl.mp3';
import invalidUrl from './assets/audio/invalid.ogg';
import loseUrl from './assets/audio/lose.ogg';
import specialUrl from './assets/audio/special.ogg';
import starUrl from './assets/audio/star.ogg';
import swapUrl from './assets/audio/swap.ogg';
import tapUrl from './assets/audio/tap.ogg';
import winUrl from './assets/audio/win.ogg';

import { getSave } from './storage.ts';

const CLIPS = {
  tap: tapUrl,
  swap: swapUrl,
  invalid: invalidUrl,
  special: specialUrl,
  break: breakUrl,
  coin: coinUrl,
  star: starUrl,
  win: winUrl,
  lose: loseUrl,
  bubble: bubbleUrl,
  growl: growlUrl,
  ambience: ambienceUrl,
  flow: flowUrl,
  clear: clearUrl,
} as const;

type ClipName = keyof typeof CLIPS;

/**
 * 소리별 볼륨.
 *
 * 자주 겹쳐 나는 소리(매치·스왑)는 낮게 깔아야 콤보에서 귀가 아프지 않다.
 * 실패음과 승리음은 한 판에 한 번뿐이라 원본이 크게 녹음돼 있는데, 그대로 두면
 * 게임 소리 중 혼자 튄다. 여기서 눌러 맞춘다.
 */
const VOLUME: Partial<Record<ClipName, number>> = {
  tap: 0.5,
  swap: 0.55,
  invalid: 0.3,
  clear: 0.5,
  break: 0.7,
  special: 0.6,
  bubble: 0.35,
  growl: 0.6,
  win: 0.45,
  lose: 0.55,
};

let ctx: AudioContext | null = null;
const buffers = new Map<ClipName, AudioBuffer>();
const pending = new Set<ClipName>();

/**
 * 계열별 마스터 버스.
 *
 * 볼륨을 소리마다 곱해서 재생하면, 슬라이더를 움직여도 **이미 울리고 있는 소리**는
 * 그대로 옛 크기로 끝난다 (특히 루프로 도는 배경음은 영영 안 바뀐다).
 * 모든 소리를 계열 버스 하나에 모아두고 그 게인만 바꾸면 즉시 반영된다.
 */
let sfxBus: GainNode | null = null;
let bgmBus: GainNode | null = null;

function volumes(): { bgm: number; sfx: number } {
  const s = getSave().settings;
  return { bgm: s.bgmVolume, sfx: s.sfxVolume };
}

function context(): AudioContext | null {
  const { bgm, sfx: sfxVol } = volumes();
  // 둘 다 0 이면 AudioContext 를 아예 만들지 않는다 (배터리·자동재생 정책)
  if (bgm <= 0 && sfxVol <= 0) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (!sfxBus) {
    sfxBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    bgmBus = ctx.createGain();
    bgmBus.connect(ctx.destination);
    applyVolumes();
  }
  return ctx;
}

/** 설정의 볼륨을 버스에 반영한다. 슬라이더를 움직일 때마다 부른다. */
export function applyVolumes(): void {
  const { bgm, sfx: sfxVol } = volumes();
  if (sfxBus) sfxBus.gain.value = sfxVol;
  if (bgmBus) bgmBus.gain.value = bgm;
  // 배경음을 0 으로 내렸으면 루프를 실제로 세운다 — 게인만 0 이면 디코딩·재생이 계속 돈다
  if (bgm <= 0) stopAmbience();
}

async function load(name: ClipName): Promise<void> {
  if (buffers.has(name) || pending.has(name)) return;
  pending.add(name);
  try {
    const ac = context();
    if (!ac) return;
    const res = await fetch(CLIPS[name]);
    buffers.set(name, await ac.decodeAudioData(await res.arrayBuffer()));
  } catch {
    // 한 소리가 못 올라와도 게임은 계속돼야 한다
  } finally {
    pending.delete(name);
  }
}

/**
 * iOS/모바일 웹뷰는 사용자 제스처 안에서 생성·resume 한 AudioContext 만 소리를 낸다.
 * 첫 터치에서 열어두면 이후 타이머에서 재생하는 효과음(승리/패배)도 정상 동작한다.
 * 이때 짧은 효과음을 미리 받아둔다 — 첫 스왑에서 소리가 늦게 나면 안 눌린 줄 안다.
 */
export function unlockAudio(): void {
  const listener = (): void => {
    const ac = context();
    if (ac && ac.state === 'suspended') void ac.resume();
    for (const name of ['tap', 'swap', 'invalid', 'clear', 'break'] as ClipName[]) {
      void load(name);
    }
    window.removeEventListener('pointerdown', listener);
    window.removeEventListener('touchend', listener);
  };
  window.addEventListener('pointerdown', listener);
  window.addEventListener('touchend', listener);
}

/** 한 번 재생. rate 로 음높이를 바꾼다 (콤보가 깊을수록 올린다). */
function play(name: ClipName, opts: { rate?: number; gain?: number } = {}): void {
  const ac = context();
  if (!ac || !sfxBus) return;
  // 효과음을 0 으로 내렸으면 버퍼를 만들 필요도 없다
  if (volumes().sfx <= 0) return;
  const buffer = buffers.get(name);
  if (!buffer) {
    void load(name);
    return;
  }
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = opts.rate ?? 1;
  const amp = ac.createGain();
  amp.gain.value = (opts.gain ?? 1) * (VOLUME[name] ?? 0.8);
  source.connect(amp).connect(sfxBus);
  source.start();
}

// ---------- 배경음 ----------

let loopSource: AudioBufferSourceNode | null = null;
let loopGain: GainNode | null = null;

/** 심해 앰비언트를 깔아둔다. 화면을 나가면 stopAmbience 로 끈다. */
export async function startAmbience(): Promise<void> {
  const ac = context();
  if (!ac || !bgmBus || loopSource) return;
  if (volumes().bgm <= 0) return;
  await load('ambience');
  const buffer = buffers.get('ambience');
  if (!buffer || loopSource) return;
  loopSource = ac.createBufferSource();
  loopSource.buffer = buffer;
  loopSource.loop = true;
  loopGain = ac.createGain();
  // 천천히 페이드인 — 화면 열자마자 소리가 튀어나오면 놀란다
  loopGain.gain.setValueAtTime(0.0001, ac.currentTime);
  loopGain.gain.linearRampToValueAtTime(0.28, ac.currentTime + 2);
  loopSource.connect(loopGain).connect(bgmBus);
  loopSource.start();
}

export function stopAmbience(): void {
  const ac = ctx;
  if (!loopSource || !loopGain || !ac) return;
  const source = loopSource;
  loopGain.gain.cancelScheduledValues(ac.currentTime);
  loopGain.gain.setValueAtTime(loopGain.gain.value, ac.currentTime);
  loopGain.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 0.6);
  window.setTimeout(() => source.stop(), 700);
  loopSource = null;
  loopGain = null;
}

export const sfx = {
  tap: () => play('tap'),
  swap: () => play('swap'),
  invalid: () => play('invalid'),
  /**
   * 연쇄가 깊을수록 위 음으로 올라간다.
   *
   * 샘플 5개를 번갈아 쓰면 음색이 매번 달라져 '같은 동작'으로 안 들린다.
   * 한 샘플을 재생 속도로만 올려야 하나의 사다리로 읽힌다.
   */
  clear: (combo = 0) => play('clear', { rate: 1 + Math.min(combo, 7) * 0.12 }),
  special: () => play('special'),
  /** 산호암·바위가 부서질 때 */
  blocker: () => play('break'),
  /** 물이 흘러들어 길이 열릴 때 */
  water: () => play('flow', { gain: 0.5 }),
  bubble: () => play('bubble'),
  /** 곰치가 가까워졌을 때 */
  growl: () => play('growl'),
  win: () => play('win'),
  lose: () => play('lose'),
  coin: () => play('coin'),
  star: () => play('star'),
};
