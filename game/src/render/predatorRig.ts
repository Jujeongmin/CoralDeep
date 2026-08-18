// 수심대별 포식자 — 아귀와 대왕오징어 촉수.
//
// 곰치는 스프라이트(`eelRig.ts`)를 쓰지만 이 둘은 캔버스로 직접 그린다. 심해 생물은
// 실루엣과 발광이 전부라 도형 몇 개로 충분하고, SVG 를 더 굽는 것보다 이쪽이 가볍다.
//
// **좌표 규약은 곰치와 같다**: 원점이 회전축, 로컬 +x 가 진행 방향, 단위는 '스프라이트
// 원본 단위'다. 그래야 `levelScene` 의 접근 계산(입 오프셋만큼 당겨 겨냥하기)을
// 세 생물이 그대로 공유한다.

export interface PredatorDraw {
  x: number;
  y: number;
  /** 원본 단위 → 화면 픽셀 */
  scale: number;
  rotation: number;
  /**
   * 세로 뒤집기. 왼쪽을 향할 때 -1.
   *
   * 그림은 오른쪽을 보고 그려져 있다. 왼쪽으로 가려고 180° 돌리면 위아래까지 같이
   * 뒤집혀 배가 하늘로 간다. 회전만으로는 왼쪽을 보게 만들 수 없다.
   */
  flip?: 1 | -1;
  /**
   * true 면 **앞쪽 조각만** 그린다 (아귀는 아래턱, 촉수는 가까운 갈고리).
   *
   * 포식자는 잠수부보다 뒤에 그려진다. 코앞까지 왔을 때 그대로 두면 사람이 턱 앞에
   * 선 것처럼 보여 거리감이 죽는다. 배경에 전체를 그린 뒤 앞 조각만 한 번 더 얹으면
   * 잠수부가 그 사이에 놓인다.
   */
  front?: boolean;
  /** 입 벌린 정도 0..1 */
  open: number;
  /** 0 = 멀다, 1 = 코앞. 발광 세기와 혈색에 쓴다 */
  menace: number;
  time: number;
}

/** 아귀 머리의 원본 높이 — 접근 계산에서 크기 기준이 된다 */
export const ANGLER_HEAD_H = 120;
/** 회전축에서 입 안쪽까지 (원본 단위) */
export const ANGLER_MOUTH: [number, number] = [58, 4];

/** 촉수 곤봉부의 원본 높이 */
export const CLUB_H = 96;
/** 회전축에서 흡반 한가운데까지 */
export const CLUB_GRIP: [number, number] = [52, 0];

