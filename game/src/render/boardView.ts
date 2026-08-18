// 캔버스 보드 렌더러 + 입력 + 애니메이션.
//
// 엔진은 한 수를 동기적으로 전부 계산하고 Phase 목록을 돌려준다.
// 이 뷰는 그 Phase 를 순서대로 재생하면서 자기 표시 상태를 갱신한다.

import type { Blocker, Board, Phase, Special, Tile } from '../core/types.ts';
import { idx } from '../core/types.ts';
import { WaterLayer } from './water.ts';
import { TILE_ART, bakedTile, clearBaked, preloadTiles } from '../tiles.ts';
import { texturePattern } from '../textures.ts';
import type { DescentPoint, Stage } from '../render3d/types.ts';

export interface BoardViewCallbacks {
  /** 인접한 두 칸을 맞바꾸려 할 때 */
  onSwapRequest(a: number, b: number): void;
  /** 부스터 타겟 모드에서 칸을 골랐을 때 */
  onPickCell(i: number): void;
}

/**
 * 보드 위쪽에 같이 그릴 연출(구조 미션 장면).
 * 별도 캔버스로 두면 보드와 따로 노는 박스가 되므로 한 캔버스를 나눠 쓴다.
 * 파티클도 같은 좌표계라 보드에서 터진 조각이 장면 쪽으로 날아간다.
 */
