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
//   OpenGameArt CC0 — bgm: "Underwater Theme II" by Cleyton Kauffman
//                     (https://opengameart.org/content/underwater-theme-ii)
//
// 큰 원본은 tools 하네스(/dev-audio.html)에서 잘라 모노·저샘플레이트 WAV 로 구웠다.

import ambienceUrl from './assets/audio/ambience.wav';
import bgmUrl from './assets/audio/bgm.ogg';
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
  bgm: bgmUrl,
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

/**
 * iOS 의 무음 스위치를 피한다.
 *
 * Safari 는 WebAudio 만 쓰는 페이지를 기본적으로 **ambient** 오디오 세션으로 잡는다 —
 * 이 세션은 기기의 무음 스위치(또는 집중 모드)에 그대로 묶여서, 스위치가 내려가 있으면
 * 소리가 하나도 안 난다. 볼륨을 올려도 안 들리고 코드에는 아무 오류도 안 남아서
 * "효과음이 아예 없다"로 보인다.
 *
 * Safari 16.4+ 는 `navigator.audioSession.type` 으로 세션 종류를 고를 수 있다.
 * `playback` 으로 올리면 음악 앱과 같은 취급이라 무음 스위치를 타지 않는다.
 * 없는 브라우저에서는 조용히 넘어간다(안드로이드·데스크톱은 애초에 이 제약이 없다).
 */
function preferPlaybackSession(): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!session) return;
  try {
    session.type = 'playback';
  } catch {
    // 값을 거부하는 구현이면 기본 세션 그대로 간다
  }
}

/**
 * 멈춰 있는 컨텍스트를 깨운다.
 *
 * **`suspended` 만 보면 안 된다.** iOS Safari 는 전화·시리·화면 잠금·앱 전환으로 오디오가
 * 끊기면 표준에 없는 `interrupted` 상태로 들어간다. `state === 'suspended'` 만 검사하면
 * 그 경우가 전부 빠져나가서, 앱을 잠깐 벗어났다 돌아온 뒤로는 효과음이 영영 안 난다.
 * 그래서 "돌고 있지 않으면 깨운다"로 잡는다.
 */
function resumeAudio(): void {
  if (ctx && ctx.state !== 'running') void ctx.resume();
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
    // 세션 종류는 컨텍스트를 만들기 전에 정한다 — 이미 만들어진 뒤에 바꾸면
    // 그 컨텍스트에는 반영되지 않는 구현이 있다.
    preferPlaybackSession();
    ctx = new Ctor();
  }
  resumeAudio();
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
  if (bgm <= 0) {
    stopAmbience();
    stopMusic();
  }
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
  let primed = false;

  const listener = (): void => {
    const ac = context();
    if (!ac) return;
    resumeAudio();
    if (primed) return;
    primed = true;
    // iOS 는 제스처 안에서 **실제로 한 번 재생된** 컨텍스트만 완전히 열어준다.
    // resume() 만으로 되는 버전이 대부분이지만, 무음 버퍼를 한 번 흘려보내는 쪽이
    // 웹뷰 종류를 안 탄다 (들리지 않으므로 부작용도 없다).
    try {
      const silent = ac.createBufferSource();
      silent.buffer = ac.createBuffer(1, 1, ac.sampleRate);
      silent.connect(ac.destination);
      silent.start();
    } catch {
      // 버퍼를 못 만드는 환경이면 resume() 만으로 간다
    }
    for (const name of ['tap', 'swap', 'invalid', 'clear', 'break'] as ClipName[]) {
      void load(name);
    }
    // 자동재생이 막혀 부팅 때 못 켰으면 여기서 켜진다 (이미 돌고 있으면 무시된다).
    void startMusic();
  };

  // **한 번 듣고 떼지 않는다.** 예전에는 첫 터치에서 리스너를 제거했는데, iOS 는 앱을
  // 벗어났다 돌아오거나 전화가 오면 컨텍스트를 다시 재운다(interrupted). 그 뒤로는
  // 깨워 줄 사람이 없어서 남은 세션 내내 소리가 안 났다. 계속 달아 두고 매 제스처마다
  // 상태만 확인한다 — 이미 돌고 있으면 resume() 은 아무 일도 안 한다.
  window.addEventListener('pointerdown', listener);
  window.addEventListener('touchend', listener);

  // 화면으로 돌아왔을 때도 깨운다. 제스처 없이 부르는 resume() 이라 거부될 수 있지만,
  // 거부돼도 다음 터치에서 위 리스너가 다시 잡는다 — 성공하면 돌아오자마자 배경음이
  // 이어져서 "돌아왔더니 소리가 죽어 있다"가 사라진다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAudio();
  });
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
//
// 두 겹이다.
//   1) **음악**(bgm) — 앱 전체에 깔린다. 지도·수족관·판 안, 어디에 있든 끊기지 않는다.
//   2) **물소리 앰비언트**(ambience) — 판 안에서만 그 위에 겹친다. 심해로 내려가 있는
//      동안만 물이 가까이서 흐르는 셈이다.
// 둘 다 같은 bgmBus 를 타므로 설정의 '배경음' 슬라이더 하나가 함께 조절한다.

