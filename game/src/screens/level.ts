// 인게임 화면.

import { el, iconButton, maybeInterstitial, toast } from '../ui.ts';
import { icon } from '../icons.ts';
import { t, tf } from '../i18n.ts';
import { sfx, startAmbience, stopAmbience } from '../audio.ts';
import { haptics } from '../haptics.ts';
import { navigate, type NavParams } from '../router.ts';
import { depthT, getLevel, levelReward } from '../levels.ts';
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
import { Stage3D } from '../render3d/stage.ts';
import { preloadSprites } from '../sprites.ts';
import { recordLevelClear, addPearls, spendHeart, useBoosterItem } from '../economy.ts';
import { getSave, type BoosterId } from '../storage.ts';
import { shouldShowLevelEndInterstitial } from '../adPolicy.ts';
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

  let busy = false;
  let finished = false;
  let pendingInterstitial = false;
  let targetBooster: InGameBooster | null = null;
  let idleTimer = 0;
  let rescueDone = false;

  // ---- DOM ----
  const movesValue = el('span', { class: 'moves-value', text: String(state.movesLeft) });
  const goalRow = el('div', { class: 'goal-row' });
  const scoreValue = el('span', { class: 'score-value', text: '0' });
  const canvas = el('canvas', { class: 'board-canvas' }) as HTMLCanvasElement;
  const stageCanvas = el('canvas', { class: 'stage3d' }) as HTMLCanvasElement;
  const boosterBar = el('div', { class: 'booster-bar' });
  const targetHint = el('p', { class: 'target-hint', text: t('tapTarget') });
  targetHint.style.display = 'none';

  const isRescue = state.maxOxygen > 0;
  // 장면은 모든 레벨에 붙는다 — 목표 종류에 따라 앞을 막는 소품만 달라진다
  preloadSprites();

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

  host.append(
    header,
    goalRow,
    el('main', { class: 'screen level-screen' }, canvas, stageCanvas),
    targetHint,
    boosterBar,
  );

  // 목표 칩과 부스터 바를 먼저 채워야 캔버스 크기가 확정된다.
  // (보드 뷰는 생성 시점의 캔버스 크기로 칸 좌표를 잡는다)
  renderGoals();
  renderBoosters();

  // 같은 캔버스 위쪽에 장면을 함께 그린다 (박스가 따로 놀지 않게)
  const stage = new Stage3D(stageCanvas, depthT(level.id));

  const view = new BoardView(
    canvas,
    state.board,
    {
      onSwapRequest: (a, b) => void handleSwap(a, b),
      onPickCell: (i) => void handlePick(i),
    },
    stage,
  );

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
    stage.setView({
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

  function markLevelEnd(): void {
    if (pendingInterstitial) return;
    pendingInterstitial = shouldShowLevelEndInterstitial();
  }

  async function leave(to: () => void): Promise<void> {
    if (pendingInterstitial) {
      pendingInterstitial = false;
      // [광고 지면] 레벨 종료 전면 광고
      await maybeInterstitial('level-end');
    }
    to();
  }

  function exitToMap(): void {
    void leave(() => navigate('map'));
  }

  function onWin(): void {
    sfx.win();
    haptics.win();
    markLevelEnd();
    const stars = levelStars(state);
    const gained = recordLevelClear(levelId, stars);
    const pearls = levelReward(levelId, stars);
    addPearls(pearls);

    openWinModal(
      { levelId, stars, starsGained: gained, pearls, score: state.score },
      {
        refresh: () => undefined,
        onMap: () => void leave(() => navigate('map')),
        onNext: () =>
          void leave(() => navigate('level', { levelId: levelId + 1, preBoosters: [] })),
      },
    );
  }

  function onLose(): void {
    sfx.lose();
    haptics.lose();
    markLevelEnd();

    const reason = loseReason(state);

    openLoseModal({
      reason,
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
        void leave(() => navigate('level', { levelId, preBoosters: [] }));
      },
      onMap: () => void leave(() => navigate('map')),
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
  resetIdle();

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
      stage,
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
  let drained = 0;
  let lastTick = performance.now();
  let growled = false;

  const timer = window.setInterval(() => {
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
      // 잡아먹는 포식자 연출은 아직 없다 (Task 8 에서 Stage3D 에 되살린다)
      // stage.devour();
      // 잡아먹히는 연출을 보여준 뒤에 실패 화면을 띄운다
      window.setTimeout(onLose, 1100);
    }
  }, 120);

  // 심해 앰비언트는 판에 들어와 있는 동안만 깔린다
  void startAmbience();

  host.addEventListener(
    'screen:destroy',
    () => {
      window.clearTimeout(idleTimer);
      window.clearInterval(timer);
      stopAmbience();
      view.destroy();
      stage.dispose();
    },
    { once: true },
  );
}