export interface ScenePainter {
  /** 캔버스 위쪽에서 이 장면이 차지할 높이 */
  height(canvasH: number): number;
  step(dt: number): void;
  /** 잠수부를 뺀 배경. 보드보다 먼저 그린다. */
  paintBackdrop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  /** 잠수부. 보드를 다 그린 뒤 맨 위에 그린다 (보드 위를 지나가야 한다). */
  paintDiver(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  /** 보드로 내려가는 동안의 위치. null 이면 장면 안 제자리. */
  setDescent(point: { x: number; y: number; scale: number; t: number } | null): void;
  /** 장면 안 잠수부의 현재 위치·배율 (내려오기 시작하는 지점) */
  diverAnchor(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { x: number; y: number; scale: number };
  /** 화면을 흔들 픽셀 양 (0 이면 흔들지 않음) */
  shake(): number;
  /** 장애물을 하나 부쉈을 때 반응 */
  cheer?(): void;
  /** 잠수부가 탈출했을 때 반응 */
  rescued?(): void;
}

interface Sprite {
  tile: Tile;
  /** 목표 위치 기준 오프셋(px) */
  ox: number;
  oy: number;
  scale: number;
  alpha: number;
}

interface Dying {
  cell: number;
  tile: Tile;
  t: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  /** 아래로 끌어당기는 힘. 위로 올라가는 기포는 음수로 준다. */
  gravity: number;
}

const COLOR_HUES = [4, 190, 140, 45, 285, 210];
const COLOR_LIGHT = ['#ff7a6b', '#5ed6ff', '#5fe0a0', '#ffd257', '#c48bff', '#e8f4ff'];
const COLOR_DARK = ['#c8392f', '#1f8fc4', '#209a63', '#c9962a', '#7c4bc0', '#9db6cc'];

export class BoardView {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private cell = 0;
  private originX = 0;
  private originY = 0;

  private sprites: (Sprite | null)[] = [];
  private blockers: Blocker[] = [];
  private blockerHp: number[] = [];
  private holes: boolean[] = [];
  /** 뚫린 통로 칸 */
  private passages: boolean[] = [];
  private startCell = -1;
  private exitCell = -1;
  /** 탈출 연출 중일 때 잠수부가 따라갈 경로와 진행도 */
  private escapePath: number[] | null = null;
  private escapeT = 0;
  private cols = 0;
  private rows = 0;

  private dying: Dying[] = [];
  private particles: Particle[] = [];

  private selected: number | null = null;
  private hinted: [number, number] | null = null;
  private targetMode = false;
  private locked = false;

  private rafId = 0;
  private lastFrame = 0;
  private time = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  /** 이번 프레임에 다시 그려야 하는가 (모바일 배터리: 정지 화면은 안 그린다) */
  private dirty = true;
  private hasDiver = false;

  private pointerStart: { i: number; x: number; y: number } | null = null;

  /** 캔버스 위쪽에 예약된 연출 높이 (없으면 0) */
  private sceneH = 0;

  /** 흘러드는 물 (칸 단위가 아니라 하나의 액체 덩어리로 그린다) */
  private water = new WaterLayer();

  /** 에셋을 구워둘 픽셀 크기 (칸 크기 x 화면 배율) */
  private artSize = 64;

  constructor(
    private canvas: HTMLCanvasElement,
    board: Board,
    private cb: BoardViewCallbacks,
    private scene: Stage | null = null,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    preloadTiles();
    this.syncFrom(board);
    this.attach();
    this.resize();
    this.lastFrame = performance.now();
    this.draw(); // 첫 프레임을 rAF 전에 그린다
    this.loop(this.lastFrame);
  }

  // ---------- 상태 동기화 ----------

  syncFrom(board: Board): void {
    this.cols = board.w;
    this.rows = board.h;
    this.sprites = board.cells.map((c) =>
      c.tile ? { tile: { ...c.tile }, ox: 0, oy: 0, scale: 1, alpha: 1 } : null,
    );
    this.blockers = board.cells.map((c) => c.blocker);
    this.blockerHp = board.cells.map((c) => c.blockerHp);
    this.holes = board.cells.map((c) => c.hole);
    this.passages = board.cells.map((c) => c.passage);
    this.startCell = board.start;
    this.exitCell = board.exit;
    this.hasDiver = board.start >= 0 && board.exit >= 0;
    this.water.syncFrom(this.passages);
    this.dirty = true;
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) this.selected = null;
    this.dirty = true;
  }

  setTargetMode(on: boolean): void {
    this.targetMode = on;
    this.selected = null;
    this.dirty = true;
  }

  setHint(hint: [number, number] | null): void {
    this.hinted = hint;
    this.dirty = true;
  }

  // ---------- 레이아웃 ----------

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // 모바일 고배율 화면에서 2 를 넘기면 픽셀만 늘고 체감 화질은 그대로다
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.floor(rect.width));
    this.h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = 6;
    // this.scene.height(...) 는 ScenePainter 전용이라 Stage 에는 없다 (Task 7 에서 되살리거나 지운다).
    // 3D 무대는 보드 위가 아니라 보드와 같은 화면 영역을 덮으므로 지금은 예약 높이가 0이다.
    this.sceneH = 0;
    const boardH = this.h - this.sceneH;
    this.cell = Math.floor(Math.min((this.w - pad * 2) / this.cols, (boardH - pad * 2) / this.rows));
    this.originX = Math.floor((this.w - this.cell * this.cols) / 2);
    // 장면이 있으면 보드를 위로 붙인다 — 사이에 빈 띠가 생기면 두 영역이 다시 따로 논다
    this.originY = this.scene
      ? this.sceneH + pad
      : this.sceneH + Math.floor((boardH - this.cell * this.rows) / 2);
    this.artSize = Math.max(16, Math.round(this.cell * dpr));
    clearBaked();
    this.water.setGrid(this.cols, this.rows, this.cell, this.originX, this.originY, dpr);
    this.water.syncFrom(this.passages);
    // 뷰포트 좌표로 넘긴다. 3D 캔버스는 이 캔버스와 다른 박스를 쓰므로
    // 캔버스 로컬 좌표를 그대로 주면 두 박스의 차이만큼 어긋난다.
    const box = this.canvas.getBoundingClientRect();
    this.scene?.setBoardRect({
      x: box.left + this.originX,
      y: box.top + this.originY,
      w: this.cell * this.cols,
      h: this.cell * this.rows,
      cell: this.cell,
      cols: this.cols,
      rows: this.rows,
      holes: this.holes,
    });
    this.scene?.resize();
    this.dirty = true;
  }

  private cellX(i: number): number {
    return this.originX + (i % this.cols) * this.cell;
  }

  private cellY(i: number): number {
    return this.originY + Math.floor(i / this.cols) * this.cell;
  }

  private cellAt(px: number, py: number): number | null {
    const x = Math.floor((px - this.originX) / this.cell);
    const y = Math.floor((py - this.originY) / this.cell);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return y * this.cols + x;
  }

  /**
   * 실제로 만질 수 있는 칸인가.
   *
   * 격자 안이라고 다 누를 수 있는 게 아니다. 보드는 직사각형이 아니라
   * **자갈 더미에 파인 불규칙한 구멍**이고(`hole`), 게다가 지운 자리는 물길로 바뀌어
   * 타일이 사라진다(`sprites[i] === null`). 둘 다 눌러봐야 할 게 없는 칸이다.
   *
   * 여기서 걸러내지 않으면 자갈이나 물 위를 눌러도 선택 테두리가 그려지고,
   * 거기서 드래그가 시작되고, 부스터 조준(`targetMode`)도 먹힌다 —
   * 화면상 아무것도 없는 곳이 반응하니 고장난 것처럼 보인다.
   */
  private playable(i: number | null): i is number {
    return i !== null && !this.holes[i] && this.sprites[i] !== null;
  }

  // ---------- 입력 ----------

  private attach(): void {
    if (typeof window.PointerEvent === 'function') {
      this.canvas.addEventListener('pointerdown', this.onDown);
      this.canvas.addEventListener('pointerup', this.onUp);
      this.canvas.addEventListener('pointercancel', this.onCancel);
      // 마우스가 있는 기기에서만 커서 아래 칸을 표시한다.
      // 터치에서 켜면 탭한 칸이 손을 떼도 계속 켜진 채로 남는다.
      if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerleave', this.onLeave);
      }
    } else {
      // PointerEvent 를 지원하지 않는 구형 모바일 웹뷰 폴백
      this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
      this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
      this.canvas.addEventListener('touchcancel', this.onCancel);
    }
    // 길게 눌렀을 때 뜨는 컨텍스트 메뉴 차단 (보드에서만)
    this.canvas.addEventListener('contextmenu', preventDefault);
    window.addEventListener('resize', this.onResize);

    // 캔버스 박스는 생성 직후에도 (레이아웃이 확정되며) 바뀐다.
    // 갱신을 놓치면 입력 좌표가 실제 칸과 어긋나므로 ResizeObserver 로 항상 따라간다.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.onCancel);
    this.canvas.removeEventListener('contextmenu', preventDefault);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private onResize = (): void => {
    this.resize();
  };

  private localPoint(e: PointerLike): { x: number; y: number } {
    let rect = this.canvas.getBoundingClientRect();
    // 캐시된 크기와 다르면 즉시 다시 계산한다.
    // (백그라운드 탭에서는 ResizeObserver 콜백도 밀리므로 입력 시점에 한 번 더 확인한다)
    if (Math.floor(rect.width) !== this.w || Math.floor(rect.height) !== this.h) {
      this.resize();
      rect = this.canvas.getBoundingClientRect();
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** 커서가 얹힌 칸. PC 에서만 쓰고 모바일은 항상 -1 이다. */
  private hoverCell = -1;

  private onMove = (e: PointerLike): void => {
    const p = this.localPoint(e);
    const i = this.cellAt(p.x, p.y);
    // 만질 수 없는 칸(구멍·이미 뚫린 통로)은 켜지 않는다 — 켜지면 누를 수 있는 줄 안다
    const next = this.playable(i) ? i : -1;
    if (next === this.hoverCell) return;
    this.hoverCell = next;
    this.canvas.style.cursor = next >= 0 && !this.locked ? 'pointer' : '';
    this.dirty = true;
  };

  private onLeave = (): void => {
    if (this.hoverCell === -1) return;
    this.hoverCell = -1;
    this.canvas.style.cursor = '';
    this.dirty = true;
  };

  private onDown = (e: PointerLike): void => {
    this.dirty = true;
    if (this.locked) return;
    const p = this.localPoint(e);
    const i = this.cellAt(p.x, p.y);
    if (i === null) return;
    // 격자 안에서 시작한 제스처는 브라우저 기본 동작(스크롤·확대)을 막는다.
    // 만질 수 없는 칸이어도 막아야 한다 — 안 그러면 자갈 위에서만 화면이 밀린다.
    e.preventDefault();

    // 타일이 없는 칸(자갈 구멍 · 이미 뚫린 물길)은 여기서 끝낸다
    if (!this.playable(i)) return;

    if (this.targetMode) {
      this.cb.onPickCell(i);
      return;
    }
    this.pointerStart = { i, x: p.x, y: p.y };
  };

  private onUp = (e: PointerLike): void => {
    this.dirty = true;
    if (this.locked || this.targetMode) {
      this.pointerStart = null;
      return;
    }
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start) return;

    const p = this.localPoint(e);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    const dist = Math.hypot(dx, dy);

    // 드래그 = 방향 스왑
    if (dist > this.cell * 0.35) {
      const sx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
      const sy = sx === 0 ? Math.sign(dy) : 0;
      const x = (start.i % this.cols) + sx;
      const y = Math.floor(start.i / this.cols) + sy;
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const to = y * this.cols + x;
      // 자갈이나 물길 쪽으로 끌면 스왑 요청 자체를 보내지 않는다.
      // 코어가 어차피 거절하지만, 거절당하면 '삑' 소리와 흔들림이 나서
      // 될 법한 수를 실패한 것처럼 보인다. 애초에 없는 칸이면 조용해야 한다.
      if (!this.playable(to)) return;
      this.selected = null;
      this.cb.onSwapRequest(start.i, to);
      return;
    }

    // 탭 = 선택 후 인접 칸 탭
    const target = this.cellAt(p.x, p.y);
    if (!this.playable(target)) return;
    if (this.selected === null) {
      this.selected = target;
      return;
    }
    if (this.selected === target) {
      this.selected = null;
      return;
    }
    const ax = this.selected % this.cols;
    const ay = Math.floor(this.selected / this.cols);
    const bx = target % this.cols;
    const by = Math.floor(target / this.cols);
    if (Math.abs(ax - bx) + Math.abs(ay - by) === 1) {
      const from = this.selected;
      this.selected = null;
      this.cb.onSwapRequest(from, target);
    } else {
      this.selected = target;
    }
  };

  private onCancel = (): void => {
    this.pointerStart = null;
  };

  // ---- 구형 웹뷰용 터치 폴백 (PointerEvent 미지원일 때만 붙는다) ----

  private onTouchStart = (e: TouchEvent): void => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    e.preventDefault();
    this.onDown(touchToPointer(touch));
  };

  private onTouchEnd = (e: TouchEvent): void => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    e.preventDefault();
    this.onUp(touchToPointer(touch));
  };

  // ---------- 애니메이션 ----------

  /**
   * 탭이 백그라운드로 가면 requestAnimationFrame 이 멈춘다.
   * 그 상태로 한 수의 애니메이션이 걸려 있으면 게임이 잠긴 채로 남으므로,
   * setTimeout 안전망으로 마지막 상태를 강제 적용하고 끝낸다.
   */
  private animate(duration: number, step: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      let fallback = 0;
      const finish = (): void => {
        if (done) return;
        done = true;
        window.clearTimeout(fallback);
        if (!this.disposed) step(1);
        resolve();
      };
      const start = performance.now();
      const tick = (now: number): void => {
        if (done) return;
        if (this.disposed) return finish();
        const p = Math.min(1, (now - start) / duration);
        this.dirty = true;
        step(p);
        if (p >= 1) finish();
        else requestAnimationFrame(tick);
      };
      fallback = window.setTimeout(finish, duration + 900);
      requestAnimationFrame(tick);
    });
  }

  /** 성립하지 않는 스왑: 갔다가 돌아온다 */
  async playInvalidSwap(a: number, b: number): Promise<void> {
    const sa = this.sprites[a];
    const sb = this.sprites[b];
    if (!sa || !sb) return;
    const dx = this.cellX(b) - this.cellX(a);
    const dy = this.cellY(b) - this.cellY(a);
    await this.animate(110, (p) => {
      const e = easeOut(p);
      sa.ox = dx * e * 0.55;
      sa.oy = dy * e * 0.55;
      sb.ox = -dx * e * 0.55;
      sb.oy = -dy * e * 0.55;
    });
    await this.animate(110, (p) => {
      const e = 1 - easeOut(p);
      sa.ox = dx * e * 0.55;
      sa.oy = dy * e * 0.55;
      sb.ox = -dx * e * 0.55;
      sb.oy = -dy * e * 0.55;
    });
    sa.ox = sa.oy = sb.ox = sb.oy = 0;
  }

  /** 스왑 애니메이션 + 표시 상태 교환 */
  async playSwap(a: number, b: number): Promise<void> {
    const sa = this.sprites[a];
    const sb = this.sprites[b];
    const dx = this.cellX(b) - this.cellX(a);
    const dy = this.cellY(b) - this.cellY(a);
    await this.animate(130, (p) => {
      const e = easeOut(p);
      if (sa) {
        sa.ox = dx * e;
        sa.oy = dy * e;
      }
      if (sb) {
        sb.ox = -dx * e;
        sb.oy = -dy * e;
      }
    });
    if (sa) sa.ox = sa.oy = 0;
    if (sb) sb.ox = sb.oy = 0;
    this.sprites[a] = sb;
    this.sprites[b] = sa;
  }

  async playPhases(phases: Phase[]): Promise<void> {
    for (const phase of phases) {
      if (phase.kind === 'clear') await this.playClear(phase);
      else await this.playEscape(phase);
    }
  }

  /** 탈출로가 이어져 잠수부가 그 길을 따라 빠져나간다 */
  private async playEscape(phase: Extract<Phase, { kind: 'escape' }>): Promise<void> {
    const path = phase.cells;
    if (path.length === 0) return;
    this.scene?.rescued?.();

    // 길을 따라 기포가 차례로 터진다
    for (const [n, i] of path.entries()) {
      window.setTimeout(() => this.spawnRise(i, 6), n * 45);
    }

    this.escapePath = path;
    const duration = Math.max(700, path.length * 130);
    await this.animate(duration, (p) => {
      this.escapeT = p;
    });
    this.escapeT = 1;
    this.startCell = this.exitCell;
    this.escapePath = null;
    this.dirty = true;
  }

  private async playClear(phase: Extract<Phase, { kind: 'clear' }>): Promise<void> {
    // 특수 타일 발동 섬광
    for (const trig of phase.triggered) this.spawnBurst(trig.index, trig.special);

    const dying: Dying[] = [];
    for (const i of phase.tiles) {
      const s = this.sprites[i];
      if (!s) continue;
      dying.push({ cell: i, tile: s.tile, t: 0 });
      this.sprites[i] = null;
      this.spawnParticles(i, s.tile.color);
      // 지운 자리로 물이 흘러든다
      this.passages[i] = true;
      this.water.open(i);
    }
    this.dying.push(...dying);

    for (const hit of phase.blockers) {
      this.blockerHp[hit.index] = hit.hpAfter;
      const destroyed = hit.hpAfter <= 0;
      if (destroyed) {
        this.blockers[hit.index] = 'none';
      }
      this.spawnParticles(hit.index, hit.blocker === 'rock' ? 3 : 1);
      // 잔해를 부수면 그 자리에 물이 찬다 — 그 물길이 이어져야 잠수부가 나간다
      if (destroyed && hit.blocker !== 'ice' && hit.blocker !== 'net') {
        this.passages[hit.index] = true;
        this.water.open(hit.index);
      }
      if (destroyed && hit.blocker === 'rubble') {
        this.spawnRise(hit.index, 16);
        this.scene?.cheer?.();
      }
    }
    this.dirty = true;

    await this.animate(190, (p) => {
      for (const d of dying) d.t = p;
    });
    this.dying = this.dying.filter((d) => !dying.includes(d));

    // 새로 만들어진 특수 타일
    for (const made of phase.created) {
      this.sprites[made.index] = {
        tile: { color: made.color, special: made.special },
        ox: 0,
        oy: 0,
        scale: 0.3,
        alpha: 1,
      };
    }
    if (phase.created.length > 0) {
      await this.animate(160, (p) => {
        for (const made of phase.created) {
          const s = this.sprites[made.index];
          if (s) s.scale = 0.3 + 0.7 * easeBack(p);
        }
      });
      for (const made of phase.created) {
        const s = this.sprites[made.index];
        if (s) s.scale = 1;
      }
    }
  }

  // ---------- 파티클 ----------

  private spawnParticles(cellIndex: number, color: number): void {
    const cx = this.cellX(cellIndex) + this.cell / 2;
    const cy = this.cellY(cellIndex) + this.cell / 2;
    const hue = COLOR_HUES[color % COLOR_HUES.length];
    for (let n = 0; n < 7; n++) {
      const angle = (Math.PI * 2 * n) / 7 + Math.random();
      const speed = 40 + Math.random() * 90;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0,
        maxLife: 0.42 + Math.random() * 0.25,
        hue,
        size: this.cell * (0.06 + Math.random() * 0.08),
        gravity: 420,
      });
    }
  }

  /**
   * 위로 솟아오르는 기포. 케이지를 부쉈을 때 보드에서 장면 쪽으로 올라간다.
   * 두 영역이 한 캔버스라 경계 없이 넘어간다 — 이게 '따로 논다'는 느낌을 없앤다.
   */
  private spawnRise(cellIndex: number, count: number): void {
    const cx = this.cellX(cellIndex) + this.cell / 2;
    const cy = this.cellY(cellIndex) + this.cell / 2;
    for (let n = 0; n < count; n++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * this.cell,
        y: cy,
        vx: (Math.random() - 0.5) * 60,
        vy: -(160 + Math.random() * 200),
        life: 0,
        maxLife: 1.5 + Math.random() * 0.7,
        hue: 190,
        size: this.cell * (0.07 + Math.random() * 0.09),
        gravity: -140, // 물속이라 위로 뜬다
      });
    }
  }

  private spawnBurst(cellIndex: number, special: Special): void {
    const cx = this.cellX(cellIndex) + this.cell / 2;
    const cy = this.cellY(cellIndex) + this.cell / 2;
    const count = special === 'voidPearl' ? 26 : 16;
    for (let n = 0; n < count; n++) {
      const angle = (Math.PI * 2 * n) / count;
      const speed = 140 + Math.random() * 160;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.5,
        hue: special === 'mine' ? 20 : special === 'voidPearl' ? 300 : 190,
        size: this.cell * 0.09,
        gravity: 420,
      });
    }
  }

  // ---------- 그리기 ----------

  /** 움직이는 게 하나도 없으면 프레임을 그리지 않는다 (모바일 배터리) */
  private needsFrame(): boolean {
    return (
      this.dirty ||
      this.scene !== null || // 구조 연출은 항상 움직인다
      this.particles.length > 0 ||
      this.dying.length > 0 ||
      this.hinted !== null ||
      this.hasDiver ||
      !this.water.empty // 보드 위 잠수부와 탈출구는 계속 움직인다
    );
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.time += dt;
    this.scene?.step(dt);
    this.water.step(dt);
    if (this.particles.length > 0) this.stepParticles(dt);
    if (this.needsFrame()) {
      this.draw();
      this.dirty = false;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private stepParticles(dt: number): void {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.97;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // 위험할 때 화면 전체가 흔들린다 — 장면과 보드가 같이 흔들려야 한 화면으로 읽힌다
    const shake = this.scene?.shake() ?? 0;
    ctx.save();
    if (shake !== 0) ctx.translate(shake, shake * 0.4);

    if (this.scene && this.sceneH > 0) {
      // ScenePainter 전용 — Stage 에는 없다. Task 7 에서 되살리거나 지운다.
      // this.scene.paintBackdrop(ctx, 0, 0, this.w, this.sceneH);
    }

    const total = this.cols * this.rows;

    // 자갈 더미 — 3D 무대(Seafloor)가 보드보다 앞에서 그린다. 여기서는 안 그린다.

    // 장면과 자갈이 맞닿는 선. 그냥 두면 두 그림을 잘라 붙인 이음매가 그대로 보인다.
    // 위쪽 바위턱이 드리우는 그늘을 깔아 하나의 공간으로 잇는다.
    if (this.sceneH > 0) {
      const seam = ctx.createLinearGradient(0, this.sceneH, 0, this.sceneH + this.cell * 1.2);
      seam.addColorStop(0, 'rgba(0, 8, 14, 0.85)');
      seam.addColorStop(1, 'rgba(0, 8, 14, 0)');
      ctx.fillStyle = seam;
      ctx.fillRect(0, this.sceneH, this.w, this.cell * 1.2);
    }

    // 칸 배경 — 자갈을 파낸 자리라 바닥에 해저 모래가 드러난다
    const sand = texturePattern(ctx, 'sand', (this.cell * 2.6) / 512);
    for (let i = 0; i < total; i++) {
      if (this.holes[i]) continue;
      const x = this.cellX(i);
      const y = this.cellY(i);
      roundRect(ctx, x + 1, y + 1, this.cell - 2, this.cell - 2, this.cell * 0.18);
      if (sand) {
        ctx.fillStyle = sand;
        ctx.fill();
        // 모래만 깔면 밝아서 타일이 안 뜬다. 물속 그늘을 덮어 가라앉힌다.
        ctx.fillStyle = 'rgba(3, 20, 30, 0.62)';
      } else {
        ctx.fillStyle = 'rgba(3, 20, 30, 0.55)';
      }
      ctx.fill();
    }

    // 탈출 수로 — 아직 안 판 곳이 어디인지 보여준다
    if (this.hasDiver) this.drawChannel();
    // 흘러든 물
    this.water.draw(ctx);

    // 사라지는 타일
    for (const d of this.dying) {
      const e = easeOut(d.t);
      this.drawTile(d.cell, d.tile, 0, 0, 1 + e * 0.35, 1 - e);
    }

    // 살아있는 타일
    for (let i = 0; i < total; i++) {
      const s = this.sprites[i];
      if (!s) continue;
      this.drawTile(i, s.tile, s.ox, s.oy, s.scale, s.alpha);
    }

    // 장애물은 타일 위에 얹는다. 결빙도 이제 타일을 덮는 얼음이라 여기서 그린다 —
    // 아래에 깔면 '이 칸은 얼어 있다'가 안 읽히고, 겹 수를 세는 단서도 사라진다.
    for (let i = 0; i < total; i++) {
      const blocker = this.blockers[i];
      if (blocker === 'rock') this.drawRock(i);
      else if (blocker === 'net') this.drawNet(i);
      else if (blocker === 'ice') this.drawIce(i);
      else if (blocker === 'rubble') this.drawRubble(i);
    }

    // 커서가 얹힌 칸 (PC). 선택 표시보다 약해야 '아직 안 골랐다'로 읽힌다.
    if (this.hoverCell >= 0 && !this.locked && this.hoverCell !== this.selected) {
      const x = this.cellX(this.hoverCell);
      const y = this.cellY(this.hoverCell);
      ctx.save();
      // 힌트는 황동색으로 깜빡인다. 커서 표시가 같은 색이면 '둘 수 있는 수'로 오해한다.
      // 차가운 흰빛으로 구분한다 — 게임의 신호가 아니라 커서의 위치다.
      ctx.strokeStyle = 'rgba(198, 232, 248, 0.5)';
      ctx.lineWidth = Math.max(1.5, this.cell * 0.03);
      roundRect(ctx, x + 2, y + 2, this.cell - 4, this.cell - 4, this.cell * 0.18);
      ctx.stroke();
      ctx.restore();
    }

    // 입구 / 탈출구 표시
    if (this.hasDiver) this.drawRescueMarkers();

    // 잠수부는 3D 무대가 그린다 — 3D 캔버스가 보드보다 앞이라 타일 위를 지나가도
    // 가려지지 않는다. 탈출 중이 아니면 descentPoint() 가 null 을 돌려주고
    // setDescent(null) 은 장면 안 제자리로 돌아가라는 신호가 된다.
    this.scene?.setDescent(this.descentPoint());

    // 선택 / 힌트.
    //
    // 고른 칸의 타일이 그 사이에 사라졌을 수 있다 (연쇄로 같이 터진 경우).
    // 그러면 선택 테두리만 물 위에 덩그러니 남으므로 그리기 직전에 한 번 더 확인한다.
    if (!this.playable(this.selected)) this.selected = null;
    if (this.selected !== null) this.drawSelection(this.selected, '#ffffff', 1);
    if (this.hinted) {
      const pulse = 0.4 + 0.35 * Math.sin(this.time * 5);
      this.drawSelection(this.hinted[0], '#ffe08a', pulse);
      this.drawSelection(this.hinted[1], '#ffe08a', pulse);
    }
    if (this.targetMode) {
      ctx.strokeStyle = 'rgba(255,224,138,0.75)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.strokeRect(
        this.originX - 3,
        this.originY - 3,
        this.cell * this.cols + 6,
        this.cell * this.rows + 6,
      );
      ctx.setLineDash([]);
    }

    // 파티클 — 장면 영역까지 그대로 날아간다 (같은 캔버스라 경계가 없다)
    for (const p of this.particles) {
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = `hsl(${p.hue} 90% 70%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.scene?.render();
  }

  private drawSelection(i: number, color: string, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    roundRect(ctx, this.cellX(i) + 2, this.cellY(i) + 2, this.cell - 4, this.cell - 4, this.cell * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 결빙 — 타일을 덮은 얼음. 남은 겹만큼 제거 판정을 흡수한다.
   *
   * 두께를 **불투명도로** 나타내면 안 된다. 2겹을 진하게 칠하는 순간 밑 타일 색이
   * 안 보이고, 색을 못 읽으면 그 칸을 낀 매치를 계획할 수가 없다 — 장애물이 아니라
   * 그냥 가려진 칸이 된다. 유리는 얇게 유지하고, 겹 수는 **테두리**로 센다.
   */
  private drawIce(i: number): void {
    const ctx = this.ctx;
    const x = this.cellX(i);
    const y = this.cellY(i);
    const c = this.cell;
    const hp = this.blockerHp[i];
    const art = bakedTile('ice', this.artSize);

    ctx.save();
    if (art) {
      ctx.globalAlpha = hp >= 2 ? 0.4 : 0.26;
      ctx.drawImage(art, x, y, c, c);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = hp >= 2 ? 'rgba(180,235,255,0.3)' : 'rgba(180,235,255,0.18)';
      roundRect(ctx, x + 1, y + 1, c - 2, c - 2, c * 0.18);
      ctx.fill();
    }

    // 테두리 한 겹 = 얼음 한 겹. 안쪽으로 겹칠수록 두꺼워 보인다.
    ctx.strokeStyle = 'rgba(214,246,255,0.8)';
    ctx.lineWidth = Math.max(1.5, c * 0.035);
    for (let n = 0; n < hp; n++) {
      const inset = 1.5 + n * c * 0.09;
      roundRect(ctx, x + inset, y + inset, c - inset * 2, c - inset * 2, c * 0.18);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214,246,255,0.45)';
    }
    ctx.restore();
  }

  private drawRock(i: number): void {
    const ctx = this.ctx;
    const art = bakedTile(this.blockerHp[i] >= 2 ? 'rock2' : 'rock1', this.artSize);
    if (art) {
      ctx.drawImage(art, this.cellX(i), this.cellY(i), this.cell, this.cell);
      return;
    }
    const x = this.cellX(i) + this.cell / 2;
    const y = this.cellY(i) + this.cell / 2;
    const r = this.cell * 0.4;
    const hp = this.blockerHp[i];
    ctx.save();
    ctx.fillStyle = hp >= 2 ? '#5b6a7d' : '#7d8b9c';
    ctx.beginPath();
    for (let n = 0; n < 7; n++) {
      const a = (Math.PI * 2 * n) / 7 - Math.PI / 2;
      const rr = r * (n % 2 === 0 ? 1 : 0.82);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (n === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (hp >= 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNet(i: number): void {
    const ctx = this.ctx;
    const art = bakedTile('net', this.artSize);
    if (art) {
      ctx.drawImage(art, this.cellX(i), this.cellY(i), this.cell, this.cell);
      return;
    }
    const x = this.cellX(i);
    const y = this.cellY(i);
    const c = this.cell;
    ctx.save();
    ctx.strokeStyle = 'rgba(235,225,190,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let n = 1; n <= 3; n++) {
      ctx.moveTo(x + (c * n) / 4, y + 2);
      ctx.lineTo(x + (c * n) / 4, y + c - 2);
      ctx.moveTo(x + 2, y + (c * n) / 4);
      ctx.lineTo(x + c - 2, y + (c * n) / 4);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawTile(
    i: number,
    tile: Tile,
    ox: number,
    oy: number,
    scale: number,
    alpha: number,
  ): void {
    const ctx = this.ctx;
    const cx = this.cellX(i) + this.cell / 2 + ox;
    const cy = this.cellY(i) + this.cell / 2 + oy;
    const r = this.cell * 0.38 * scale;

    // 구워둔 에셋이 있으면 그걸 쓴다 (베벨·스페큘러·표면 디테일이 들어간 그림)
    const art = bakedTile(TILE_ART[tile.color] ?? 'tile0', this.artSize);
    if (art) {
      // 칸보다 살짝 크게 그려 서로 맞물리게 한다 — 사이가 벌어지면 블록이 아니라 아이콘으로 보인다
      const size = this.cell * scale * 1.1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(art, cx - size / 2, cy - size / 2, size, size);
      if (tile.special !== 'none') {
        ctx.translate(cx, cy);
        this.drawSpecial(tile.special, r);
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);

    const light = COLOR_LIGHT[tile.color] ?? '#ffffff';
    const dark = COLOR_DARK[tile.color] ?? '#888888';
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, light);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 2;

    // 색마다 실루엣을 다르게 해서 색약이어도 구분되게 한다
    ctx.beginPath();
    switch (tile.color) {
      case 0: // 산호 — 육각형
        for (let n = 0; n < 6; n++) {
          const a = (Math.PI / 3) * n - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          n === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      case 1: // 물방울 — 원
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        break;
      case 2: // 해초 — 둥근 사각
        roundRectCentered(ctx, r * 1.72, r * 1.72, r * 0.42);
        break;
      case 3: // 조개 — 부채꼴
        ctx.moveTo(0, r * 0.9);
        ctx.arc(0, r * 0.9, r * 1.5, Math.PI * 1.18, Math.PI * 1.82);
        ctx.closePath();
        break;
      case 4: // 해파리 — 돔
        ctx.arc(0, r * 0.1, r, Math.PI, Math.PI * 2);
        ctx.lineTo(r, r * 0.45);
        ctx.quadraticCurveTo(0, r * 0.9, -r, r * 0.45);
        ctx.closePath();
        break;
      default: // 진주알 — 마름모
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        break;
    }
    ctx.fill();
    ctx.stroke();

    // 하이라이트
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 0.4, r * 0.28, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;

    if (tile.special !== 'none') this.drawSpecial(tile.special, r);

    ctx.restore();
  }

  /**
   * 탈출 수로. 통로와 아직 안 뚫린 잔해를 한 줄기로 이어 그린다.
   * 이게 없으면 어디를 파야 하는지 안 보인다.
   */
  private drawChannel(): void {
    const ctx = this.ctx;
    const isRoute = (i: number): boolean =>
      i >= 0 && i < this.passages.length && (this.passages[i] || this.blockers[i] === 'rubble');

    ctx.save();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.3)';
    ctx.lineWidth = Math.max(3, this.cell * 0.1);
    ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(4, 26, 38, 0.9)';

    for (let i = 0; i < this.passages.length; i++) {
      if (!isRoute(i)) continue;
      const x = this.cellX(i);
      const y = this.cellY(i);
      const c = this.cell;
      // 이웃한 수로 칸까지 사각형을 늘려 이음매를 없앤다
      const left = isRoute(i - 1) && i % this.cols > 0 ? c * 0.5 : 0;
      const right = isRoute(i + 1) && i % this.cols < this.cols - 1 ? c * 0.5 : 0;
      const up = isRoute(i - this.cols) ? c * 0.5 : 0;
      const down = isRoute(i + this.cols) ? c * 0.5 : 0;
      roundRect(
        ctx,
        x + 2 - left,
        y + 2 - up,
        c - 4 + left + right,
        c - 4 + up + down,
        c * 0.22,
      );
      ctx.fill();
    }

    // 수로 테두리 — 길이 어디로 나 있는지 한눈에
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < this.passages.length; i++) {
      if (!isRoute(i)) continue;
      const cx = this.cellX(i) + this.cell / 2;
      const cy = this.cellY(i) + this.cell / 2;
      for (const [n, dx, dy] of [
        [i + 1, 1, 0],
        [i + this.cols, 0, 1],
      ] as const) {
        if (dx === 1 && i % this.cols === this.cols - 1) continue;
        if (!isRoute(n)) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * this.cell, cy + dy * this.cell);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 아직 안 치운 잔해 — 부수면 통로가 된다 */
  private drawRubble(i: number): void {
    const ctx = this.ctx;
    const x = this.cellX(i);
    const y = this.cellY(i);
    const c = this.cell;
    const hp = this.blockerHp[i];

    ctx.save();
    ctx.fillStyle = hp >= 3 ? '#4a5461' : hp === 2 ? '#5c6875' : '#6f7d8b';
    roundRect(ctx, x + 1, y + 1, c - 2, c - 2, c * 0.14);
    ctx.fill();

    // 자갈 알갱이 — 내구도가 낮을수록 성기다
    ctx.fillStyle = 'rgba(20, 28, 36, 0.45)';
    const grains = hp * 5;
    for (let n = 0; n < grains; n++) {
      const s = i * 31.7 + n * 12.9;
      const gx = x + c * (0.15 + (Math.abs(Math.sin(s)) * 0.7));
      const gy = y + c * (0.15 + (Math.abs(Math.cos(s * 1.3)) * 0.7));
      ctx.beginPath();
      ctx.arc(gx, gy, c * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    roundRect(ctx, x + 1, y + 1, c - 2, c - 2, c * 0.14);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 잠수부가 들어올 입구와 나갈 탈출구 표시.
   * 잠수부 자체는 여기서 안 그린다 — 칸에 갇힌 말이 아니라 위 장면에 있는 사람이다.
   */
  private drawRescueMarkers(): void {
    if (this.startCell >= 0 && !this.escapePath) {
      const ctx = this.ctx;
      const cx = this.cellX(this.startCell) + this.cell / 2;
      const top = this.cellY(this.startCell);
      const c = this.cell;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.6);

      ctx.save();
      // 위에서 내려온다는 신호 — 아래로 흐르는 쐐기 두 개
      ctx.fillStyle = `rgba(255, 210, 87, ${0.3 + pulse * 0.4})`;
      for (let n = 0; n < 2; n++) {
        const oy = top + c * (0.2 + n * 0.26) + Math.sin(this.time * 3 - n) * c * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx, oy + c * 0.18);
        ctx.lineTo(cx + c * 0.18, oy);
        ctx.lineTo(cx - c * 0.18, oy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    if (this.exitCell >= 0) {
      const ctx = this.ctx;
      const x = this.cellX(this.exitCell);
      const y = this.cellY(this.exitCell);
      const c = this.cell;
      const pulse = 0.45 + 0.35 * Math.sin(this.time * 3);

      ctx.save();
      const g = ctx.createRadialGradient(x + c / 2, y + c / 2, c * 0.1, x + c / 2, y + c / 2, c * 0.7);
      g.addColorStop(0, `rgba(95, 224, 160, ${0.5 + pulse * 0.4})`);
      g.addColorStop(1, 'rgba(95, 224, 160, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - c * 0.2, y - c * 0.2, c * 1.4, c * 1.4);

      ctx.strokeStyle = `rgba(160, 255, 210, ${0.7 + 0.3 * pulse})`;
      ctx.lineWidth = Math.max(2, c * 0.08);
      roundRect(ctx, x + 3, y + 3, c - 6, c - 6, c * 0.2);
      ctx.stroke();

      // 아래로 향하는 화살표 — 잠수부는 위에서 내려와 여기로 빠져나간다
      ctx.fillStyle = `rgba(180, 255, 220, ${0.6 + 0.4 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(x + c * 0.5, y + c * 0.72);
      ctx.lineTo(x + c * 0.72, y + c * 0.42);
      ctx.lineTo(x + c * 0.28, y + c * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x + c * 0.42, y + c * 0.25, c * 0.16, c * 0.2);
      ctx.restore();
    }
  }

  /**
   * 탈출 중 잠수부가 있어야 할 화면 좌표.
   *
   * 경로 위를 따라가되, 앞머리 구간에서는 장면 속 제자리에서 첫 칸까지 미끄러져 들어온다.
   * (갑자기 보드 안에서 튀어나오면 위에 있던 그 사람이라는 게 안 읽힌다)
   *
   * 반환 좌표는 뷰포트 기준이다(render3d/types.ts 의 BoardRect 와 같은 규칙) — 3D
   * 캔버스는 이 보드 캔버스와 다른 박스를 쓰므로, 캔버스 로컬 좌표를 그대로 넘기면
   * 두 박스의 차이만큼 어긋난다. Stage3D.setDescent() 가 자기 캔버스 로컬로 옮긴다.
   */
  private descentPoint(): DescentPoint | null {
    const path = this.escapePath;
    if (!path || path.length === 0) return null;

    const box = this.canvas.getBoundingClientRect();
    const entryX = box.left + this.cellX(path[0]) + this.cell / 2;
    const entryY = box.top + this.cellY(path[0]) + this.cell / 2;

    // 앞 15% 는 장면에서 보드 첫 칸으로 들어오는 구간
    const ENTER = 0.15;
    if (this.escapeT < ENTER) {
      const p = this.escapeT / ENTER;
      const from = this.scene?.diverAnchorScreen();
      if (!from) return { x: entryX, y: entryY, cell: this.cell, t: this.escapeT };
      return {
        x: from.x + (entryX - from.x) * p,
        y: from.y + (entryY - from.y) * p,
        cell: this.cell,
        t: this.escapeT,
      };
    }

    const t = ((this.escapeT - ENTER) / (1 - ENTER)) * (path.length - 1);
    const n = Math.min(path.length - 2, Math.max(0, Math.floor(t)));
    const frac = path.length > 1 ? t - n : 0;
    const ax = box.left + this.cellX(path[n]) + this.cell / 2;
    const ay = box.top + this.cellY(path[n]) + this.cell / 2;
    const bx = box.left + this.cellX(path[Math.min(path.length - 1, n + 1)]) + this.cell / 2;
    const by = box.top + this.cellY(path[Math.min(path.length - 1, n + 1)]) + this.cell / 2;
    return {
      x: ax + (bx - ax) * frac,
      y: ay + (by - ay) * frac,
      cell: this.cell,
      t: this.escapeT,
    };
  }

  private drawSpecial(special: Special, r: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';

    switch (special) {
      case 'currentH':
      case 'currentV': {
        if (special === 'currentV') ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(-r * 0.72, 0);
        ctx.lineTo(r * 0.72, 0);
        ctx.stroke();
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * r * 0.75, 0);
          ctx.lineTo(dir * r * 0.35, -r * 0.32);
          ctx.lineTo(dir * r * 0.35, r * 0.32);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'mine': {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2);
        ctx.fillStyle = '#1b232e';
        ctx.fill();
        ctx.strokeStyle = '#ffd257';
        ctx.lineWidth = Math.max(2, r * 0.12);
        for (let n = 0; n < 8; n++) {
          const a = (Math.PI / 4) * n;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46);
          ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
          ctx.stroke();
        }
        break;
      }
      case 'voidPearl': {
        const grad = ctx.createConicGradient
          ? ctx.createConicGradient(0, 0, 0)
          : ctx.createLinearGradient(-r, -r, r, r);
        for (let n = 0; n <= 6; n++) grad.addColorStop(n / 6, `hsl(${n * 60} 90% 65%)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1.5, r * 0.1);
        ctx.stroke();
        break;
      }
      case 'none':
        break;
    }
    ctx.restore();
  }
}

// ---------- 유틸 ----------

/** PointerEvent 와 터치 폴백이 공유하는 최소 형태 */
interface PointerLike {
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

function touchToPointer(touch: Touch): PointerLike {
  return { clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => undefined };
}

function preventDefault(e: Event): void {
  e.preventDefault();
}

function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

function easeBack(p: number): number {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  // 레이아웃 전(캔버스 1x1)에는 칸 크기가 0 이라 반지름이 음수로 내려온다.
  // arcTo 는 음수 반지름에 IndexSizeError 를 던져 그 프레임 전체가 죽는다.
  const r = clampRadius(radius, w, h);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** arcTo 가 받아들이는 범위로 자른다 (음수 금지, 변의 절반 이하) */
function clampRadius(r: number, w: number, h: number): number {
  return Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
}

function roundRectCentered(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  radius: number,
): void {
  const r = clampRadius(radius, w, h);
  const x = -w / 2;
  const y = -h / 2;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { idx };
