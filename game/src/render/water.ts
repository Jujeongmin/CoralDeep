// 흘러드는 물 레이어.
//
// 칸마다 파란 사각형을 칠하면 '물 타일'로 보이지 액체로 안 보인다.
// 그래서 칸 단위가 아니라 하나의 액체 덩어리로 그린다:
//
//   1) 물이 찬 칸마다 원을 찍은 마스크를 만들고 blur + contrast 를 걸어
//      경계가 서로 녹아붙은 매끈한 덩어리(메타볼)로 만든다.
//   2) 그 마스크로 물빛 그라디언트 · 코스틱(수면 굴절광) · 기포를 오려낸다.
//   3) 경계선에는 밝은 하이라이트를 얹고, 수면은 시간에 따라 일렁이게 한다.
//
// 새로 열린 칸은 fill 0 -> 1 로 서서히 차오르므로 물이 '흘러드는' 것처럼 보인다.

export class WaterLayer {
  private mask: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private layerCtx: CanvasRenderingContext2D;

  private cols = 0;
  private cell = 0;
  private originX = 0;
  private originY = 0;
  private dpr = 1;

  /** 칸별 물이 찬 정도 0..1 (표시값) */
  private fill: number[] = [];
  private target: number[] = [];
  private maskDirty = true;
  private time = 0;

  constructor() {
    this.mask = document.createElement('canvas');
    this.layer = document.createElement('canvas');
    const m = this.mask.getContext('2d');
    const l = this.layer.getContext('2d');
    if (!m || !l) throw new Error('2d context unavailable');
    this.maskCtx = m;
    this.layerCtx = l;
  }

  /** 보드 레이아웃이 바뀌면 부른다 */
  setGrid(
    cols: number,
    rows: number,
    cell: number,
    originX: number,
    originY: number,
    dpr: number,
  ): void {
    this.cols = cols;
    this.cell = cell;
    this.originX = originX;
    this.originY = originY;
    this.dpr = dpr;

    const w = Math.max(1, Math.ceil(cols * cell * dpr));
    const h = Math.max(1, Math.ceil(rows * cell * dpr));
    for (const c of [this.mask, this.layer]) {
      c.width = w;
      c.height = h;
    }
    if (this.fill.length !== cols * rows) {
      this.fill = new Array(cols * rows).fill(0);
      this.target = new Array(cols * rows).fill(0);
    }
    this.maskDirty = true;
  }

  /** 보드의 통로 상태를 그대로 반영한다 (즉시 채움) */
  syncFrom(passages: boolean[]): void {
    for (let i = 0; i < this.target.length; i++) {
      this.target[i] = passages[i] ? 1 : 0;
      this.fill[i] = this.target[i];
    }
    this.maskDirty = true;
  }

  /** 이 칸에 물이 흘러들기 시작한다 */
  open(i: number): void {
    if (i < 0 || i >= this.target.length) return;
    this.target[i] = 1;
  }

  /** 아직 차오르는 중인 칸이 있는가 */
  get flowing(): boolean {
    for (let i = 0; i < this.fill.length; i++) {
      if (Math.abs(this.target[i] - this.fill[i]) > 0.01) return true;
    }
    return false;
  }

  step(dt: number): void {
    this.time += dt;
    let changed = false;
    for (let i = 0; i < this.fill.length; i++) {
      const d = this.target[i] - this.fill[i];
      if (Math.abs(d) < 0.001) continue;
      this.fill[i] += d * Math.min(1, dt * 5.5);
      changed = true;
    }
    if (changed) this.maskDirty = true;
  }

  /** 물이 하나도 없으면 그릴 게 없다 */
  get empty(): boolean {
    return this.fill.every((f) => f <= 0.01);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.empty || this.cell <= 0) return;
    if (this.maskDirty) this.buildMask();

