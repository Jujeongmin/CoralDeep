// 레벨 장면 — 모든 레벨의 보드 위쪽에 그려지는 연출.
//
// 보드와 '같은 캔버스'를 나눠 쓴다. 따로 노는 박스가 아니라 보드가 이 장면의 바닥이 되도록.
// 잠수부는 한 장짜리 그림이 아니라 부위별 스프라이트를 관절 기준으로 회전시켜 움직인다.
//
// 목표 종류에 따라 앞을 막는 소품이 달라지고, 수심에 따라 물빛·광선·부유물·포식자가 달라진다.
// 잠수부·벽·바위턱·흔들림은 전 레벨이 공유한다.

import { BOULDER_ART, bakedTile } from '../tiles.ts';
import { texturePattern } from '../textures.ts';
import { DIVER_FEET, DIVER_SPAN, type DiverPose, drawDiver, helmetPos } from './diverRig.ts';
import { EEL_HEAD_H, drawEelHead } from './eelRig.ts';
import { type DepthMood, depthMood, rgba } from './depth.ts';
import { predatorFor } from '../levels.ts';
import {
  ANGLER_HEAD_H,
  ANGLER_MOUTH,
  CLUB_GRIP,
  CLUB_H,
  drawAngler,
  drawTentacle,
} from './predatorRig.ts';

export type SceneVariant = 'rescue' | 'ice' | 'rock' | 'net';

export interface SceneView {
  /** 0 = 여유, 1 = 한계 (구조 미션은 산소, 그 외는 남은 이동 수) */
  danger: number;
  /** 레벨 목표 달성률 0..1 — 앞을 막은 소품이 이만큼 걷힌다 */
  progress: number;
  /** 구조 미션에서 구조한 인원 */
  rescued: number;
  total: number;
}

interface RockDef {
  /** 더미 박스 안 상대 좌표 0..1 */
  x: number;
  y: number;
  /** 장면 높이 대비 반지름 */
  r: number;
  rot: number;
  /** 모서리마다의 들쭉날쭉함 0..1 */
  jitter: number[];
  dark: boolean;
  coral: boolean;
  coralHue: string;
  /** 구워둔 바위 에셋 중 몇 번째를 쓸지 */
  variant: number;
}

/** 시드 기반 0..1 난수. 프레임마다 같은 값이 나와야 하므로 Math.random 을 쓰지 않는다. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 곰치가 노리는 지점 — 잠수부 머리 (스프라이트 원본 단위, 기준점에서 상대).
 *
 * 기준점은 몸통 윗면(z 1.52)이고 머리는 1.43~1.89 에 있다. 머리 한가운데(1.66)는
 * 기준점보다 0.14 위 = 약 24 단위 위다. 가로는 거의 중앙이라 조금만 오른쪽으로 둔다.
 */
const HEAD_X = 10;
const HEAD_Y = -24;

/** 수심대별 포식자 */
export type PredatorKind = 'eel' | 'angler' | 'tentacle';

interface PredatorSpec {
  /** 등장 지점 — 장면 사각형 기준 비율. 화면 밖이어야 '멀리서 온다'가 읽힌다. */
  origin: [number, number];
  /** 머리(또는 곤봉) 높이 / 장면 높이 */
  headH: number;
  /** 그 머리 스프라이트의 원본 높이 — 둘을 나눈 값이 배율이다 */
  artH: number;
  /** 회전축에서 입 안쪽까지 (원본 단위, +x 가 진행 방향) */
  mouth: [number, number];
  /** danger 0 일 때 이미 나와 있는 비율 */
  emerge: number;
  /** emerge 에서 더 나아갈 수 있는 비율 */
  span: number;
  /**
   * 접근 곡선의 지수.
   *
   * 1 이면 등속이라 초반부터 같은 압박이 이어져 오히려 무뎌진다. 1 보다 크면 앞쪽은
   * 천천히 나오다 끝에서 확 덮친다 — 시간이 줄고 있다는 게 몸으로 읽힌다.
   */
  curve: number;
  /** 몸통 흔들림 진폭 / 장면 높이 */
  wave: number;
}

/**
 * 수심이 곧 포식자다.
 *
 * 햇빛대에는 바위굴의 곰치, 박명대에는 유인등을 흔드는 아귀, 그 아래 암흑에는
 * 몸통도 안 보이는 대왕오징어의 팔 하나. 내려갈수록 상대가 커지고 덜 보인다.
 */
const PREDATORS: Record<PredatorKind, PredatorSpec> = {
  eel: {
    origin: [1.15, 0.06],
    headH: 0.28,
    artH: EEL_HEAD_H,
    mouth: [105, 19],
    emerge: 0.18,
    span: 0.74,
    curve: 1.7,
    wave: 0.09,
  },
  angler: {
    // 아귀는 헤엄쳐 온다. 굴이 아니라 열린 물에서 나오므로 조금 더 아래·더 멀리서.
    origin: [1.22, 0.3],
    headH: 0.34,
    artH: ANGLER_HEAD_H,
    mouth: ANGLER_MOUTH,
    emerge: 0.12,
    span: 0.8,
    curve: 2.1,
    wave: 0.05,
  },
  tentacle: {
    // 위에서 내려온다. 잠수부가 올려다볼 곳이 없다는 게 이 층의 압박이다.
    origin: [0.62, -0.5],
    headH: 0.3,
    artH: CLUB_H,
    mouth: CLUB_GRIP,
    emerge: 0.22,
    span: 0.72,
    curve: 1.5,
    wave: 0.07,
  },
};

export class LevelScene {
  private view: SceneView = { danger: 0, progress: 0, rescued: 0, total: 0 };
  private time = 0;
  private danger = 0;
  private dangerTarget = 0;
  /** 소품이 걷힌 정도 (표시값) */
  private cleared = 0;
  private clearedTarget = 0;
  /** 구조 완료 연출 진행도 */
  private escape = 0;
  private cheerT = 0;
  private shakeT = 0;
  /** 잡아먹히는 연출 진행도 0..1 */
  private devourT = 0;

  private mood: DepthMood;
  private predator: PredatorKind;

  /**
   * @param variant 앞을 막은 소품 (레이아웃의 장애물에서 고른다)
   * @param depth   진행도 0..1 — 물빛·광선·부유물·포식자가 여기서 갈린다
   */
  constructor(
    private variant: SceneVariant,
    depth = 0,
  ) {
    this.mood = depthMood(depth);
    this.predator = predatorFor(depth);
  }

  /** 시간이 다 됐다. 곰치가 달려들어 잠수부를 물어간다. */
  devour(): void {
    if (this.devourT > 0) return;
    this.devourT = 0.001;
    this.shakeT = 1.2;
  }

  update(view: SceneView): void {
    this.view = view;
    const done = this.variant === 'rescue' && view.total > 0 && view.rescued >= view.total;
    this.dangerTarget = done ? 0 : Math.max(0, Math.min(1, view.danger));
    this.clearedTarget = Math.max(0, Math.min(1, view.progress));
  }

  /** 장애물을 하나 부쉈을 때 */
  cheer(): void {
    this.cheerT = 1;
    this.shakeT = 0.5;
  }

  step(dt: number): void {
    this.time += dt;
    this.danger += (this.dangerTarget - this.danger) * Math.min(1, dt * 4);
    this.cleared += (this.clearedTarget - this.cleared) * Math.min(1, dt * 3);
    const done = this.variant === 'rescue' && this.view.total > 0 && this.view.rescued >= this.view.total;
    this.escape += ((done ? 1 : 0) - this.escape) * Math.min(1, dt * 2);
    this.cheerT = Math.max(0, this.cheerT - dt * 1.4);
    this.shakeT = Math.max(0, this.shakeT - dt * 2.4);
    if (this.devourT > 0) this.devourT = Math.min(1, this.devourT + dt * 1.4);
  }

