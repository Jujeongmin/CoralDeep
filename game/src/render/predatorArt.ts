// 실패 모달에 띄우는 포식자 그림 — 이 판을 쫓아오던 그 생물을 그대로 보여준다.
//
// 예전엔 셋 다 잡아먹으면 곰치 그림 하나만 떴다(render/eelRig.ts, 삭제됨. 그 코드는
// screens/modals.ts 에 그대로 옮겨졌다가 이제 여기로 다시 옮겨왔다). 아귀·고블린상어·
// 오징어로 역할이 바뀐 뒤에도 그림은 곰치 하나뿐이라 "얘한테 잡혔구나"가 안 읽혔다.
// 이제 셋을 따로 그리고 predatorArt() 가 실제로 잡은 놈을 고른다.
//
// 순수 canvas 경로로 그린다 — 이미지 에셋도, 새 의존성도 없다. 그라디언트 · 레이어드
// 패스(머리/턱을 따로 그려 얹는다) · 반점 무늬 · 눈 하이라이트는 예전 곰치 그림의
// 관례를 그대로 잇는다. 패널이 작으니 잔가지보다 굵은 실루엣을 우선한다.

import type { PredatorKind } from '../levels.ts';
import { el } from '../ui.ts';

const W = 200;
const H = 150;

/** 뾰족한 송곳니 한 개. up 이 참이면 아래턱처럼 위로 자란다 (곰치 그림과 같은 곡선). */
function fang(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, up = false): void {
  const s = up ? -1 : 1;
  const e1x = x - 2.5;
  const e1y = y + s * len;
  const e2x = e1x + 6.5;
  const e2y = e1y - s * len * 0.98;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + 1, y + s * len * 0.5, e1x, e1y);
  ctx.quadraticCurveTo(e1x + 6.5, e1y - s * len * 0.42, e2x, e2y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

interface EyeSpec {
  cx: number;
  cy: number;
  r: number;
  socket: string;
  iris: [string, string, string];
  /** 참이면 세로 동공(가늘게), 거짓이면 둥근 동공 */
  slit?: boolean;
  highlight?: boolean;
}

/** 홍채 그라디언트 + 동공 + 하이라이트. 곰치 그림의 눈 처리를 그대로 잇는다. */
function drawEye(ctx: CanvasRenderingContext2D, spec: EyeSpec): void {
  const { cx, cy, r, socket, iris, slit = true, highlight = true } = spec;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2);
  ctx.fillStyle = socket;
  ctx.fill();

  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
  g.addColorStop(0, iris[0]);
  g.addColorStop(0.6, iris[1]);
  g.addColorStop(1, iris[2]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.beginPath();
  if (slit) ctx.ellipse(cx, cy, r * 0.22, r * 0.8, 0, 0, Math.PI * 2);
  else ctx.ellipse(cx, cy, r * 0.42, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0c0810';
  ctx.fill();

  if (highlight) {
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.32, cy - r * 0.34, r * 0.28, r * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fill();
  }
}

/** 실루엣 가장자리를 살짝 눌러준다 — SVG 베벨 대신 쓰는 값싼 정의선 */
function groundEdge(ctx: CanvasRenderingContext2D, path: Path2D): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(4, 6, 10, 0.4)';
  ctx.lineWidth = 2.4;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * 이차곡선을 따라 굵기가 변하는 팔 하나 — 오징어 촉수용.
 * 곡선을 N 등분해 좌우로 수직 오프셋(굵기 절반)을 준 뒤 다각형으로 잇는다.
 */
function taperedLimb(
  ctx: CanvasRenderingContext2D,
  p0: [number, number],
  pc: [number, number],
  p1: [number, number],
  w0: number,
  w1: number,
): [number, number] {
  const N = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    pts.push([
      mt * mt * p0[0] + 2 * mt * t * pc[0] + t * t * p1[0],
      mt * mt * p0[1] + 2 * mt * t * pc[1] + t * t * p1[1],
    ]);
  }
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = (w0 * (1 - t) + w1 * t) / 2;
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(N, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left.slice(1)) ctx.lineTo(p[0], p[1]);
  for (const p of right.slice().reverse()) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
  return pts[N];
}

// ---------- 아귀 (anglerfish) ----------
//
// 정체를 알리는 건 이빨이 아니라 머리 위에서 빛나는 유인등이다. 몸은 그림자에
// 잠긴 덩어리로 두고, 유인등만 또렷하게 발광시킨다.
function drawAnglerfish(ctx: CanvasRenderingContext2D): void {
  const skin = ctx.createLinearGradient(10, 20, 150, 120);
  skin.addColorStop(0, '#4a2f42');
  skin.addColorStop(0.5, '#33202f');
  skin.addColorStop(1, '#180d16');

  const head = new Path2D();
  head.moveTo(15, 95);
  head.quadraticCurveTo(5, 55, 45, 30);
  head.quadraticCurveTo(85, 8, 120, 20);
  head.quadraticCurveTo(148, 28, 170, 46);
  head.quadraticCurveTo(184, 53, 189, 59);
  head.quadraticCurveTo(178, 67, 154, 69);
  head.quadraticCurveTo(110, 73, 70, 79);
  head.quadraticCurveTo(30, 86, 15, 95);
  head.closePath();
  ctx.fillStyle = skin;
  ctx.fill(head);
  groundEdge(ctx, head);

  // 배 쪽 무른 살 — 낮은 명도의 얼룩으로 덩어리감을 준다
  ctx.save();
  ctx.clip(head);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#160a12';
  for (const [cx, cy, rx, ry] of [
    [40, 70, 16, 10],
    [70, 40, 12, 8],
    [100, 55, 14, 9],
    [55, 90, 11, 7],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 아래턱 — 위턱보다 어둡게 그려 그늘 속에서 벌어져 나온 것처럼
  const jawSkin = ctx.createLinearGradient(60, 82, 180, 112);
  jawSkin.addColorStop(0, '#2c1a26');
  jawSkin.addColorStop(1, '#120810');
  const jaw = new Path2D();
  jaw.moveTo(60, 82);
  jaw.quadraticCurveTo(92, 108, 132, 113);
  jaw.quadraticCurveTo(162, 116, 183, 101);
  jaw.quadraticCurveTo(170, 91, 149, 87);
  jaw.quadraticCurveTo(100, 85, 60, 82);
  jaw.closePath();
  ctx.fillStyle = jawSkin;
  ctx.fill(jaw);
  groundEdge(ctx, jaw);

  // 입 안쪽
  const mouth = new Path2D();
  mouth.moveTo(70, 79);
  mouth.quadraticCurveTo(112, 75, 154, 69);
  mouth.quadraticCurveTo(150, 87, 149, 87);
  mouth.quadraticCurveTo(100, 85, 60, 82);
  mouth.closePath();
  ctx.fillStyle = '#4a0f14';
  ctx.fill(mouth);

  // 바늘 이빨 — 위턱은 아래로, 아래턱은 위로. 가늘고 길수록 아귀답다.
  ctx.fillStyle = '#f2ede4';
  ctx.strokeStyle = '#8f8378';
  ctx.lineWidth = 0.8;
  const upperTeeth = [85, 100, 116, 133, 150, 165];
  upperTeeth.forEach((x, n) => fang(ctx, x, 72, 24 - n * 2.4));
  const lowerTeeth = [78, 96, 114, 132, 150];
  lowerTeeth.forEach((x, n) => fang(ctx, x, 85, 20 - n * 2.4, true));

  // 눈 — 작고 어둡다. 이 생물의 정체는 눈이 아니라 유인등이 말한다.
  drawEye(ctx, {
    cx: 62,
    cy: 46,
    r: 8.5,
    socket: '#140a12',
    iris: ['#a98a52', '#6a4a2a', '#2c1c10'],
    slit: true,
  });
  ctx.beginPath();
  ctx.moveTo(46, 32);
  ctx.quadraticCurveTo(64, 24, 80, 32);
  ctx.strokeStyle = '#241422';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 유인등 — 대가리에서 뻗은 낚싯대 끝의 발광기. 여기가 이 그림의 핵심이다.
  ctx.beginPath();
  ctx.moveTo(72, 18);
  ctx.quadraticCurveTo(95, -4, 128, 4);
  ctx.quadraticCurveTo(140, 7, 144, 12);
  ctx.strokeStyle = '#241420';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.stroke();

  const bx = 146;
  const by = 12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [r, a] of [
    [22, 0.12],
    [15, 0.22],
    [9, 0.4],
  ] as const) {
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    glow.addColorStop(0, `rgba(210, 255, 255, ${a})`);
    glow.addColorStop(1, 'rgba(210, 255, 255, 0)');
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(bx, by, 4.6, 0, Math.PI * 2);
  ctx.fillStyle = '#f2ffff';
  ctx.fill();
}

// ---------- 고블린상어 (goblin shark) ----------
//
// 평범한 상어와 갈라지는 지점은 딱 하나 — 길게 뻗은 납작한 주둥이와, 그 아래서
// 앞으로 튀어나온 턱이다. 몸은 흐린 분홍-회색으로 두고 그 둘만 또렷하게 세운다.
function drawGoblinShark(ctx: CanvasRenderingContext2D): void {
  const bodySkin = ctx.createLinearGradient(10, 55, 100, 115);
  bodySkin.addColorStop(0, '#e3c1c6');
  bodySkin.addColorStop(0.55, '#b98d92');
  bodySkin.addColorStop(1, '#7c545a');

  const body = new Path2D();
  body.moveTo(6, 92);
  body.quadraticCurveTo(2, 58, 40, 48);
  body.quadraticCurveTo(70, 40, 90, 62);
  body.quadraticCurveTo(96, 80, 88, 100);
  body.quadraticCurveTo(60, 122, 25, 112);
  body.quadraticCurveTo(8, 106, 6, 92);
  body.closePath();
  ctx.fillStyle = bodySkin;
  ctx.fill(body);
  groundEdge(ctx, body);

  // 등지느러미
  const fin = new Path2D();
  fin.moveTo(38, 50);
  fin.quadraticCurveTo(46, 24, 60, 18);
  fin.quadraticCurveTo(58, 38, 64, 52);
  fin.closePath();
  ctx.fillStyle = '#a5787e';
  ctx.fill(fin);

  // 아가미 틈 — 이게 있어야 '물고기'가 아니라 '상어'로 읽힌다
  ctx.strokeStyle = 'rgba(90, 50, 55, 0.55)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 7;
    ctx.beginPath();
    ctx.moveTo(x, 68);
    ctx.quadraticCurveTo(x - 4, 82, x, 98);
    ctx.stroke();
  }

  // 눈 — 상어답게 작고 새까맣다, 하이라이트도 거의 없다
  drawEye(ctx, {
    cx: 68,
    cy: 62,
    r: 6,
    socket: '#1a0f10',
    iris: ['#241416', '#140a0b', '#0a0506'],
    slit: false,
    highlight: true,
  });

  // 주둥이 — 길고 납작한 칼날. 여기가 고블린상어의 정체다.
  const snoutSkin = ctx.createLinearGradient(80, 50, 195, 80);
  snoutSkin.addColorStop(0, '#f1dade');
  snoutSkin.addColorStop(1, '#c99298');
  const snout = new Path2D();
  snout.moveTo(80, 60);
  snout.quadraticCurveTo(130, 46, 180, 55);
  snout.quadraticCurveTo(193, 58, 197, 64);
  snout.quadraticCurveTo(190, 71, 172, 73);
  snout.quadraticCurveTo(125, 72, 82, 82);
  snout.closePath();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = snoutSkin;
  ctx.fill(snout);
  ctx.globalAlpha = 1;
  groundEdge(ctx, snout);

  // 턱 — 주둥이 아래에서 앞으로 튀어나온다 (실제로 앞으로 뻗어 무는 습성)
  const jawSkin = ctx.createLinearGradient(90, 84, 180, 104);
  jawSkin.addColorStop(0, '#c4949a');
  jawSkin.addColorStop(1, '#8c5f65');
  const jaw = new Path2D();
  jaw.moveTo(90, 86);
  jaw.quadraticCurveTo(128, 100, 165, 98);
  jaw.quadraticCurveTo(176, 97, 180, 92);
  jaw.quadraticCurveTo(166, 88, 144, 87);
  jaw.quadraticCurveTo(118, 84, 90, 86);
  jaw.closePath();
  ctx.fillStyle = jawSkin;
  ctx.fill(jaw);
  groundEdge(ctx, jaw);

  // 못처럼 가늘고 촘촘한 이빨
  ctx.fillStyle = '#f7eef0';
  ctx.strokeStyle = '#9a7278';
  ctx.lineWidth = 0.7;
  const teeth = [104, 116, 128, 140, 152, 163];
  teeth.forEach((x, n) => fang(ctx, x, 88, 12 - (n % 3) * 1.6, true));
}

// ---------- 대왕오징어 (giant squid) ----------
//
// 정체를 알리는 건 몸통이 아니라 눈이다. 실제 대왕오징어의 눈은 몸에 비해
// 터무니없이 크다 — 그 비율을 그대로 과장해서 화면 한가운데 크게 앉힌다.
function drawSquid(ctx: CanvasRenderingContext2D): void {
  const mantleSkin = ctx.createLinearGradient(15, 5, 100, 65);
  mantleSkin.addColorStop(0, '#8a3745');
  mantleSkin.addColorStop(0.55, '#5c2028');
  mantleSkin.addColorStop(1, '#2a0c12');

  const mantle = new Path2D();
  mantle.moveTo(18, 55);
  mantle.quadraticCurveTo(12, 14, 55, 6);
  mantle.quadraticCurveTo(96, 2, 102, 34);
  mantle.quadraticCurveTo(104, 55, 80, 63);
  mantle.quadraticCurveTo(44, 70, 18, 55);
  mantle.closePath();
  ctx.fillStyle = mantleSkin;
  ctx.fill(mantle);
  groundEdge(ctx, mantle);

  // 지느러미 — 외투막 위에 겹쳐 얹는다
  const fin = new Path2D();
  fin.moveTo(50, 8);
  fin.quadraticCurveTo(30, -8, 12, 4);
  fin.quadraticCurveTo(28, 16, 48, 20);
  fin.closePath();
  ctx.fillStyle = '#42151c';
  ctx.fill(fin);

  // 외투막 위 옅은 얼룩 — 살아 있는 덩어리로 보이게
  ctx.save();
  ctx.clip(mantle);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#c46a72';
  for (const [cx, cy, rx, ry] of [
    [40, 20, 13, 8],
    [70, 40, 11, 7],
    [30, 45, 10, 6],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 거대한 눈 — 이 그림의 주인공. 외투막과 겹치도록 오른쪽에 크게 앉힌다.
  drawEye(ctx, {
    cx: 128,
    cy: 62,
    r: 38,
    socket: '#05070c',
    iris: ['#bfe6ff', '#3f5f8a', '#0a1526'],
    slit: false,
    highlight: true,
  });

  // 촉완 다섯 — 외투막 아래에서 뻗어나가 화면 아래를 채운다. 끝은 곤봉 모양.
  const arms: { p0: [number, number]; pc: [number, number]; p1: [number, number]; w0: number; w1: number }[] = [
    { p0: [30, 58], pc: [12, 104], p1: [8, 146], w0: 11, w1: 5 },
    { p0: [45, 63], pc: [34, 110], p1: [42, 148], w0: 12, w1: 5.5 },
    { p0: [60, 66], pc: [64, 116], p1: [86, 149], w0: 13, w1: 6 },
    { p0: [76, 65], pc: [96, 114], p1: [122, 147], w0: 12, w1: 5.5 },
    { p0: [90, 60], pc: [116, 108], p1: [152, 141], w0: 11, w1: 5 },
  ];
  const limbSkin = ctx.createLinearGradient(0, 60, 0, 150);
  limbSkin.addColorStop(0, '#6c2632');
  limbSkin.addColorStop(1, '#33121a');
  ctx.fillStyle = limbSkin;
  for (const a of arms) {
    const tip = taperedLimb(ctx, a.p0, a.pc, a.p1, a.w0, a.w1);
    // 곤봉 끝 + 빨판
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(tip[0], tip[1], 7, 5, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#7c3038';
    ctx.fill();
    ctx.fillStyle = 'rgba(230, 190, 195, 0.85)';
    for (const [dx, dy] of [
      [-3, -1],
      [0, 1.5],
      [3, -0.5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(tip[0] + dx, tip[1] + dy, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = limbSkin;
  }
}

const DRAW: Record<PredatorKind, (ctx: CanvasRenderingContext2D) => void> = {
  anglerfish: drawAnglerfish,
  goblinShark: drawGoblinShark,
  squid: drawSquid,
};

/**
 * 실패 모달에 띄우는 포식자 그림 하나.
 *
 * 이 판에서 실제로 쫓아오던 종(levels.ts predatorFor, level.ts 가 넘겨준다)을 그대로
 * 그린다 — 문구는 이미 그 이름을 부르는데 그림이 다른 놈이면 "얘한테 잡혔구나"가
 * 안 읽힌다.
 */
export function predatorArt(kind: PredatorKind): HTMLCanvasElement {
  const canvas = el('canvas', { width: String(W), height: String(H) }) as HTMLCanvasElement;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  DRAW[kind](ctx);
  return canvas;
}