    const { layerCtx: lc } = this;
    const w = this.layer.width;
    const h = this.layer.height;
    const px = this.cell * this.dpr;

    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, w, h);

    // 물빛 — 깊은 바닷물. 남은 타일이 묻히지 않게 어둡게 깐다.
    const g = lc.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0e5273');
    g.addColorStop(0.55, '#0a3f5c');
    g.addColorStop(1, '#062c42');
    lc.fillStyle = g;
    lc.fillRect(0, 0, w, h);

    // 코스틱 — 수면에서 굴절된 빛이 바닥에 어른거린다. 은은해야 물처럼 보인다.
    lc.save();
    lc.globalCompositeOperation = 'lighter';
    lc.globalAlpha = 0.16;
    lc.strokeStyle = '#8fe6ff';
    lc.lineWidth = Math.max(1, px * 0.03);
    for (let n = 0; n < 9; n++) {
      const phase = this.time * (0.5 + n * 0.12) + n * 1.7;
      lc.beginPath();
      for (let sx = -px; sx <= w + px; sx += px * 0.3) {
        const sy =
          ((n / 9) * h + Math.sin(phase + sx * 0.018) * px * 0.35 + this.time * px * 0.18) %
          (h + px);
        sx === -px ? lc.moveTo(sx, sy) : lc.lineTo(sx, sy);
      }
      lc.stroke();
    }
    lc.restore();

    // 기포 — 물속에서 위로 올라간다
    lc.save();
    lc.fillStyle = 'rgba(200, 240, 255, 0.55)';
    for (let n = 0; n < 18; n++) {
      const seed = n * 47.3;
      const bx = ((Math.sin(seed) * 0.5 + 0.5) * w + Math.sin(this.time * 1.4 + n) * px * 0.15) % w;
      const span = h + px * 2;
      const by = h - ((this.time * (30 + (n % 6) * 14) * this.dpr + seed * 31) % span);
      const r = (1 + (n % 3) * 0.7) * this.dpr;
      lc.globalAlpha = 0.15 + 0.35 * (by / h);
      lc.beginPath();
      lc.arc(bx, by, r, 0, Math.PI * 2);
      lc.fill();
    }
    lc.restore();

    // 마스크로 오려내면 액체 덩어리 모양만 남는다
    lc.save();
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(this.mask, 0, 0);
    lc.restore();

    // 본 캔버스에 얹는다
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dx = this.originX * this.dpr;
    const dy = this.originY * this.dpr;
    ctx.drawImage(this.layer, dx, dy);

    // 수면 하이라이트 — 마스크를 살짝 올려 겹치면 액체 덩어리의 위쪽 테두리만 밝게 남는다.
    // 이 테두리가 있어야 '고여 있는 물'로 보인다.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.drawImage(this.mask, dx, dy - Math.max(1, px * 0.07));
    ctx.globalAlpha = 0.1;
    ctx.drawImage(this.mask, dx + Math.max(1, px * 0.05), dy - Math.max(2, px * 0.14));
    ctx.restore();
  }

  /**
   * 물이 찬 칸마다 원을 찍고 blur + contrast 로 뭉갠다.
   * 원들이 서로 녹아붙어 사각형 격자가 아니라 하나의 액체 윤곽이 된다.
   */
  private buildMask(): void {
    const mc = this.maskCtx;
    const w = this.mask.width;
    const h = this.mask.height;
    const px = this.cell * this.dpr;

    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.filter = 'none';
    mc.clearRect(0, 0, w, h);

    // blur 로 번진 만큼 contrast 가 다시 조여준다 → 매끈한 경계
    mc.filter = `blur(${(px * 0.28).toFixed(1)}px) contrast(14)`;
    mc.fillStyle = '#ffffff';

    for (let i = 0; i < this.fill.length; i++) {
      const f = this.fill[i];
      if (f <= 0.02) continue;
      const cx = ((i % this.cols) + 0.5) * px;
      const cy = (Math.floor(i / this.cols) + 0.5) * px;
      // 차오르는 중이면 작게 시작해서 이웃과 이어붙는다
      const r = px * (0.34 + 0.34 * f);
      mc.beginPath();
      mc.arc(cx, cy, r, 0, Math.PI * 2);
      mc.fill();
    }

    mc.filter = 'none';
    this.maskDirty = false;
  }
}