  /** 잡아먹히는 연출 진행도 (하네스에서 특정 시점을 재현할 때 쓴다) */
  devourProgress(): number {
    return this.devourT;
  }

  /** 화면을 흔들 픽셀 양 */
  shake(): number {
    const fromDanger = this.danger > 0.78 ? (this.danger - 0.78) / 0.22 : 0;
    const amount = Math.max(fromDanger * 2, this.shakeT * 4);
    return amount === 0 ? 0 : Math.sin(this.time * 46) * amount;
  }

  /** 이 장면이 캔버스에서 차지할 높이. 구조 미션은 보여줄 게 많아 조금 더 크다. */
  /**
   * 장면 높이.
   *
   * 좁으면 곰치가 다가올 거리 자체가 없어서 '점점 가까워진다'가 안 읽힌다.
   * 보드 칸이 너무 작아지지 않는 선까지 키웠다.
   */
  height(canvasH: number): number {
    const ratio = this.variant === 'rescue' ? 0.38 : 0.28;
    const max = this.variant === 'rescue' ? 280 : 190;
    return Math.min(max, Math.max(130, canvasH * ratio));
  }

  /**
   * 잠수부가 보드로 내려갈 때 쓸 위치. 보드 뷰가 탈출 경로 위의 좌표를 넣어준다.
   * null 이면 장면 안의 제자리에 있다.
   */
  private descent: { x: number; y: number; scale: number; t: number } | null = null;

  setDescent(point: { x: number; y: number; scale: number; t: number } | null): void {
    this.descent = point;
  }

  /** 잠수부를 뺀 배경. 보드보다 먼저 그린다. */
  paintBackdrop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // 물 자체가 제일 뒤. 수심이 여기서 읽힌다.
    this.drawWater(ctx, x, y, w, h);
    this.drawWalls(ctx, x, y, w, h);

    // 다가오는 포식자 = 제한 시간. 모든 레벨에 나오고, 가장 앞에 그려야 읽힌다.
    this.drawEel(ctx, x, y, w, h);

    this.drawLedge(ctx, x, y, w, h);
    // 부유물은 벽·생물보다 앞이다. 사이에 뭔가 떠 있어야 물속 거리감이 산다.
    this.drawDrift(ctx, x, y, w, h);
    this.drawVignette(ctx, x, y, w, h);

