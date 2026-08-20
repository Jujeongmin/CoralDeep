// 인게임 화면.

import { el, iconButton, toast } from '../ui.ts';
import { icon } from '../icons.ts';
import { t, tf } from '../i18n.ts';
import { sfx, startAmbience, stopAmbience } from '../audio.ts';
import { haptics } from '../haptics.ts';
import { navigate, type NavParams } from '../router.ts';
import { depthT, getLevel, levelReward, predatorFor } from '../levels.ts';
import { depthMood } from '../render/depth.ts';
import { randomSeed } from '../core/rng.ts';
import {
  grantExtraMoves,
  drainOxygen,
  grantOxygen,
  levelStars,
  loseReason,
  startLevel,
  trySwap,
  useBooster,
  type InGameBooster,
  type LevelState,
  type LevelStatus,
  type PreBooster,
} from '../core/engine.ts';
import { findFirstHint } from '../core/match.ts';
import { BoardView } from '../render/boardView.ts';
import { type Stage, createStage } from '../render3d/index.ts';
import { recordLevelClear, addPearls, spendHeart, useBoosterItem } from '../economy.ts';
import { getSave, type BoosterId } from '../storage.ts';
import { boosterMeta, openFreeBoosterModal, openLoseModal, openWinModal } from './modals.ts';

const REVIVE_MOVES = 5;

/**
 * 제한 시간 눈금 하나가 몇 초인가.
 *
 * 레벨 데이터의 `oxygen` 값은 초가 아니라 **눈금 수**다. 화면에 그 값을 그대로
 * "시간 +6" 처럼 내보내면 플레이어는 6초로 읽는데 실제로는 15초를 받는다.
 * 보여줄 때는 반드시 이 값을 곱해 초로 바꾼다.
 */
const SEC_PER_UNIT = 2.5;

/** 광고 보상으로 더해주는 시간 눈금 */
const REVIVE_OXYGEN = 6;
/** 광고 문구에 쓰는 실제 초 */
const REVIVE_OXYGEN_SEC = Math.round(REVIVE_OXYGEN * SEC_PER_UNIT);
/** 산소통 광고 보상은 이동 수도 같이 준다 (이동이 0이면 산소만 줘도 못 이어간다) */
const REVIVE_OXYGEN_MOVES = 4;

/** 목표 종류별 아이콘. 모듈 스코프에 둬야 renderGoals 를 언제 부르든 안전하다. */
const GOAL_ICON = {
  rock: 'rock',
  ice: 'ice',
  net: 'net',
  escape: 'diver',
} as const;

const BOOSTER_BAR: { id: BoosterId; kind: InGameBooster; needsTarget: boolean }[] = [
  { id: 'harpoon', kind: 'harpoon', needsTarget: true },
  { id: 'depthCharge', kind: 'depthCharge', needsTarget: true },
  { id: 'tide', kind: 'tide', needsTarget: false },
];