let loopSource: AudioBufferSourceNode | null = null;
let loopGain: GainNode | null = null;
let musicSource: AudioBufferSourceNode | null = null;
let musicGain: GainNode | null = null;

/** 음악 재생 크기. 앰비언트(0.28)보다 낮게 깐다 — 계속 도는 소리라 조금만 커도 지겹다. */
const MUSIC_GAIN = 0.22;
/** 음악 페이드인(초). 화면 열자마자 곡이 튀어나오면 놀란다 — 앰비언트와 같은 이유. */
const MUSIC_FADE_SECONDS = 3;

/**
 * 판 안에서 음악을 낮추는 비율.
 *
 * 판에서는 물소리 앰비언트가 음악 위에 겹치고, 그 위에 매치·특수타일 효과음이 계속
 * 터진다 — 지도에서 알맞던 음량이 여기서는 시끄럽다. 끄지는 않는다: 음악이 사라지면
 * 판만 다른 게임처럼 들린다.
 */
const MUSIC_DUCK = 0.45;
/** 낮추고 되돌리는 데 걸리는 시간(초). 화면 전환과 같이 느껴질 만큼만 짧게. */
const MUSIC_DUCK_FADE = 0.8;

/** 지금 낮춰져 있는가 — 음악이 나중에 시작돼도 같은 크기로 붙어야 한다. */
let musicDucked = false;

/** 음악 목표 음량. 판 안이면 낮춘 값. */
function musicTarget(): number {
  return musicDucked ? MUSIC_GAIN * MUSIC_DUCK : MUSIC_GAIN;
}

/**
 * 판에 들어가고 나올 때 부른다. 음악만 낮춘다 — 앰비언트와 효과음은 그대로다.
 * 음악이 아직 안 시작했어도 상태만 기억해 두고, 시작할 때 그 크기로 붙는다.
 */
export function duckMusic(on: boolean): void {
  if (musicDucked === on) return;
  musicDucked = on;
  const ac = ctx;
  if (!ac || !musicGain) return;
  musicGain.gain.cancelScheduledValues(ac.currentTime);
  musicGain.gain.setValueAtTime(musicGain.gain.value, ac.currentTime);
  musicGain.gain.linearRampToValueAtTime(musicTarget(), ac.currentTime + MUSIC_DUCK_FADE);
}

/**
 * 배경 음악을 깐다. 앱이 살아 있는 동안 계속 돈다 — 화면을 옮겨도 안 끊는다.
 * 여러 번 불러도 이미 돌고 있으면 아무 일도 안 한다.
 */
export async function startMusic(): Promise<void> {
  const ac = context();
  if (!ac || !bgmBus || musicSource) return;
  if (volumes().bgm <= 0) return;
  await load('bgm');
  const buffer = buffers.get('bgm');
  // await 사이에 다른 호출이 먼저 시작했을 수 있다 — 두 개가 겹쳐 돌면 위상이 어긋나
  // 같은 곡이 둘로 들린다.
  if (!buffer || musicSource) return;

  // 버퍼 전체를 그대로 돈다.
  //
  // **ogg 라서 그럴 수 있다.** mp3 였다면 인코더가 앞뒤에 붙이는 무음 패딩 때문에 한
  // 바퀴마다 소리가 끊겨(원작자도 "루프에는 mp3 말고 ogg/wav 를 써라"라고 적어 뒀다)
  // loopStart/loopEnd 로 그 침묵을 잘라내야 했다. ogg 에는 그 패딩이 없고, 이 곡은
  // 원작자가 이음새를 맞춰 둔 루프다 — 오히려 여기서 앞뒤 무음을 잘라내면 곡 앞머리의
  // 페이드인까지 깎여 매 바퀴 소리가 불쑥 시작한다.
  musicSource = ac.createBufferSource();
  musicSource.buffer = buffer;
  musicSource.loop = true;
  musicGain = ac.createGain();
  musicGain.gain.setValueAtTime(0.0001, ac.currentTime);
  musicGain.gain.linearRampToValueAtTime(musicTarget(), ac.currentTime + MUSIC_FADE_SECONDS);
  musicSource.connect(musicGain).connect(bgmBus);
  musicSource.start();
}

/** 음악을 세운다. 지금은 배경음 볼륨을 0 으로 내렸을 때만 부른다. */
export function stopMusic(): void {
  const ac = ctx;
  if (!musicSource || !musicGain || !ac) return;
  const source = musicSource;
  musicGain.gain.cancelScheduledValues(ac.currentTime);
  musicGain.gain.setValueAtTime(musicGain.gain.value, ac.currentTime);
  musicGain.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 0.6);
  window.setTimeout(() => source.stop(), 700);
  musicSource = null;
  musicGain = null;
}

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
