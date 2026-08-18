// 보드를 둘러싼 자갈 더미.
//
// 레퍼런스(로얄킹덤)의 핵심은 "직사각형 보드"가 아니라
// **자갈 더미 속에 파인 불규칙한 구멍이 보드**라는 점이다.
// 그래서 보드에 없는 칸(hole)을 빈 배경으로 두지 않고 자갈로 꽉 채운다.
//
// 자갈은 움직이지 않으므로 오프스크린에 한 번만 굽고 그 뒤로는 blit 만 한다.

// 알갱이를 절차적으로 찍으면 아무리 촘촘히 뿌려도 '그린 것'으로 보인다.
// 그래서 실제 자갈 사진(Poly Haven coral_gravel, CC0)을 심해 색으로 구워 깔고,
// 그 위에 칸별 얼룩과 가장자리 그늘만 얹는다.

import { texture } from '../textures.ts';

/** 시드 기반 0..1 난수 — 프레임마다 같은 얼룩이 나와야 한다 */
function hash01(n: number): number {
  const s = Math.sin(n * 91.7) * 41237.19;
  return s - Math.floor(s);
}

export class GravelField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cols = 0;
  private rows = 0;
  private cell = 0;
  private originX = 0;
  private originY = 0;
  private dpr = 1;
  private mask: boolean[] = [];
  private dirty = true;
  /** 사진이 아직 안 올라와서 임시로 구운 상태 */
  private pending = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  /**
   * @param mask true = 자갈로 채울 칸 (보드에 없는 칸)
   */
  setGrid(
    cols: number,
    rows: number,
    cell: number,
    originX: number,
    originY: number,
    dpr: number,
    mask: boolean[],
  ): void {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.originX = originX;
    this.originY = originY;
    this.dpr = dpr;
    this.mask = mask;

    // 보드 밖으로도 한 칸 넘치게 그려 가장자리가 잘린 느낌이 안 나게 한다
    const pad = cell;
    this.canvas.width = Math.max(1, Math.ceil((cols * cell + pad * 2) * dpr));
    this.canvas.height = Math.max(1, Math.ceil((rows * cell + pad * 2) * dpr));
    this.dirty = true;
  }

  get empty(): boolean {
    return !this.mask.some(Boolean);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.empty || this.cell <= 0) return;
    if (this.pending && texture('gravel')) this.dirty = true;
    if (this.dirty) this.bake();
    const pad = this.cell;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(
      this.canvas,
      Math.round((this.originX - pad) * this.dpr),
      Math.round((this.originY - pad) * this.dpr),
    );
    ctx.restore();
  }

  private bake(): void {
    const { ctx } = this;
    this.pending = false;
    const px = this.cell * this.dpr;
    const pad = px;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 자갈이 놓일 영역: 마스크 칸 + 보드 바깥 테두리
    const filled = (cx: number, cy: number): boolean => {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return true; // 보드 밖은 전부 자갈
      return this.mask[cy * this.cols + cx];
    };

    // 1) 바탕 — 텍스처가 아직 안 올라왔을 때를 위한 어두운 바닥
    ctx.fillStyle = '#232c35';
    for (let cy = -1; cy <= this.rows; cy++) {
      for (let cx = -1; cx <= this.cols; cx++) {
        if (!filled(cx, cy)) continue;
        ctx.fillRect(pad + cx * px, pad + cy * px, px + 1, px + 1);
      }
    }

    // 2) 자갈 사진을 타일링해 덮는다.
    //    알갱이가 한 칸에 서너 개 보이는 정도가 실물 스케일로 읽힌다.
    const img = texture('gravel');
    if (img) {
      // 한 칸에 텍스처를 다 밀어넣으면 알갱이가 뭉개져 노이즈가 된다.
      // 두 칸에 한 장 정도가 자갈 알갱이 크기로 읽힌다.
      const tile = px * 2.0;
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        const m = new DOMMatrix();
        pattern.setTransform(m.scale(tile / img.naturalWidth));
        ctx.save();
        ctx.beginPath();
        for (let cy = -1; cy <= this.rows; cy++) {
          for (let cx = -1; cx <= this.cols; cx++) {
            if (!filled(cx, cy)) continue;
            ctx.rect(pad + cx * px, pad + cy * px, px + 1, px + 1);
          }
        }
        ctx.clip();
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 사진 그대로면 밝은 회색 바닥이 되어 타일이 안 떠오른다.
        // 물속 깊이만큼 한 겹 가라앉혀야 보드가 주인공이 된다.
        ctx.fillStyle = 'rgba(4, 20, 30, 0.55)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 3) 부드러운 얼룩으로 사진 반복을 흐린다.
        //    칸 단위 사각형으로 덮으면 격자가 드러나므로 원형 그라디언트로 흩뿌린다.
        const blotches = Math.max(12, Math.round(this.cols * this.rows * 0.4));
        for (let n = 0; n < blotches; n++) {
          const bx = pad + hash01(n * 1.7) * this.cols * px;
          const by = pad + hash01(n * 1.7 + 0.41) * this.rows * px;
          const r = px * (1.2 + hash01(n * 1.7 + 0.83) * 2.2);
          const dark = hash01(n * 1.7 + 1.29) > 0.45;
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
          g.addColorStop(0, dark ? 'rgba(0, 8, 16, 0.3)' : 'rgba(150, 190, 220, 0.07)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(bx - r, by - r, r * 2, r * 2);
        }
        ctx.restore();
      }
    } else {
      // 사진이 아직이면 다음 프레임에 다시 굽는다
      this.pending = true;
    }

    // 3) 보드에 닿는 가장자리에 그늘 — 자갈이 파인 구멍을 둘러싼 것처럼 보인다
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let cy = -1; cy <= this.rows; cy++) {
      for (let cx = -1; cx <= this.cols; cx++) {
        if (!filled(cx, cy)) continue;
        // 열린 칸과 맞닿은 변에 어두운 띠
        const edges: [number, number, number, number][] = [];
        const x0 = pad + cx * px;
        const y0 = pad + cy * px;
        if (!filled(cx - 1, cy)) edges.push([x0, y0, px * 0.28, px]);
        if (!filled(cx + 1, cy)) edges.push([x0 + px * 0.72, y0, px * 0.28, px]);
        if (!filled(cx, cy - 1)) edges.push([x0, y0, px, px * 0.28]);
        if (!filled(cx, cy + 1)) edges.push([x0, y0 + px * 0.72, px, px * 0.28]);
        for (const [ex, ey, ew, eh] of edges) {
          const g =
            ew > eh
              ? ctx.createLinearGradient(0, ey, 0, ey + eh)
              : ctx.createLinearGradient(ex, 0, ex + ew, 0);
          const near = ew > eh ? (ey === y0 ? 0 : 1) : ex === x0 ? 0 : 1;
          g.addColorStop(near, 'rgba(0, 8, 16, 0.55)');
          g.addColorStop(1 - near, 'rgba(0, 8, 16, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(ex, ey, ew, eh);
        }
      }
    }
    ctx.restore();

    this.dirty = false;
  }
}