    ctx.restore();
  }

  /**
   * 잠수부. 보드를 다 그린 뒤 맨 위에 그린다.
   *
   * 장면 안에 있을 때만 장면 영역으로 자른다. 탈출 중에는 보드까지 내려가야 하므로
   * 자르지 않는다 — 이 사람이 곧 플레이어가 구하는 대상이고, 칸에 갇힌 말이 아니다.
   */
  paintDiver(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.descent) {
      this.drawDiverAt(ctx, this.descent.x, this.descent.y, this.descent.scale);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    this.drawDiver(ctx, x, y, w, h);
    // 물렸으면 곰치 턱이 잠수부를 덮는다
    this.drawEelBite(ctx, x, y, w, h);
    // 그를 가둔 소품(케이지·빙벽·어망)은 잠수부 **앞**에 와야 갇힌 걸로 읽힌다
    this.drawProp(ctx, x, y, w, h);
    ctx.restore();
  }

  // ---------- 공통 배경 ----------

  /**
   * 물 — 수심대의 색과 수면 광선.
   *
   * 예전엔 물을 따로 그리지 않고 벽과 소품 사이로 캔버스 바닥색이 비쳤다. 그래서 12m 든
   * 640m 든 같은 남색이었다. 여기서 색을 깔아야 지도의 수심 숫자와 화면이 맞는다.
   */
  private drawWater(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const m = this.mood;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, m.top);
    g.addColorStop(1, m.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // 수면에서 비스듬히 내리꽂히는 빛기둥. 깊어지면 사라진다 — 빛이 안 닿는 게 곧 깊이다.
    if (m.shafts > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let n = 0; n < 5; n++) {
        // 폭·기울기·속도를 다 다르게 둔다. 같으면 커튼 무늬가 되어 물이 아니라 벽지로 보인다.
        //
        // 얇아야 한다. 넓게 잡으면 다섯 줄기가 서로 겹쳐 한 장의 판때기가 되고,
        // '빛이 물을 가른다'가 아니라 '화면 가운데가 밝다'로 보인다.
        const seed = hash01(n * 3.7);
        const sway = Math.sin(this.time * (0.14 + seed * 0.12) + n * 2.1) * w * 0.05;
        const cx = x + w * (0.14 + seed * 0.72) + sway;
        const wide = w * (0.016 + seed * 0.022);
        const lean = w * 0.09;
        const beam = ctx.createLinearGradient(0, y, 0, y + h);
        const peak = 0.11 * m.shafts * (0.6 + 0.4 * Math.sin(this.time * 0.7 + n));
        // 위에서 바로 사라지지 않고 중간까지 살아 있다가 꺼져야 '내리꽂힌다'가 읽힌다
        beam.addColorStop(0, rgba([210, 245, 255], peak));
        beam.addColorStop(0.45, rgba([210, 245, 255], peak * 0.45));
        beam.addColorStop(1, rgba([210, 245, 255], 0));
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(cx - wide, y);
        ctx.lineTo(cx + wide, y);
        ctx.lineTo(cx + wide * 0.35 + lean, y + h);
        ctx.lineTo(cx - wide * 0.35 + lean, y + h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * 부유물 — 마린 스노우와 발광 생물.
   *
   * 깊어질수록 볼 게 줄어드는 만큼 **떠다니는 것은 늘린다.** 텅 빈 검은 화면은 깊이가
   * 아니라 로딩 실패로 읽힌다. 얕은 곳에서는 몇 알 안 보이고, 심해로 가면 눈발처럼
   * 내리는 유기물 사이로 발광 생물이 켜졌다 꺼진다.
   */
  private drawDrift(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const m = this.mood;
    const flakes = Math.round(10 + m.snow * 46);
    ctx.save();
    for (let n = 0; n < flakes; n++) {
      const seed = hash01(n * 1.37);
      const seed2 = hash01(n * 5.11 + 2);
      // 가라앉는다. 화면을 벗어나면 위로 되돌린다 (나머지 연산이 곧 순환)
      const fall = (seed2 * h + this.time * h * (0.012 + seed * 0.03)) % (h * 1.1);
      const px = x + ((seed * w + Math.sin(this.time * 0.3 + n) * w * 0.012) % w);
      const py = y + fall;
      const r = Math.max(0.6, h * (0.002 + seed2 * 0.004));
      ctx.fillStyle = rgba([225, 245, 255], 0.1 + m.snow * 0.28 * (0.4 + seed * 0.6));
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 발광 생물 — 심해에서만. 깜빡이는 주기를 개체마다 어긋나게 둔다.
    if (m.glow > 0.04) {
      ctx.globalCompositeOperation = 'lighter';
      const lamps = Math.round(m.glow * 9);
      for (let n = 0; n < lamps; n++) {
        const seed = hash01(n * 9.31 + 7);
        const seed2 = hash01(n * 2.77 + 13);
        const pulse = Math.max(0, Math.sin(this.time * (0.5 + seed * 0.9) + n * 1.7));
        if (pulse < 0.02) continue;
        const px = x + w * (0.08 + seed * 0.84) + Math.sin(this.time * 0.35 + n) * w * 0.03;
        const py = y + h * (0.12 + seed2 * 0.66) + Math.cos(this.time * 0.28 + n * 2) * h * 0.04;
        const r = h * (0.02 + seed * 0.03);
        const halo = ctx.createRadialGradient(px, py, 0, px, py, r);
        halo.addColorStop(0, rgba(m.glowColor, 0.5 * m.glow * pulse));
        halo.addColorStop(1, rgba(m.glowColor, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawWalls(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save();
    // 실루엣만 검게 두면 종잇장처럼 보인다. 암벽 사진을 채워 질감을 준 뒤 어둡게 가라앉힌다.
    const rock = texturePattern(ctx, 'rock', (h * 0.9) / 512);
    ctx.fillStyle = rock ?? 'rgba(4, 22, 33, 0.92)';
    for (const side of [0, 1]) {
      const x0 = side === 0 ? x : x + w;
      const dir = side === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + dir * w * 0.28, y);
      for (let n = 1; n <= 5; n++) {
        const t = n / 5;
        const bump = w * (0.28 - t * 0.16) + Math.sin(n * 2.3 + side * 3) * w * 0.03;
        ctx.lineTo(x0 + dir * bump, y + h * t);
      }
      ctx.lineTo(x0, y + h);
      ctx.closePath();
      ctx.fill();
      if (rock) {
        // 안쪽(보드 쪽)으로 갈수록 밝아지는 물속 감쇠.
        // 깊을수록 전체가 더 가라앉는다 — 빛이 안 닿는 벽은 질감을 잃는다.
        const gloom = this.mood.gloom;
        const g = ctx.createLinearGradient(x0, 0, x0 + dir * w * 0.3, 0);
        g.addColorStop(0, rgba([2, 14, 22], 0.35 + gloom * 0.35));
        g.addColorStop(1, rgba([2, 14, 22], 0.62 + gloom * 0.33));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.fillStyle = rock;
      }
    }
    ctx.restore();
  }

  /** 장면 바닥의 바위 턱. 보드가 여기 얹힌 것처럼 보이게 해서 두 영역을 잇는다. */
  private drawLedge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const top = y + h * 0.88;
    const rock = texturePattern(ctx, 'boulder', (h * 0.55) / 512);
    ctx.save();
    ctx.fillStyle = rock ?? '#0a2634';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, top + h * 0.06);
    for (let n = 0; n <= 8; n++) {
      const t = n / 8;
      ctx.lineTo(x + w * t, top + Math.sin(n * 1.9) * h * 0.045);
    }
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
    if (rock) {
      ctx.fillStyle = 'rgba(4, 24, 36, 0.55)';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150, 220, 255, 0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const threshold = this.variant === 'rescue' ? 0.45 : 0.7;
    if (this.danger < threshold || this.escape > 0.4) return;
    const strength = (this.danger - threshold) / (1 - threshold);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 4.5);
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.2, x + w / 2, y + h / 2, h * 1.1);
    g.addColorStop(0, 'rgba(255,70,50,0)');
    g.addColorStop(1, `rgba(255,70,50,${0.45 * strength * pulse})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  /**
   * 제한 시간을 '다가오는 포식자'로 보여준다.
   *
   * 숫자 게이지 대신 **입과 잠수부 사이의 간격** 자체가 남은 시간이다.
   * danger 가 0이면 화면 밖에서 몸만 걸치고, 1이면 잠수부 코앞까지 와서 입을 벌린다.
   * 모든 레벨에 나온다 — 구조 미션은 산소, 그 외 레벨은 남은 이동 수가 danger 다.
   *
   * 어떤 생물이 나오는지는 수심이 정한다 (`PREDATORS`). 셋의 생김새와 등장 방향은
   * 다르지만 **접근 계산은 하나를 공유한다** — 등장 지점에서 잠수부까지 곡선을 따라
   * 다가오고, 겨냥점은 입 오프셋만큼 뒤로 당긴다.
   */
  /**
   * 포식자의 현재 기하 — 등장 지점, 머리 끝, 입 안 좌표.
   *
   * 배경(포식자)과 잠수부 배치가 **같은 값**을 써야 물렸을 때 입에 정확히 물린다.
   * 잠수부는 `diverRest`(가만히 있을 때의 자리)를 노린다 — 물려서 끌려간 위치를
   * 노리면 서로를 쫓는 순환이 된다.
   */
  private eelGeom(
    x: number,
    y: number,
    w: number,
    h: number,
  ): {
    originX: number;
    originY: number;
    /** 흔들림을 빼고 계산한 머리 위치 — 몸통 리본이 이 점을 향한다 */
    headX: number;
    headY: number;
    /** 화면에 실제로 찍히는 머리 끝 (S 자 흔들림 반영) */
    tipX: number;
    tipY: number;
    angle: number;
    /** 왼쪽을 향할 때 -1 (그림을 세로로 뒤집는다) */
    flip: 1 | -1;
    headScale: number;
    /** 입 안쪽 한가운데 — 물린 잠수부를 여기 놓는다 */
    mouthX: number;
    mouthY: number;
    menace: number;
  } {
    const spec = PREDATORS[this.predator];
    const [mx, my] = spec.mouth;
    const menace = Math.max(0, this.danger * (1 - this.escape));
    const rest = this.diverRest(x, y, w, h);
    const preyX = rest.cx + HEAD_X * rest.scale;
    const preyY = rest.cy + HEAD_Y * rest.scale;
    /**
     * 등장 지점 — 반드시 화면 **밖**이다.
     *
     * 예전에 곰치 굴을 오른쪽 가장자리(w * 1.0)에 뒀더니, 시작부터 머리가 화면 안에
     * 크게 들어와 '멀리 있다가 다가온다'가 아니라 '처음부터 코앞'으로 보였다.
     * 곰치·아귀는 옆에서, 촉수는 위에서 온다.
     */
    const originX = x + w * spec.origin[0];
    const originY = y + h * spec.origin[1];
    /**
     * 등장 지점에서 잠수부까지 얼마나 나왔는가 (0..1).
     *
     * 곰치(지수 1.7) 기준:
     *   위험 0.5 → 0.41 (화면 3분의 1쯤, 아직 멀다)
     *   위험 0.8 → 0.69
     *   위험 1   → 0.92 (코앞)
     * 완전히 붙지는 않게 조금 남긴다 — 닿으면 게임이 끝난 셈이고,
     * 잡아먹히는 순간에만 끝까지 좁힌다.
     */
    const full = spec.emerge + spec.span;
    const reach =
      this.devourT > 0
        ? full + this.devourT * (1 - full)
        : spec.emerge + Math.pow(menace, spec.curve) * spec.span;
    const headScale = (h * spec.headH) / spec.artH;

    /**
     * 겨냥점은 잠수부가 아니라 **잠수부에서 입 오프셋만큼 뒤로 물린 지점**이다.
     *
     * 회전축은 목덜미(촉수는 팔 뿌리)고 입은 거기서 한참 앞이다. 회전축을 잠수부에
     * 맞추면 입은 그를 지나쳐 가서, 물린 게 아니라 얼굴 옆을 스친 것처럼 보인다.
     * 오프셋만큼 당겨두면 reach 가 끝일 때 **입이 정확히 잠수부에 닿는다.**
     */
    const aim = Math.atan2(preyY - originY, preyX - originX);
    /**
     * 왼쪽으로 갈 때는 그림을 세로로 뒤집는다.
     *
     * 곰치도 아귀도 오른쪽을 보고 그려져 있다. 왼쪽의 잠수부를 향해 180° 돌리면
     * 방향은 맞지만 위아래까지 뒤집혀 **배가 하늘로 간다.** 회전만으로는 '왼쪽을 보는
     * 물고기'를 만들 수 없어서 뒤집기를 한 번 더 건다. 입 오프셋의 세로 성분도 같이
     * 뒤집어야 겨냥점이 어긋나지 않는다.
     */
    const flip: 1 | -1 = Math.cos(aim) < 0 ? -1 : 1;
    const myF = my * flip;
    const mouthDX = (mx * Math.cos(aim) - myF * Math.sin(aim)) * headScale;
    const mouthDY = (mx * Math.sin(aim) + myF * Math.cos(aim)) * headScale;
    const targetX = preyX - mouthDX;
    const targetY = preyY - mouthDY;

    const headX = originX + (targetX - originX) * reach;
    const headY = originY + (targetY - originY) * reach;

    // 몸통이 흔들리므로 머리 끝도 그만큼 밀린다. 흔들림을 빼고 계산하면
    // 입 좌표가 머리에서 떨어져 잠수부가 턱 옆 허공에 물린다.
    const dx = headX - originX;
    const dy = headY - originY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const wave =
      Math.sin(this.time * (1.4 + menace * 1.6) + 4.2) * h * spec.wave * (0.5 + menace * 0.5);
    const tipX = headX + (-dy / len) * wave;
    const tipY = headY + (dx / len) * wave;

    /**
     * 입 안쪽 한가운데.
     *
     * 곰치는 `make-sprites.mjs` 의 입 안쪽 도형이 x 82..156, y 72..87 이라 중심이
     * (115, 79), 회전축(10, 60)에서 (+105, +19) 다. 나머지 둘은 `predatorRig.ts` 가
     * 같은 규약으로 값을 내놓는다.
     */
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      originX,
      originY,
      headX,
      headY,
      tipX,
      tipY,
      angle,
      flip,
      headScale,
      mouthX: tipX + (mx * cos - myF * sin) * headScale,
      mouthY: tipY + (mx * sin + myF * cos) * headScale,
      menace,
    };
  }

  /**
   * 물린 잠수부 위에 포식자의 입을 한 번 더 그린다.
   *
   * 배경 단계에서 이미 그렸지만, 잠수부는 그 뒤에 그려지므로 그대로 두면 턱 **앞**에
   * 떠 있는 것처럼 보인다. 물린 순간만 덮어 그려서 잠수부가 위턱과 아래턱 사이에
   * (촉수라면 갈고리 사이에) 끼이게 한다.
   */
  private drawEelBite(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const biting = this.devourT > 0;
    /**
     * 코앞까지 왔으면 앞쪽 조각을 잠수부 위에 덮는다.
     *
     * 포식자는 배경 단계(`paintBackdrop`)에서 그려지고 잠수부는 그 뒤에 그려진다.
     * 그래서 코앞까지 왔을 때 그대로 두면 **사람이 턱 앞에 서 있는** 그림이 되어,
     * 닿기 직전이라는 게 안 읽히고 거리감도 죽는다. 아래턱(촉수는 가까운 갈고리)만
     * 한 번 더 앞에 얹으면 잠수부가 위턱과 아래턱 사이에 놓인다.
     */
    const near = this.danger > 0.82 && this.escape < 0.4;
    if (!biting && !near) return;

    const { originX, originY, tipX, tipY, angle, flip, headScale, menace } = this.eelGeom(x, y, w, h);
    // 물면서 턱을 닫는다. 아직 안 물었으면 몸통 쪽과 같은 주기로 벌린다.
    const open = biting
      ? Math.max(0, 0.85 * (1 - this.devourT))
      : (Math.sin(this.time * (2 + menace * 7)) * 0.5 + 0.5) * (0.15 + menace * 0.85);
    // 물린 순간에는 머리 전체를 덮어야 위아래 턱 사이에 확실히 낀다.
    const front = !biting;
    const common = { x: tipX, y: tipY, scale: headScale, open, rotation: angle, flip };
    switch (this.predator) {
      case 'eel':
        drawEelHead(ctx, { ...common, part: front ? 'jaw' : 'all' });
        break;
      case 'angler':
        drawAngler(ctx, { ...common, front, menace, time: this.time });
        break;
      case 'tentacle':
        drawTentacle(ctx, {
          ...common,
          front,
          x: originX,
          y: originY,
          rotation: Math.atan2(tipY - originY, tipX - originX),
          reach: Math.hypot(tipX - originX, tipY - originY),
          menace,
          time: this.time,
        });
        break;
    }
  }

  /** 수심대에 맞는 포식자를 그린다. */
  private drawEel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.predator === 'angler') return this.drawAnglerBody(ctx, x, y, w, h);
    if (this.predator === 'tentacle') return this.drawTentacleBody(ctx, x, y, w, h);

    const { originX, originY, headX, headY, flip, headScale, menace } = this.eelGeom(x, y, w, h);

    const segments = 18;
    // 몸통이 축 늘어지지 않게 살짝 S 자로 흔든다
    const wave = (t: number): number =>
      Math.sin(this.time * (1.4 + menace * 1.6) + t * 4.2) * h * 0.09 * t * (0.5 + menace * 0.5);

    const pointAt = (t: number): [number, number] => {
      const bx = originX + (headX - originX) * t;
      const by = originY + (headY - originY) * t;
      // 진행 방향의 수직으로 흔든다
      const dx = headX - originX;
      const dy = headY - originY;
      const len = Math.max(1, Math.hypot(dx, dy));
      return [bx + (-dy / len) * wave(t), by + (dx / len) * wave(t)];
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 몸통을 굵은 선으로만 그리면 굵기가 일정한 호스가 된다.
    // 굴 쪽은 가늘고 머리 쪽으로 갈수록 굵어지는 **테이퍼 리본**을 채워야 생물로 읽힌다.
    // 굵기도 줄였다 — 몸통이 굵으면 멀리 있어도 코앞처럼 보여 거리감이 죽는다
    const halfWidth = (t: number): number => h * (0.028 + 0.058 * t * t);

    /** 진행 방향의 법선 */
    const normalAt = (t: number): [number, number] => {
      const [ax, ay] = pointAt(Math.max(0, t - 0.03));
      const [bx, by] = pointAt(Math.min(1, t + 0.03));
      const nx = -(by - ay);
      const ny = bx - ax;
      const len = Math.max(1, Math.hypot(nx, ny));
      return [nx / len, ny / len];
    };

    const ribbon = (inset: number): Path2D => {
      const path = new Path2D();
      for (let n = 0; n <= segments; n++) {
        const t = n / segments;
        const [px, py] = pointAt(t);
        const [nx, ny] = normalAt(t);
        const wdt = Math.max(1, halfWidth(t) - inset);
        n === 0
          ? path.moveTo(px + nx * wdt, py + ny * wdt)
          : path.lineTo(px + nx * wdt, py + ny * wdt);
      }
      for (let n = segments; n >= 0; n--) {
        const t = n / segments;
        const [px, py] = pointAt(t);
        const [nx, ny] = normalAt(t);
        const wdt = Math.max(1, halfWidth(t) - inset);
        path.lineTo(px - nx * wdt, py - ny * wdt);
      }
      path.closePath();
      return path;
    };

    // 등지느러미 막 — 몸통보다 뒤에 깔아야 등에서 솟은 것처럼 보인다
    const fin = new Path2D();
    for (let n = 1; n <= segments; n++) {
      const t = n / segments;
      const [px, py] = pointAt(t);
      const [nx, ny] = normalAt(t);
      const off = halfWidth(t) + h * 0.055 * (0.6 + 0.4 * Math.sin(t * 9 + this.time * 3));
      n === 1 ? fin.moveTo(px + nx * off, py + ny * off) : fin.lineTo(px + nx * off, py + ny * off);
    }
    for (let n = segments; n >= 1; n--) {
      const t = n / segments;
      const [px, py] = pointAt(t);
      const [nx, ny] = normalAt(t);
      fin.lineTo(px + nx * halfWidth(t) * 0.6, py + ny * halfWidth(t) * 0.6);
    }
    fin.closePath();
    ctx.fillStyle = 'rgba(140, 190, 100, 0.55)';
    ctx.fill(fin);

    // 몸통 본체
    const body = ribbon(0);
    const grad = ctx.createLinearGradient(originX, originY, headX, headY);
    grad.addColorStop(0, '#22401a');
    grad.addColorStop(0.5, menace > 0.65 ? '#54903a' : '#456f2f');
    grad.addColorStop(1, menace > 0.65 ? '#6aa843' : '#5c8433');
    ctx.fillStyle = grad;
    ctx.fill(body);
    ctx.strokeStyle = '#16290f';
    ctx.lineWidth = Math.max(2, h * 0.014);
    ctx.stroke(body);

    // 배 쪽 밝은 띠 — 원통이라는 걸 알려주는 유일한 단서다
    ctx.save();
    ctx.clip(body);
    ctx.strokeStyle = 'rgba(210, 240, 170, 0.3)';
    ctx.lineWidth = Math.max(2, h * 0.03);
    ctx.beginPath();
    for (let n = 0; n <= segments; n++) {
      const t = n / segments;
      const [px, py] = pointAt(t);
      const [nx, ny] = normalAt(t);
      const off = -halfWidth(t) * 0.45;
      n === 0 ? ctx.moveTo(px + nx * off, py + ny * off) : ctx.lineTo(px + nx * off, py + ny * off);
    }
    ctx.stroke();

    // 얼룩 — 머리 스프라이트의 무늬와 이어지게 같은 색을 쓴다
    ctx.fillStyle = 'rgba(232, 223, 160, 0.4)';
    for (let n = 0; n < 9; n++) {
      const t = 0.1 + (n / 9) * 0.85;
      const [px, py] = pointAt(t);
      const [nx, ny] = normalAt(t);
      const side = n % 2 ? 0.35 : -0.3;
      const r = halfWidth(t) * (0.3 + ((n * 7) % 3) * 0.1);
      ctx.beginPath();
      ctx.ellipse(px + nx * halfWidth(t) * side, py + ny * halfWidth(t) * side, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 머리 — 진행 방향을 향한다
    const [tipX, tipY] = pointAt(1);
    const [prevX, prevY] = pointAt(0.92);
    const angle = Math.atan2(tipY - prevY, tipX - prevX);

    // 가까울수록 크게, 빠르게 입을 벌린다
    const chompSpeed = 2 + menace * 7;
    const chomp = (Math.sin(this.time * chompSpeed) * 0.5 + 0.5) * (0.15 + menace * 0.85);

    drawEelHead(ctx, { x: tipX, y: tipY, scale: headScale, open: chomp, rotation: angle, flip });

    ctx.restore();
  }

  /**
   * 아귀 — 몸통이 하나짜리라 리본이 필요 없다. 통째로 다가온다.
   *
   * 대신 **어둠에 묻힌 정도**로 거리를 만든다. 멀면 유인등만 겨우 보이고 몸은 물빛에
   * 잠겨 있다가, 가까워질수록 실루엣이 드러난다. 곰치가 '길이'로 시간을 보여줬다면
   * 이쪽은 '얼마나 보이는가'다.
   */
  private drawAnglerBody(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const { tipX, tipY, angle, flip, headScale, menace } = this.eelGeom(x, y, w, h);
    ctx.save();
    // 멀 때는 몸이 물에 녹아 있는다. 유인등은 별도로 항상 밝게 그려지므로 이 값에 안 묻힌다.
    ctx.globalAlpha = 0.32 + Math.pow(menace, 0.8) * 0.68;
    const chomp = (Math.sin(this.time * (1.6 + menace * 5)) * 0.5 + 0.5) * (0.12 + menace * 0.88);
    drawAngler(ctx, {
      x: tipX,
      y: tipY,
      scale: headScale,
      rotation: angle,
      flip,
      open: chomp,
      menace,
      time: this.time,
    });
    ctx.restore();
  }

  /**
   * 대왕오징어 촉수 — 위에서 자라 내려온다.
   *
   * 팔이 통째로 하나라 `reach` 를 길이로 넘긴다. 뿌리는 화면 위 밖에 고정이고
   * 곤봉만 잠수부 쪽으로 뻗는다 — 어디서 나왔는지 끝내 안 보이는 게 이 층의 압박이다.
   */
  private drawTentacleBody(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const { originX, originY, tipX, tipY, headScale, menace } = this.eelGeom(x, y, w, h);
    const grip = (Math.sin(this.time * (1.2 + menace * 4)) * 0.5 + 0.5) * (0.15 + menace * 0.85);
    drawTentacle(ctx, {
      x: originX,
      y: originY,
      scale: headScale,
      rotation: Math.atan2(tipY - originY, tipX - originX),
      reach: Math.hypot(tipX - originX, tipY - originY),
      open: grip,
      menace,
      time: this.time,
    });
  }

  // ---------- 잠수부 ----------

  /**
   * 물리기 전, 제자리에 서 있을 때의 잠수부 위치.
   *
   * 곰치는 이 지점을 노리고, 잠수부는 물릴 때 곰치 입으로 옮겨간다. 둘이 서로를
   * 기준으로 삼으면 순환이 되므로 **'가만히 있을 때의 자리'** 를 따로 둔다.
   */
  private diverRest(x: number, y: number, w: number, h: number): { cx: number; cy: number; scale: number; bob: number } {
    const big = this.variant === 'rescue';
    /**
     * 잠수부가 장면 높이의 몇 할을 차지하는가.
     *
     * 사람이 장면을 꽉 채우면 뒤의 소품(케이지·빙벽·바위 더미·곰치)이 가려져
     * "무엇을 부수는 중인지"가 안 보인다. 사람은 **상황 안의 한 요소**여야지
     * 화면 그 자체가 되면 안 된다. 구조 미션만 조금 크게 둔다 — 거기선 사람이 목표라서.
     */
    // 잠수부도 줄였다. 사람이 장면을 반 넘게 채우면 곰치가 다가올 빈 공간 자체가 없다.
    const scale = (h * (big ? 0.52 : 0.46)) / DIVER_SPAN;
    /**
     * 발이 닿는 높이. 어깨가 아니라 **발**을 기준으로 놓는다 —
     * 어깨를 고정해두면 크기를 조금만 줄여도 발이 바위 턱에서 떠올라 공중에 뜬다.
     */
    const feetLine = big ? 0.98 : 0.89;
    const bob = Math.sin(this.time * 1.9) * h * 0.02;
    // 탈출은 **아래로** 간다. 곰치는 위쪽에서 다가오고 보드의 S 도 맨 윗행에 있으니,
    // 잠수부는 장면에서 보드 쪽으로 가라앉으며 빠져나가야 방향이 맞는다.
    return {
      /**
       * 잠수부의 가로 위치.
       *
       * 왼쪽으로 붙여야 한다. 예전엔 0.42w(거의 한가운데)에 세워뒀더니 곰치가 건너올
       * 거리가 짧아, 시간이 절반쯤 남았는데도 이미 둘이 겹쳐 보였다 — 게이지는
       * "아직 남았다"는데 그림은 "이미 잡혔다"고 말하는 셈이라 둘이 어긋난다.
       *
       * 왼쪽 벽은 바닥 쪽에서 폭이 0.12w 정도이고 잠수부는 반폭이 0.05w 라 안 겹친다.
       */
      cx: x + w * (big ? 0.3 : 0.27),
      // 발 높이에서 거꾸로 계산한 기준점
      cy: y + h * feetLine - DIVER_FEET * scale + bob + this.escape * h * 0.9,
      scale,
      bob,
    };
  }

  /**
   * 잠수부의 실제 배치. 물리는 중이면 곰치 입으로 끌려간다.
   *
   * 예전엔 오른쪽 위로 대충 밀어내고 페이드시켰다. 그러면 곰치와 상관없는 방향으로
   * 흘러가서 '물렸다'가 아니라 '사라진다'로 보인다. 실제 입 좌표를 계산해 거기로 옮긴다.
   */
  private diverCenter(x: number, y: number, w: number, h: number): { cx: number; cy: number; scale: number; bob: number } {
    const rest = this.diverRest(x, y, w, h);
    if (this.devourT <= 0) return rest;

    const { mouthX, mouthY } = this.eelGeom(x, y, w, h);
    // 곰치가 입을 그에게 가져다 대므로 잠수부는 조금만 끌려 들어가면 된다.
    // 많이 옮기면 입을 뚫고 지나가 버린다.
    const t = this.devourT * this.devourT * 0.55;
    return {
      cx: rest.cx + (mouthX - rest.cx) * t,
      cy: rest.cy + (mouthY - rest.cy) * t,
      // 입 안에 들어가려면 작아져야 한다. 크기 그대로면 턱을 뚫고 나온다.
      scale: rest.scale * (1 - this.devourT * 0.45),
      bob: rest.bob,
    };
  }

  /** 장면 안 잠수부의 현재 위치·배율 (보드로 내려올 때 출발점) */
  diverAnchor(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { x: number; y: number; scale: number } {
    const { cx, cy, scale } = this.diverCenter(x, y, w, h);
    return { x: cx, y: cy, scale };
  }

  private drawDiver(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const { cx, cy, scale } = this.diverCenter(x, y, w, h);
    const pose: DiverPose = {
      x: cx,
      y: cy,
      scale,
      time: this.time,
      // 산소가 줄수록 발버둥이 심해진다
      panic: (0.35 + this.danger * 0.9) * (1 - this.escape * 0.5),
      escape: this.escape,
      cheer: this.cheerT,
      // 입 안으로 삼켜진다. 너무 일찍 지우면 '물렸다'가 안 보이고 그냥 사라진 게 되므로
      // 턱이 닫히는 동안에는 남겨두고 마지막에만 없앤다.
      alpha: 1 - Math.max(0, this.devourT - 0.78) / 0.22,
    };
    drawDiver(ctx, pose);

    const [hx, hy] = helmetPos(pose);
    this.drawBubbles(ctx, y, w, h, hx, hy);
  }

  /**
   * 보드로 내려가는 동안의 잠수부.
   * 수로 폭이 한 칸이라 배율은 보드가 정해주고, 자세는 유선형(escape=1)으로 고정한다.
   */
  private drawDiverAt(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
  ): void {
    const pose: DiverPose = {
      x,
      y,
      scale,
      time: this.time,
      // 빠져나가는 중이라 발버둥이 아니라 힘차게 헤엄치는 쪽
      panic: 0.5,
      escape: 1,
    };
    drawDiver(ctx, pose);

    // 지나간 자리에 기포를 흘린다
    const [hx, hy] = helmetPos(pose);
    ctx.save();
    ctx.fillStyle = 'rgba(223, 246, 255, 0.75)';
    for (let n = 0; n < 5; n++) {
      const seed = n * 37.7 + Math.floor(this.time * 3);
      const drift = ((seed * 13.7) % 1) - 0.5;
      const rise = ((this.time * 0.9 + n * 0.21) % 1) * scale * 90;
      ctx.beginPath();
      ctx.arc(hx + drift * scale * 26, hy - rise, scale * (2 + (n % 3)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBubbles(
    ctx: CanvasRenderingContext2D,
    y: number,
    w: number,
    h: number,
    fromX: number,
    fromY: number,
  ): void {
    // 구조 미션은 남은 산소만큼, 그 외는 항상 잔잔하게
    const left = this.variant === 'rescue' ? 1 - this.danger : 0.7;
    const count = Math.max(1, Math.round(1 + left * 7));
    ctx.save();
    ctx.fillStyle = '#dff6ff';
    for (let n = 0; n < count; n++) {
      const seed = n * 41.3;
      const bx = fromX + Math.sin(seed) * w * 0.05 + Math.sin(this.time * 1.3 + n) * w * 0.012;
      const span = fromY - y + h * 0.1;
      const by = fromY - ((this.time * (24 + (n % 5) * 10) + seed * 13) % span);
      ctx.globalAlpha = 0.2 + 0.45 * ((fromY - by) / span);
      ctx.beginPath();
      ctx.arc(bx, by, 1.6 + (n % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 목표별 소품 ----------

  /** 소품을 따로 그릴 때 쓰는 오프스크린. 크기가 바뀔 때만 새로 만든다. */
  private propLayer: HTMLCanvasElement | null = null;

  /**
   * 앞을 막은 소품 — 수심만큼 가라앉혀 그린다.
   *
   * 소품 5종은 각자 고정 팔레트로 그려져 있다. 그대로 얹으면 640m 의 검정에 가까운
   * 물 위에 밝은 청록 빙벽이 혼자 형광등처럼 뜬다. 물빛·광선·부유물은 수심을 타는데
   * 소품만 안 타면 그 판만 붕 뜬 그림이 된다.
   *
   * 소품 함수 다섯 개의 색을 일일이 고치는 대신 **레이어를 따로 그려 한 번에 물들인다.**
   * `source-atop` 이라 소품이 실제로 칠해진 픽셀만 물들고 빈 곳은 안 건드린다.
   * 얕은 곳(gloom 이 작을 때)은 오프스크린을 아예 안 거치고 바로 그린다.
   */
  private drawProp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const sink = this.mood.gloom;
    if (sink < 0.25) {
      this.paintProp(ctx, x, y, w, h);
      return;
    }

    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    const pw = Math.max(1, Math.ceil(w * dpr));
    const ph = Math.max(1, Math.ceil(h * dpr));
    let layer = this.propLayer;
    if (!layer || layer.width !== pw || layer.height !== ph) {
      layer = document.createElement('canvas');
      layer.width = pw;
      layer.height = ph;
      this.propLayer = layer;
    }
    const lc = layer.getContext('2d');
    if (!lc) {
      this.paintProp(ctx, x, y, w, h);
      return;
    }
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);
    lc.clearRect(0, 0, w, h);
    // 소품 함수들은 장면 좌표로 그린다. 원점을 옮겨 그대로 재사용한다.
    lc.translate(-x, -y);
    this.paintProp(lc, x, y, w, h);
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);

    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = rgba(this.mood.bottomRgb, 0.2 + sink * 0.55);
    lc.fillRect(0, 0, w, h);
    lc.globalCompositeOperation = 'source-over';

    ctx.drawImage(layer, x, y, w, h);
  }

  private paintProp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    switch (this.variant) {
      case 'rescue':
        this.drawCage(ctx, x, y, w, h);
        break;
      case 'ice':
        this.drawIceWall(ctx, x, y, w, h);
        break;
      case 'rock':
        this.drawRockPile(ctx, x, y, w, h);
        break;
      case 'net':
        this.drawNets(ctx, x, y, w, h);
        break;
    }
  }

  /**
   * 구조: 잠수부를 가둔 바위 틈.
   *
   * 예전엔 쇠창살이었다. 심해 해구 바닥에 감옥 창살이 서 있을 이유가 없어서
   * 배경과 따로 놀았다. 무너진 암반 사이에 끼인 쪽이 이 장소의 이야기에 맞고,
   * 보드에서 파내는 암석과도 같은 재질이다. 구조하면 틈이 벌어진다.
   */
  private drawCage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.escape >= 0.98) return;
    const { cx } = this.diverCenter(x, y, w, h);
    // 곰치가 들어올 자리도 남겨야 한다. 너무 좁으면 잠수부가 틈을 꽉 채워버린다.
    const gap = w * (0.27 + this.escape * 0.3);
    const rock = texturePattern(ctx, 'rock', (h * 0.7) / 512);

    ctx.save();
    ctx.globalAlpha = 1 - this.escape * 0.15;

    for (const side of [-1, 1] as const) {
      // 잠수부 쪽을 향한 면이 들쭉날쭉해야 갈라진 바위로 보인다
      const inner = cx + side * gap;
      ctx.beginPath();
      ctx.moveTo(side === -1 ? x - 4 : x + w + 4, y - 4);
      ctx.lineTo(inner, y - 4);
      for (let n = 1; n <= 6; n++) {
        const t = n / 6;
        const jag = Math.sin(n * 2.3 + side * 1.7) * w * 0.035;
        ctx.lineTo(inner + side * jag, y + h * t);
      }
      ctx.lineTo(side === -1 ? x - 4 : x + w + 4, y + h + 4);
      ctx.closePath();

      ctx.fillStyle = rock ?? '#2a3a44';
      ctx.fill();
      // 틈 안쪽으로 갈수록 어둡다 — 깊이가 생긴다
      const shade = ctx.createLinearGradient(inner, 0, inner + side * w * 0.3, 0);
      shade.addColorStop(0, 'rgba(0, 8, 14, 0.85)');
      shade.addColorStop(1, 'rgba(0, 8, 14, 0.3)');
      ctx.fillStyle = shade;
      ctx.fill();
      // 갈라진 모서리에 걸린 빛
      ctx.strokeStyle = 'rgba(170, 215, 235, 0.28)';
      ctx.lineWidth = Math.max(1.5, h * 0.012);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 결빙: 잠수부를 가로막은 빙벽. 목표가 깎일수록 녹아 내려간다. */
  private drawIceWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const remain = 1 - this.cleared;
    if (remain <= 0.02) return;
    const left = x + w * 0.5;
    const width = w * 0.5;
    const top = y + h * (1 - remain) * 0.95;

    ctx.save();
    // 얼음은 매끈한 하늘색 판이 아니다. 속이 비쳐 보이고, 안에 갈라진 면과 갇힌
    // 기포가 있고, 모서리에서만 빛이 튄다. 그 세 가지가 있어야 얼음으로 읽힌다.
    ctx.beginPath();
    ctx.moveTo(left, y + h);
    ctx.lineTo(left, top + h * 0.06);
    for (let n = 0; n <= 5; n++) {
      const t = n / 5;
      ctx.lineTo(left + width * t, top + Math.sin(n * 2.7 + this.time * 0.4) * h * 0.05);
    }
    ctx.lineTo(left + width, y + h);
    ctx.closePath();
    ctx.save();
    ctx.clip();

    // 본체 — 아래로 갈수록 짙어지는 반투명 청록
    const g = ctx.createLinearGradient(left, top, left + width * 0.4, y + h);
    g.addColorStop(0, 'rgba(226, 250, 255, 0.72)');
    g.addColorStop(0.45, 'rgba(150, 214, 236, 0.6)');
    g.addColorStop(1, 'rgba(58, 130, 168, 0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(left, top, width, y + h - top);

    // 갈라진 면 — 두꺼운 반투명 흰 띠. 얼음 속의 판이지 표면의 선이 아니다.
    for (let n = 0; n < 5; n++) {
      const bx = left + width * (0.14 + n * 0.19);
      const lean = (n % 2 ? 1 : -1) * (0.06 + this.cleared * 0.1);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + (n % 2) * 0.06})`;
      ctx.lineWidth = Math.max(4, h * 0.045);
      ctx.beginPath();
      ctx.moveTo(bx, top);
      ctx.lineTo(bx + w * lean, y + h);
      ctx.stroke();
    }

    // 갇힌 기포
    for (let n = 0; n < 14; n++) {
      const seed = n * 51.7;
      const bx = left + width * (0.1 + ((seed * 0.37) % 1) * 0.8);
      const by = top + (y + h - top) * (0.08 + ((seed * 0.71) % 1) * 0.86);
      const r = h * (0.008 + ((seed * 0.19) % 1) * 0.014);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 모서리에서 튀는 빛 — 위쪽 능선만 밝게
    ctx.strokeStyle = 'rgba(233, 252, 255, 0.85)';
    ctx.lineWidth = Math.max(2, h * 0.016);
    ctx.beginPath();
    for (let n = 0; n <= 5; n++) {
      const t = n / 5;
      const px = left + width * t;
      const py = top + Math.sin(n * 2.7 + this.time * 0.4) * h * 0.05;
      n === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 산호암: 잠수부를 막아선 바위 더미.
   *
   * 판 하나를 슬라이드시키면 밋밋하다. 덩어리를 여러 개 쌓아두고 목표가 깎일 때마다
   * 위에서부터 하나씩 부서져 사라지게 한다 — "몇 개 부쉈는지"가 화면으로 바로 읽힌다.
   */
  private drawRockPile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const rocks = this.rockLayout();
    // 잠수부 바로 옆까지 밀고 들어와야 '막혔다'로 읽힌다
    const boxX = x + w * 0.30;
    const boxW = w * 0.74;
    const boxY = y + h * 0.16;
    const boxH = h * 0.78;

    // 위험할 때 더미가 자잘하게 흔들린다
    const rumble = this.danger > 0.6 ? (this.danger - 0.6) / 0.4 : 0;
    const shakeX = Math.sin(this.time * 37) * rumble * h * 0.012;
    const shakeY = Math.cos(this.time * 41) * rumble * h * 0.008;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // 덩어리 사이로 배경이 비치지 않게 뒤에 어두운 덩어리를 깔아둔다
    const massRemain = 1 - this.cleared;
    if (massRemain > 0.02) {
      const massTop = boxY + boxH * (1 - massRemain) * 0.92;
      ctx.save();
      ctx.fillStyle = '#2b3541';
      ctx.beginPath();
      ctx.moveTo(boxX + boxW * 0.06, y + h);
      ctx.lineTo(boxX + boxW * 0.06, massTop + h * 0.12);
      for (let n = 0; n <= 6; n++) {
        const t = n / 6;
        ctx.lineTo(boxX + boxW * (0.06 + 0.94 * t), massTop + Math.sin(n * 2.2) * h * 0.05);
      }
      ctx.lineTo(boxX + boxW, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    let aliveTop = boxY + boxH;
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      // 위에 있는 덩어리부터 사라진다
      const t = (this.cleared - i / rocks.length) * rocks.length;
      if (t >= 1) continue;

      const cx = boxX + rock.x * boxW;
      const cy = boxY + rock.y * boxH;
      const r = rock.r * h;

      if (t <= 0) {
        aliveTop = Math.min(aliveTop, cy - r);
        this.drawBoulder(ctx, cx, cy, r, rock, 1, 1);
      } else {
        // 부서지는 중: 오므라들며 흩어진다
        const e = 1 - t;
        this.drawBoulder(ctx, cx, cy + t * h * 0.12, r, rock, e, e);
      }
    }

    this.drawRockDebris(ctx, boxX, aliveTop, boxW, y + h);
    ctx.restore();

    // 더미 밑동의 흙먼지
    if (this.cleared < 0.98) {
      ctx.save();
      const g = ctx.createLinearGradient(0, y + h * 0.7, 0, y + h);
      g.addColorStop(0, 'rgba(90, 105, 120, 0)');
      g.addColorStop(1, 'rgba(90, 105, 120, 0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(boxX - w * 0.05, y + h * 0.7, boxW + w * 0.1, h * 0.3);
      ctx.restore();
    }
  }

  /**
   * 바위 하나.
   * 보드 타일과 같은 파이프라인(SVG 필터로 구운 에셋)을 쓴다 — 조명이 달라지면 화면이 따로 논다.
   * 에셋이 아직 안 올라왔을 때만 아래 절차적 그리기로 폴백한다.
   */
  private drawBoulder(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    rock: RockDef,
    scale: number,
    alpha: number,
  ): void {
    // 크기를 8px 단위로 묶어 캐시가 불어나지 않게 한다
    const size = Math.max(8, Math.round((r * scale * 2.35) / 8) * 8);
    const art = bakedTile(BOULDER_ART[rock.variant], size);
    if (art) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.rotate(rock.rot * 0.35);
      ctx.drawImage(art, -size / 2, -size / 2, size, size);
      ctx.restore();
      return;
    }

    const points: [number, number][] = [];
    const sides = 7;
    for (let n = 0; n < sides; n++) {
      const a = (Math.PI * 2 * n) / sides + rock.rot;
      const rr = r * scale * (0.78 + rock.jitter[n] * 0.32);
      points.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // 본체
    ctx.beginPath();
    points.forEach(([px, py], n) => (n === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = rock.dark ? '#3b4653' : '#4d5b6a';
    ctx.fill();
    ctx.strokeStyle = '#222b35';
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.stroke();

    // 빛 받는 위쪽 면
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let n = sides - 2; n <= sides + 1; n++) {
      const [px, py] = points[((n % sides) + sides) % sides];
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rock.dark ? '#5c6c7d' : '#71818f';
    ctx.fill();

    // 결
    ctx.strokeStyle = 'rgba(20, 28, 36, 0.5)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx - r * scale * 0.5, cy + r * scale * 0.1);
    ctx.lineTo(cx + r * scale * 0.2, cy + r * scale * 0.45);
    ctx.stroke();

    // 산호 — 이름값 하게 몇 덩어리 위에만 부채꼴로 얹는다
    if (rock.coral) {
      const s = r * scale;
      ctx.fillStyle = rock.coralHue;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.34, cy - s * 0.5);
      ctx.quadraticCurveTo(cx - s * 0.62, cy - s * 1.05, cx - s * 0.2, cy - s * 1.02);
      ctx.quadraticCurveTo(cx, cy - s * 1.45, cx + s * 0.2, cy - s * 1.02);
      ctx.quadraticCurveTo(cx + s * 0.62, cy - s * 1.05, cx + s * 0.34, cy - s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, s * 0.08);
      for (let n = -1; n <= 1; n++) {
        ctx.beginPath();
        ctx.moveTo(cx + n * s * 0.22, cy - s * 0.55);
        ctx.lineTo(cx + n * s * 0.3, cy - s * 1.1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 더미 위에서 흘러내리는 잔돌 */
  private drawRockDebris(
    ctx: CanvasRenderingContext2D,
    boxX: number,
    fromY: number,
    boxW: number,
    bottom: number,
  ): void {
    if (this.cleared >= 0.98) return;
    const span = Math.max(1, bottom - fromY);
    const count = 10;
    ctx.save();
    ctx.fillStyle = '#8d9aa8';
    for (let n = 0; n < count; n++) {
      const seed = n * 53.7;
      const px = boxX + boxW * (0.1 + hash01(seed) * 0.8);
      const py = fromY + ((this.time * (55 + (n % 4) * 26) + seed * 31) % span);
      const size = 1.6 + (n % 3) * 0.9;
      ctx.globalAlpha = 0.25 + 0.55 * (1 - (py - fromY) / span);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 바위 배치는 프레임마다 같아야 한다 — 시드로 한 번만 만든다. */
  private rocks: RockDef[] | null = null;

  private rockLayout(): RockDef[] {
    if (this.rocks) return this.rocks;
    const out: RockDef[] = [];
    // 서로 겹치도록 크게 쌓는다. 아래로 갈수록 크고 촘촘하게.
    const rows = [
      { y: 0.1, count: 3, r: 0.13 },
      { y: 0.34, count: 4, r: 0.155 },
      { y: 0.6, count: 4, r: 0.175 },
      { y: 0.86, count: 5, r: 0.185 },
    ];
    let i = 0;
    for (const row of rows) {
      for (let n = 0; n < row.count; n++) {
        const s = i * 17.3;
        out.push({
          x: (n + 0.5) / row.count + (hash01(s) - 0.5) * 0.12,
          y: row.y + (hash01(s + 3) - 0.5) * 0.06,
          r: row.r * (0.85 + hash01(s + 7) * 0.4),
          rot: hash01(s + 11) * Math.PI,
          jitter: Array.from({ length: 7 }, (_, k) => hash01(s + 20 + k)),
          dark: hash01(s + 31) > 0.5,
          coral: hash01(s + 41) > 0.62,
          coralHue: hash01(s + 47) > 0.5 ? '#ff8fae' : '#ffab5e',
          variant: Math.floor(hash01(s + 53) * BOULDER_ART.length) % BOULDER_ART.length,
        });
        i++;
      }
    }
    // 위에 있는 것부터 먼저 부서지도록 정렬
    out.sort((a, b) => a.y - b.y);
    this.rocks = out;
    return out;
  }

  /** 어망: 잠수부를 덮은 그물. 풀수록 가닥이 사라진다. */
  private drawNets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const remain = 1 - this.cleared;
    if (remain <= 0.02) return;
    const sag = Math.sin(this.time * 0.9) * h * 0.02;

    ctx.save();
    ctx.globalAlpha = 0.4 + remain * 0.5;

    const strands = Math.max(2, Math.round(9 * remain));
    const rows = 4;
    const strandX = (t: number): number => x + w * (0.08 + t * 0.84);
    const rowY = (n: number): number => y + h * (n / rows) + sag * (n / rows);

    // 밧줄은 한 가닥의 선이 아니라 **어두운 심 위에 밝은 꼬임**이다.
    // 두 번 그어야 젖은 노끈으로 보인다.
    const strokePass = (color: string, width: number, offset: number): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, width);
      ctx.lineCap = 'round';
      for (let n = 0; n <= strands; n++) {
        const px = strandX(n / strands);
        ctx.beginPath();
        ctx.moveTo(px + offset, y);
        ctx.quadraticCurveTo(px + w * 0.03 + offset, y + h * 0.5 + sag, px - w * 0.02 + offset, y + h * 0.92);
        ctx.stroke();
      }
      for (let n = 1; n < rows; n++) {
        const py = rowY(n);
        ctx.beginPath();
        ctx.moveTo(x + w * 0.06, py + offset);
        ctx.quadraticCurveTo(x + w * 0.5, py + h * 0.06 + offset, x + w * 0.94, py + offset);
        ctx.stroke();
      }
    };

    strokePass('rgba(58, 44, 22, 0.85)', h * 0.022, h * 0.004);
    strokePass('#d9c896', h * 0.014, 0);

    // 교차점의 매듭 — 그물은 매듭이 있어야 그물이다
    ctx.fillStyle = '#efe4c0';
    ctx.strokeStyle = 'rgba(58, 44, 22, 0.8)';
    ctx.lineWidth = Math.max(1, h * 0.005);
    for (let n = 0; n <= strands; n++) {
      const t = n / strands;
      for (let r = 1; r < rows; r++) {
        const py = rowY(r);
        const px = strandX(t) + w * 0.03 * (py - y) / Math.max(1, h);
        ctx.beginPath();
        ctx.ellipse(px, py + h * 0.02, h * 0.016, h * 0.011, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

}