/** 아귀의 아래턱 + 아랫니. 앞뒤로 나눠 그려야 해서 따로 뺐다. */
function anglerJaw(ctx: CanvasRenderingContext2D, gape: number): void {
  // ---- 아래턱 (벌어진다) ----
  ctx.save();
  ctx.translate(18, 10);
  ctx.rotate(gape * 0.55);
  ctx.fillStyle = '#1a2a33';
  ctx.beginPath();
  ctx.moveTo(-24, -8);
  ctx.quadraticCurveTo(34, 2, 56, 16);
  ctx.quadraticCurveTo(20, 26, -22, 14);
  ctx.closePath();
  ctx.fill();
  // 아랫니
  ctx.fillStyle = '#e8f2f0';
  for (let n = 0; n < 6; n++) {
    const t = n / 5;
    const tx = -14 + t * 62;
    const ty = -4 + t * 20;
    ctx.beginPath();
    ctx.moveTo(tx - 3, ty);
    ctx.lineTo(tx + 3, ty);
    ctx.lineTo(tx, ty - 11 - (n % 2) * 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

}

/**
 * 아귀 — 박명대의 포식자.
 *
 * 몸이 아니라 **유인등(illicium)** 이 먼저 보인다. 어두운 물에서 점 하나가 흔들리며
 * 다가오다가, 가까워져서야 그 뒤의 대가리가 드러난다. 곰치가 '뻗어 오는 길이'로
 * 시간을 보여줬다면 이쪽은 '점점 밝아지는 등불'이 시계다.
 */
export function drawAngler(ctx: CanvasRenderingContext2D, d: PredatorDraw): void {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rotation);
  ctx.scale(d.scale, d.scale * (d.flip ?? 1));

  const gape = d.open;
  const lit = 0.45 + d.menace * 0.55;

  // 앞 조각만: 아래턱과 이빨. 잠수부가 위턱과 이 사이에 놓인다.
  if (d.front) {
    anglerJaw(ctx, gape);
    ctx.restore();
    return;
  }

  // ---- 몸통 (뒤쪽으로 좁아지는 물방울) ----
  ctx.fillStyle = '#20313a';
  ctx.beginPath();
  ctx.moveTo(-96, 0);
  ctx.bezierCurveTo(-80, -46, -20, -62, 26, -44);
  ctx.bezierCurveTo(52, -33, 60, -14, 60, 0);
  ctx.bezierCurveTo(60, 16, 50, 34, 24, 46);
  ctx.bezierCurveTo(-18, 62, -78, 44, -96, 0);
  ctx.closePath();
  ctx.fill();

  // 등에서 이어지는 지느러미 — 물살에 느리게 흔들린다
  const finWave = Math.sin(d.time * 2.2) * 6;
  ctx.fillStyle = 'rgba(38, 60, 72, 0.85)';
  ctx.beginPath();
  ctx.moveTo(-88, -6);
  ctx.quadraticCurveTo(-118 + finWave, -34, -132, 4);
  ctx.quadraticCurveTo(-114 - finWave, 22, -86, 12);
  ctx.closePath();
  ctx.fill();

  // 배 쪽 명암 — 원통이라는 유일한 단서
  ctx.fillStyle = 'rgba(8, 16, 22, 0.55)';
  ctx.beginPath();
  ctx.moveTo(-90, 10);
  ctx.bezierCurveTo(-40, 52, 4, 54, 30, 40);
  ctx.bezierCurveTo(-6, 58, -60, 48, -90, 10);
  ctx.closePath();
  ctx.fill();

  anglerJaw(ctx, gape);

  // ---- 입 안쪽 ----
  ctx.fillStyle = '#320d14';
  ctx.beginPath();
  ctx.moveTo(14, -12);
  ctx.quadraticCurveTo(52, -4, 62, 6);
  ctx.quadraticCurveTo(46, 18, 12, 14);
  ctx.closePath();
  ctx.fill();

  // ---- 위턱 + 윗니 ----
  ctx.fillStyle = '#26383f';
  ctx.beginPath();
  ctx.moveTo(-30, -20);
  ctx.quadraticCurveTo(30, -26, 62, -2);
  ctx.quadraticCurveTo(24, -6, -28, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8f2f0';
  for (let n = 0; n < 7; n++) {
    const t = n / 6;
    const tx = -18 + t * 74;
    const ty = -14 + t * 10;
    ctx.beginPath();
    ctx.moveTo(tx - 3, ty);
    ctx.lineTo(tx + 3, ty);
    ctx.lineTo(tx, ty + 12 + (n % 2) * 5);
    ctx.closePath();
    ctx.fill();
  }

  // ---- 눈 ----
  ctx.fillStyle = '#0a1016';
  ctx.beginPath();
  ctx.arc(-2, -26, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 214, 120, ${0.55 + d.menace * 0.45})`;
  ctx.beginPath();
  ctx.arc(1, -27, 5.5, 0, Math.PI * 2);
  ctx.fill();

  // ---- 유인등 ----
  // 머리 위에서 앞으로 휜 낚싯대. 끝의 알이 이 생물의 '시계'다.
  const bob = Math.sin(d.time * 1.6) * 7;
  const tipX = 78;
  const tipY = -62 + bob;
  ctx.strokeStyle = 'rgba(150, 175, 185, 0.9)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, -34);
  ctx.quadraticCurveTo(38, -96 + bob, tipX, tipY);
  ctx.stroke();

  const flicker = 0.75 + 0.25 * Math.sin(d.time * 7.3);
  const halo = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 54);
  halo.addColorStop(0, `rgba(190, 245, 255, ${0.85 * lit * flicker})`);
  halo.addColorStop(0.35, `rgba(120, 210, 255, ${0.35 * lit * flicker})`);
  halo.addColorStop(1, 'rgba(90, 180, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(236, 253, 255, ${0.9 * flicker})`;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 8.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * 대왕오징어 촉수 — 심해대의 포식자.
 *
 * 통짜 생물이 아니라 **팔 하나만** 어둠에서 내려온다. 몸통을 안 보여주는 게 핵심이다.
 * 화면 밖에 얼마나 큰 게 있는지 모르는 편이 다 보여주는 것보다 무섭다.
 *
 * `reach` 는 회전축(굴 입구)에서 곤봉까지의 픽셀 거리다. 팔이 그만큼 자란다.
 */
export function drawTentacle(
  ctx: CanvasRenderingContext2D,
  d: PredatorDraw & { reach: number },
): void {
  const len = Math.max(1, d.reach);
  const s2 = d.scale;

  // 앞 조각만: 가까운 쪽 갈고리 하나. 잠수부가 두 갈고리 사이에 놓인다.
  if (d.front) {
    const grip = 1 - d.open;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rotation);
    // 곤봉은 팔의 흔들림(curl)만큼 밀려 있다. 그만큼 같이 옮기지 않으면
    // 갈고리만 허공에 뜬다.
    const curlEnd =
      Math.sin(d.time * (0.9 + d.menace * 1.1) + 3.4) * len * 0.07 * (0.4 + d.menace * 0.6);
    ctx.translate(len, curlEnd);
    ctx.rotate(-(0.75 - grip * 0.5));
    ctx.fillStyle = '#5a1b33';
    ctx.beginPath();
    ctx.moveTo(s2 * 34, -s2 * 4);
    ctx.quadraticCurveTo(s2 * 74, -s2 * 16, s2 * 92, -s2 * 2);
    ctx.quadraticCurveTo(s2 * 70, -s2 * 30, s2 * 32, -s2 * 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rotation);

  const s = d.scale;
  // 뿌리는 굵고 곤봉 직전이 가장 가늘다 — 오징어 촉수의 특징이다
  const halfW = (t: number): number => s * (34 - 24 * t * t) * (0.55 + 0.45 * (1 - t) ** 0.5);
  const curl = (t: number): number =>
    Math.sin(d.time * (0.9 + d.menace * 1.1) + t * 3.4) * len * 0.07 * t * (0.4 + d.menace * 0.6);

  const point = (t: number): [number, number] => [len * t, curl(t)];

  const SEG = 20;
  const ribbon = new Path2D();
  for (let n = 0; n <= SEG; n++) {
    const t = n / SEG;
    const [px, py] = point(t);
    n === 0 ? ribbon.moveTo(px, py - halfW(t)) : ribbon.lineTo(px, py - halfW(t));
  }
  for (let n = SEG; n >= 0; n--) {
    const t = n / SEG;
    const [px, py] = point(t);
    ribbon.lineTo(px, py + halfW(t));
  }
  ribbon.closePath();

  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, '#3a1430');
  grad.addColorStop(0.6, d.menace > 0.6 ? '#7a2547' : '#5d1d3a');
  grad.addColorStop(1, d.menace > 0.6 ? '#9c3355' : '#743049');
  ctx.fillStyle = grad;
  ctx.fill(ribbon);

  // 흡반 — 두 줄로 어긋나게. 이게 있어야 고무 호스가 아니라 팔로 보인다.
  ctx.save();
  ctx.clip(ribbon);
  for (let n = 2; n <= SEG; n++) {
    const t = n / SEG;
    const [px, py] = point(t);
    const off = halfW(t) * 0.42;
    const r = Math.max(1, halfW(t) * 0.24);
    for (const side of [-1, 1]) {
      ctx.fillStyle = `rgba(250, 214, 226, ${0.24 + t * 0.3})`;
      ctx.beginPath();
      ctx.arc(px, py + off * side + (n % 2 ? r * 0.4 : -r * 0.4), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // ---- 곤봉부 (끝의 넓은 부분) — 여기가 잠수부를 붙잡는다 ----
  const [cx, cy] = point(1);
  ctx.save();
  ctx.translate(cx, cy);
  const grip = 1 - d.open; // open 이 줄수록 오므린다
  ctx.fillStyle = d.menace > 0.6 ? '#a4385c' : '#7c2743';
  ctx.beginPath();
  ctx.ellipse(s * 26, 0, s * 34, s * (20 + grip * 6), 0, 0, Math.PI * 2);
  ctx.fill();

  // 붙잡는 갈고리 두 갈래. 오므리면 안쪽으로 모인다.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.rotate(side * (0.75 - grip * 0.5));
    ctx.fillStyle = '#5a1b33';
    ctx.beginPath();
    ctx.moveTo(s * 34, side * s * 4);
    ctx.quadraticCurveTo(s * 74, side * s * 16, s * 92, side * s * 2);
    ctx.quadraticCurveTo(s * 70, side * s * 30, s * 32, side * s * 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 큰 흡반
  for (let n = 0; n < 5; n++) {
    const t = n / 4;
    ctx.fillStyle = `rgba(252, 222, 232, ${0.4 + t * 0.35})`;
    ctx.beginPath();
    ctx.arc(s * (6 + t * 44), Math.sin(n * 2.1) * s * 9, s * (5 + t * 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}