export function renderLevel(host: HTMLElement, params: NavParams): void {
  const levelId = params.levelId ?? 1;
  const level = getLevel(levelId);

  // 하트는 실제 진입 시점에 소모한다
  if (!spendHeart()) {
    navigate('map');
    return;
  }

  let state: LevelState = startLevel(level, {
    seed: randomSeed(),
    preBoosters: (params.preBoosters ?? []) as PreBooster[],
  });

  // busy 는 원래 "한 수 재생 중"만 뜻했다 -- 여기서는 시작값을 true 로 잡아 그
  // 의미를 하나 더 얹는다: "아직 입력을 받을 준비가 안 됐다". onBoosterClick /
  // handleSwap / handlePick 이 전부 이 값을 이미 확인하므로(아래), 3D 로드가
  // 끝나 startGame() 이 false 로 풀 때까지 부스터·스왑·타겟 선택이 전부 막힌다 --
  // 새 게이트를 하나 더 만드는 대신 기존 잠금을 그대로 넓혀 쓴다.
  let busy = true;
  let finished = false;
  let targetBooster: InGameBooster | null = null;
  let idleTimer = 0;
  let rescueDone = false;

  // ---- DOM ----
  const movesValue = el('span', { class: 'moves-value', text: String(state.movesLeft) });
  const goalRow = el('div', { class: 'goal-row' });
  const scoreValue = el('span', { class: 'score-value', text: '0' });
  const canvas = el('canvas', { class: 'board-canvas' }) as HTMLCanvasElement;
  const stageCanvas = el('canvas', { class: 'stage3d' }) as HTMLCanvasElement;
  // 3D 가 다 갖춰질 때까지 보드 위를 덮는 안내 -- 스피너는 광고 오버레이의
  // .ad-spinner 를 그대로 재사용한다(같은 시각 언어, 새 로딩 스타일을 또 만들지
  // 않는다). z-index 는 style.css 의 .level-loading 이 stage3d(2) 보다 위(3)로 잡는다.
  const stageLoading = el(
    'div',
    { class: 'level-loading' },
    el('div', { class: 'ad-spinner' }),
    el('p', { text: t('stageLoading') }),
  );
  // 부스터 바도 로딩 중엔 흐리게 죽여 둔다 -- busy=true 가 클릭을 이미 막지만,
  // 눌러도 반응이 없는 멀쩡해 보이는 버튼은 "고장났다"로 읽힌다.
  const boosterBar = el('div', { class: 'booster-bar loading-disabled' });
  const targetHint = el('p', { class: 'target-hint', text: t('tapTarget') });
  targetHint.style.display = 'none';

  const isRescue = state.maxOxygen > 0;

  // 제한 시간은 숫자로 안 보여준다. 다가오는 곰치가 곧 시계다 —
  // 게이지를 같이 띄우면 그림이 아니라 숫자를 보게 되고 긴장이 사라진다.

  const header = el(
    'header',
    { class: 'screen-head level-head' },
    iconButton('back', () => exitToMap(), t('back')),
    el(
      'div',
      { class: 'level-meta' },
      el('strong', { text: tf('levelN', { n: levelId }) }),
      el('span', { class: 'score-line' }, el('small', { text: `${t('score')} ` }), scoreValue),
    ),
    el(
      'div',
      { class: 'moves-box' },
      el('small', { text: t('moves') }),
      movesValue,
    ),
  );

  const screenEl = el('main', { class: 'screen level-screen' }, canvas, stageCanvas, stageLoading);
  host.append(header, goalRow, screenEl, targetHint, boosterBar);

  // 배경은 3D 가 아니라 CSS 다 — 3D 가 맨 앞 레이어라 배경 메시를 두면 보드를 덮는다.
  const mood = depthMood(depthT(level.id));
  screenEl.style.background = `linear-gradient(180deg, ${mood.top} 0%, ${mood.bottom} 100%)`;

  // 목표 칩과 부스터 바를 먼저 채워야 캔버스 크기가 확정된다.
  // (보드 뷰는 생성 시점의 캔버스 크기로 칸 좌표를 잡는다)
  renderGoals();
  renderBoosters();

  // BoardView 생성자는 동기적으로 resize() 를 한 번 돌린다(그 안에서
  // setBoardRect() 도 호출된다) -- 잠수부 배치·자갈 해저의 칸 마스크 구멍·입자
  // 억제 사각형이 전부 "보드 사각형을 안다"는 전제로 첫 프레임부터 맞물려야
  // 하므로, 이 순서(생성자 -> resize() -> setBoardRect())는 이 과제에서도 그대로
  // 지킨다 -- 아래에서 하는 일은 입력 게이트와 로딩 표시뿐이고 BoardView 생성
  // 자체는 손대지 않는다.
  const view = new BoardView(canvas, state.board, {
    onSwapRequest: (a, b) => void handleSwap(a, b),
    onPickCell: (i) => void handlePick(i),
  });
  // 위 busy=true 와 짝을 이룬다 -- 캔버스 포인터 입력 자체도 여기서 막는다.
  view.setLocked(true);

  // ---- 3D 로드 대기 ----
  //
  // 예전엔 3D 가 나중에 조용히 붙었다(보드가 먼저 놀고, 잠수부가 몇 순간 뒤에
  // "툭" 나타났다). 이제는 게임 자체가 3D 가 다 갖춰질 때까지 기다린다 -- 위
  // busy=true / view.setLocked(true) 가 입력을 막아 두고, startGame() 이 그 잠금을
  // 풀며 게임을 실제로 시작한다.
  //
  // three 는 여기서 처음 내려받는다 -- 지도·수족관 화면은 이 코드를 안 거치므로
  // 앱을 켜자마자 받을 이유가 없다(render3d/index.ts 참고). createStage() 가
  // resolve 되는 시점은 "three 모듈을 불러오고 Stage3D 를 생성했다"까지일 뿐이고,
  // 잠수부(diver.glb, ~685KB)·포식자 glb 는 그 생성자 안에서 fetch 만 걸어 두고
  // 기다리지 않는다(stage.ts 참고) -- 그래서 "진짜 다 됐다"는 stage.ready() 를
  // 한 번 더 기다려야 안다. WebGL 을 못 따거나 import 가 실패하면 createStage() 가
  // 그 자리에서 바로 null 을 주므로(webglAvailable() 판정은 동기, import 실패도
  // catch 에서 즉시 반환) 그 경로는 원래도 빠르다 -- 느려질 수 있는 건 오직 glb
  // fetch 뿐이다.
  let stage: Stage | null = null;
  let destroyed = false;
  let started = false;

  /**
   * 느린 회선에서도 3D 가 뜰 시간은 주되, 무한정 기다리며 "멈춘 게임"으로 보이면
   * 안 된다 -- createStage() 가 null 을 주는 이유(웹뷰가 WebGL 을 못 딴다) 자체가
   * "3D 없이도 보드는 논다"는 사고 대응이었는데, 로딩 대기가 그 취지를 무너뜨리면
   * 안 된다. diver.glb(685KB) + 포식자 glb 한 개(비슷한 자릿수)를 3G 급 회선
   * (~750kbps 안팎) 에서 받아도 수 초면 끝난다 -- 8초는 정상적인 4G/Wi-Fi 에서는
   * 절대 안 걸리는 여유고, 진짜로 막힌 상황(오프라인 전환 등)에서는 8초 안에
   * 포기하고 보드만으로 시작한다. 그래도 3D 가 뒤늦게 도착하면(아래 .then) 그때
   * 조용히 붙는다 -- 타임아웃은 "포기"가 아니라 "기다림을 그만둔다"는 뜻이다.
   */
  const STAGE_LOAD_TIMEOUT_MS = 8000;

  function startGame(): void {
    if (started || destroyed) return;
    started = true;
    window.clearTimeout(timeoutId);
    stageLoading.remove();
    boosterBar.classList.remove('loading-disabled');
    busy = false;
    view.setLocked(false);
    resetIdle();
    startTimer();
  }

  const timeoutId = window.setTimeout(startGame, STAGE_LOAD_TIMEOUT_MS);

  void createStage(stageCanvas, depthT(level.id))
    .then(async (s) => {
      if (!s) return null;
      // stage.ready() 는 절대 거부(reject)하지 않는다(각 로더가 자기 실패를
      // 안에서 삼킨다 -- render3d/types.ts 의 Stage.ready() 주석 참고).
      await s.ready();
      return s;
    })
    .then((s) => {
      // screen:destroy 가 로드 도중 먼저 왔으면(레벨을 빨리 나간 경우) 화면에 붙이지
      // 않고 바로 해제한다 -- 안 그러면 이미 사라진 화면에 렌더러가 남는다.
      if (destroyed) {
        s?.dispose();
        return;
      }
      if (!s) {
        stageCanvas.style.display = 'none';
      } else {
        stage = s;
        view.setStage(s);
      }
      startGame();
    });

  // ---- 갱신 ----

  function renderGoals(): void {
    goalRow.replaceChildren();
    for (const p of state.goals) {
      const name = p.goal.type === 'color' ? null : GOAL_ICON[p.goal.type];
      const chip = el(
        'div',
        { class: `goal-chip ${p.done >= p.target ? 'done' : ''}`.trim() },
        name
          ? icon(name, 20, 'goal-icon')
          : el('span', { class: `goal-swatch c${p.goal.color ?? 0}` }),
        el('span', { class: 'goal-count', text: `${Math.min(p.done, p.target)}/${p.target}` }),
      );
      goalRow.append(chip);
    }
  }

  function renderBoosters(): void {
    boosterBar.replaceChildren();
    const save = getSave();
    for (const entry of BOOSTER_BAR) {
      const meta = boosterMeta(entry.id);
      const count = save.boosters[entry.id] ?? 0;
      const active = targetBooster === entry.kind;
      const btn = el(
        'button',
        {
          class: `booster-btn ${active ? 'active' : ''} ${count <= 0 ? 'empty' : ''}`,
          'aria-label': meta.name,
        },
        icon(meta.icon, 28, 'booster-icon'),
        el('span', { class: 'booster-count', text: count > 0 ? `×${count}` : 'AD' }),
      );
      btn.addEventListener('click', () => onBoosterClick(entry));
      boosterBar.append(btn);
    }
  }

  function renderOxygen(): void {
    // 남은 시간은 장면(다가오는 곰치)으로만 보여준다. 여기서 그릴 게 없다.
  }

  /**
   * 장면에 넘길 값.
   * - danger: 구조 미션은 남은 산소, 그 외 레벨은 남은 이동 수 — 어느 쪽이든 쫓기는 정도다.
   * - progress: 목표 달성률. 앞을 막은 소품이 이만큼 걷힌다.
   */
  function renderScene(): void {
    const danger = isRescue
      ? 1 - state.oxygen / state.maxOxygen
      : state.totalMoves > 0
        ? 1 - state.movesLeft / state.totalMoves
        : 0;

    let done = 0;
    let target = 0;
    for (const p of state.goals) {
      done += Math.min(p.done, p.target);
      target += p.target;
    }

    // Stage3D 는 danger·progress 만 받는다 (render3d/types.ts 의 SceneView).
    // 구조 인원 표시(rescued/total)는 LevelScene 전용이었다 — Task 7/8 에서 되살릴지 정한다.
    // stage 는 비동기로 붙으므로(위 createStage) 아직 없을 수 있다 — 그동안은 조용히 넘어간다.
    stage?.setView({
      danger,
      progress: target > 0 ? done / target : 0,
    });
  }

  function refreshHud(): void {
    movesValue.textContent = String(state.movesLeft);
    scoreValue.textContent = String(state.score);
    renderGoals();
    renderBoosters();
    renderOxygen();
    renderScene();
  }

  // ---- 입력 처리 ----

  function onBoosterClick(entry: (typeof BOOSTER_BAR)[number]): void {
    if (busy || finished) return;
    sfx.tap();
    const count = getSave().boosters[entry.id] ?? 0;
    if (count <= 0) {
      // [광고 지면] 인게임 부스터 무료 1회
      openFreeBoosterModal(entry.id, () => renderBoosters());
      return;
    }
    if (!entry.needsTarget) {
      if (!useBoosterItem(entry.id)) return;
      void applyBooster(entry.kind);
      return;
    }
    targetBooster = targetBooster === entry.kind ? null : entry.kind;
    view.setTargetMode(targetBooster !== null);
    targetHint.style.display = targetBooster ? 'block' : 'none';
    renderBoosters();
  }

  async function applyBooster(kind: InGameBooster, index?: number): Promise<void> {
    busy = true;
    view.setLocked(true);
    view.setHint(null);
    const result = useBooster(state, kind, index);
    if (!result.ok) {
      busy = false;
      view.setLocked(false);
      return;
    }
    sfx.special();
    haptics.special();
    await view.playPhases(result.phases);
    view.syncFrom(state.board);
    afterMove();
  }

  async function handlePick(i: number): Promise<void> {
    if (!targetBooster || busy || finished) return;
    const entry = BOOSTER_BAR.find((b) => b.kind === targetBooster);
    if (!entry) return;
    if (!useBoosterItem(entry.id)) {
      targetBooster = null;
      view.setTargetMode(false);
      targetHint.style.display = 'none';
      renderBoosters();
      return;
    }
    const kind = targetBooster;
    targetBooster = null;
    view.setTargetMode(false);
    targetHint.style.display = 'none';
    await applyBooster(kind, i);
  }

  async function handleSwap(a: number, b: number): Promise<void> {
    if (busy || finished) return;
    busy = true;
    view.setLocked(true);
    view.setHint(null);
    resetIdle();

    await view.playSwap(a, b);
    const result = trySwap(state, a, b);

    if (!result.ok) {
      // 엔진이 되돌렸으므로 화면도 되돌린다
      await view.playSwap(a, b);
      sfx.invalid();
      haptics.invalid();
      busy = false;
      view.setLocked(false);
      return;
    }

    let combo = 0;
    for (const phase of result.phases) {
      if (phase.kind === 'clear') {
        sfx.clear(combo++);
        if (phase.triggered.length > 0) sfx.special();
        if (phase.blockers.length > 0) sfx.blocker();
        // 지운 자리로 물이 흘러든다 — 이 소리가 있어야 '뚫었다'가 손에 잡힌다
        if (phase.tiles.length > 0) sfx.water();
      } else {
        sfx.bubble();
      }
      await view.playPhases([phase]);
    }
    haptics.clear();
    view.syncFrom(state.board);
    afterMove();
  }

  function afterMove(): void {
    const rescueBefore = rescueDone;
    refreshHud();
    busy = false;
    view.setLocked(false);

    rescueDone = state.goals.some(
      (p) => p.goal.type === 'escape' && p.done >= p.target,
    );
    if (!rescueBefore && rescueDone) {
      sfx.star();
      toast(t('rescued'));
    }

    if (state.status === 'won') {
      finished = true;
      view.setLocked(true);
      window.setTimeout(onWin, 350);
      return;
    }
    if (state.status === 'lost') {
      finished = true;
      view.setLocked(true);
      window.setTimeout(onLose, 350);
      return;
    }
    resetIdle();
  }

  // ---- 종료 처리 ----

  function exitToMap(): void {
    navigate('map');
  }

  function onWin(): void {
    sfx.win();
    haptics.win();
    const stars = levelStars(state);
    const gained = recordLevelClear(levelId, stars);
    const pearls = levelReward(levelId, stars);
    addPearls(pearls);

    openWinModal(
      { levelId, stars, starsGained: gained, pearls, score: state.score },
      {
        refresh: () => undefined,
        onMap: () => navigate('map'),
        onNext: () => navigate('level', { levelId: levelId + 1, preBoosters: [] }),
      },
    );
  }

  function onLose(): void {
    sfx.lose();
    haptics.lose();

    const reason = loseReason(state);

    openLoseModal({
      reason,
      predator: predatorFor(depthT(levelId)),
      extraMoves: REVIVE_MOVES,
      // 모달에 찍히는 값은 눈금이 아니라 **초**여야 한다
      extraOxygen: REVIVE_OXYGEN_SEC,
      onRevive: () => {
        if (reason === 'eaten') grantOxygen(state, REVIVE_OXYGEN, REVIVE_OXYGEN_MOVES);
        else grantExtraMoves(state, REVIVE_MOVES);
        if (state.status !== 'playing') return;
        finished = false;
        view.syncFrom(state.board);
        view.setLocked(false);
        refreshHud();
        toast(
          reason === 'eaten'
            ? tf('oxygenRefill', { n: REVIVE_OXYGEN_SEC })
            : tf('extraMoves', { n: REVIVE_MOVES }),
        );
        resetIdle();
      },
      onRetry: () => {
        navigate('level', { levelId, preBoosters: [] });
      },
      onMap: () => navigate('map'),
    });
  }

  // ---- 힌트 ----

  function resetIdle(): void {
    window.clearTimeout(idleTimer);
    view.setHint(null);
    idleTimer = window.setTimeout(() => {
      if (busy || finished) return;
      view.setHint(findFirstHint(state.board));
    }, 6000);
  }

  refreshHud();
  // resetIdle() 은 여기서 안 부른다 -- startGame() 이 부른다. 로딩 중에 힌트가
  // 깜빡이면 "만질 수 있다"는 신호를 주는데 실제로는 busy=true 로 막혀 있어
  // 어긋난다.

  // 개발 환경 전용 디버그 훅 (프로덕션 번들에서는 통째로 제거된다)
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__coralDeep = {
      get state() {
        return state;
      },
      hint: () => findFirstHint(state.board),
      cols: state.board.w,
      rows: state.board.h,
      view,
      // stage 는 비동기로 붙었다 뗐다 하므로(위 createStage) 값이 아니라 getter로
      // 매번 최신 참조를 돌려준다 -- 값으로 캡처하면 로드 전 null 로 고정된다.
      get stage() {
        return stage;
      },
      get busy() {
        return busy;
      },
    };
  }

  // ---------- 제한 시간 ----------
  //
  // 예전엔 한 수마다 산소가 줄었다. 그러면 손을 놓고 있는 동안은 안전해서
  // 쫓기는 느낌이 없었다. 지금은 실제 시간으로 곰치가 다가온다.
  //
  // 눈금 하나 = SEC_PER_UNIT 초 (모듈 상단). 레벨 데이터의 oxygen 값이 그대로 눈금 수다.
  //
  // 인터벌은 여기서 바로 안 켠다 -- startGame() 이 부른다(startTimer()). 로딩
  // 대기 중에도 켜 두면 3D 를 기다리는 몇 초 동안 산소가 소리 없이 새는 꼴이라
  // (구조 미션이면 실제로 불리해진다), 게임이 아직 안 시작한 시간까지 제한
  // 시간에 넣으면 안 된다.
  let drained = 0;
  let lastTick = 0;
  let growled = false;
  let timer = 0;

  function startTimer(): void {
    lastTick = performance.now();
    timer = window.setInterval(() => {
      if (finished || state.status !== 'playing') return;
      // 모달(부스터·광고)이 떠 있는 동안은 멈춘다 — 광고 보다가 잡아먹히면 안 된다
      if (document.querySelector('.modal-backdrop')) {
        lastTick = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(1, (now - lastTick) / 1000);
      lastTick = now;

      drained += dt / SEC_PER_UNIT;
      const whole = Math.floor(drained);
      let status: LevelStatus = state.status;
      if (whole > 0) {
        drained -= whole;
        status = drainOxygen(state, whole);
      }
      renderScene();

      // 코앞까지 왔을 때 한 번만 으르렁거린다
      if (!growled && state.maxOxygen > 0 && state.oxygen <= 3 && state.oxygen > 0) {
        growled = true;
        sfx.growl();
        haptics.invalid();
      }

      if (status === 'lost' && !finished) {
        finished = true;
        view.setLocked(true);
        // 포식자가 덮치고 잠수부가 물려 간다. 3D 무대가 아직(로딩 실패 등) 없으면
        // 조용히 넘어간다 — 소리와 진동만으로도 "잡혔다"는 남는다.
        stage?.devour();
        sfx.growl();
        haptics.invalid();
        // 잡아먹히는 연출을 보여준 뒤에 실패 화면을 띄운다
        window.setTimeout(onLose, 1100);
      }
    }, 120);
  }

  // 심해 앰비언트는 판에 들어와 있는 동안만 깔린다
  void startAmbience();

  host.addEventListener(
    'screen:destroy',
    () => {
      window.clearTimeout(idleTimer);
      window.clearTimeout(timeoutId);
      window.clearInterval(timer);
      stopAmbience();
      view.destroy();
      // 아직 createStage() 가 진행 중이면(destroyed 플래그) 위 .then() 이 도착하는 대로
      // 알아서 dispose 한다 -- 여기서는 이미 붙어 있는 stage 만 해제한다.
      destroyed = true;
      stage?.dispose();
    },
    { once: true },
  );
}
