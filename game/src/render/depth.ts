// 수심에 따른 장면 분위기.
//
// 30단계가 전부 같은 물속처럼 보이면 '내려가고 있다'가 안 읽힌다. 지도에는 12m 에서
// 640m 까지 수심이 적혀 있는데 그림이 그대로면 숫자만 늘어나는 셈이다.
//
// 그래서 **단계마다 장면을 따로 그리지 않는다.** 수심 하나를 입력으로 받아 물빛·광선·
// 부유물·발광을 연속으로 바꾼다. 레벨을 더 붙여도 그 수심에 맞는 분위기가 저절로 나온다.

export interface DepthMood {
  /** 물빛 — 장면 위쪽 */
  top: string;
  /** 물빛 — 장면 바닥 */
  bottom: string;
  /** 같은 색의 원본 성분. 소품을 물들일 때처럼 알파를 따로 줘야 할 때 쓴다. */
  bottomRgb: [number, number, number];
  /** 수면에서 내리꽂히는 빛기둥 세기 0..1 */
  shafts: number;
  /** 마린 스노우(가라앉는 유기물) 밀도 0..1 */
  snow: number;
  /** 발광 생물 세기 0..1 */
  glow: number;
  /** 발광색 */
  glowColor: [number, number, number];
  /** 암벽에 덧씌우는 어둠 0..1 */
  gloom: number;
}

interface Stop extends Omit<DepthMood, 'top' | 'bottom' | 'bottomRgb'> {
  at: number;
  top: [number, number, number];
  bottom: [number, number, number];
}

/**
 * 수심대 네 곳. 사이는 선형 보간한다.
 *
 * 실제 바다의 층을 따랐다 — 햇빛대(~50m)까지는 파랑이 살아 있고, 박명대(~200m)에서
 * 색이 빠지며, 그 아래로는 광합성이 안 되는 암흑이다. 어두워질수록 **부유물과 발광이
 * 늘어난다**: 볼 게 줄어드는 대신 남은 것들이 도드라져야 화면이 비어 보이지 않는다.
 */
const STOPS: Stop[] = [
  {
    at: 0,
    top: [46, 163, 201],
    bottom: [15, 95, 128],
    shafts: 1,
    snow: 0.14,
    glow: 0,
    glowColor: [150, 230, 255],
    gloom: 0.12,
  },
  {
    at: 0.34,
    top: [22, 96, 127],
    bottom: [6, 52, 74],
    shafts: 0.46,
    snow: 0.42,
    glow: 0.18,
    glowColor: [140, 225, 255],
    gloom: 0.4,
  },
  {
    at: 0.7,
    top: [8, 48, 63],
    bottom: [2, 24, 35],
    shafts: 0.1,
    snow: 0.72,
    glow: 0.55,
    glowColor: [120, 200, 255],
    gloom: 0.7,
  },
  {
    at: 1,
    top: [4, 20, 29],
    bottom: [1, 8, 13],
    shafts: 0,
    snow: 1,
    glow: 1,
    glowColor: [150, 150, 255],
    gloom: 0.9,
  },
];

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export const rgba = (c: [number, number, number], alpha: number): string =>
  `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha})`;

/** @param t 진행도 0..1 (`depthT()`) */
export function depthMood(t: number): DepthMood {
  const d = Math.max(0, Math.min(1, t));
  let lo = STOPS[0];
  let hi = STOPS[STOPS.length - 1];
  for (let n = 0; n < STOPS.length - 1; n++) {
    if (d >= STOPS[n].at && d <= STOPS[n + 1].at) {
      lo = STOPS[n];
      hi = STOPS[n + 1];
      break;
    }
  }
  const span = hi.at - lo.at;
  const k = span <= 0 ? 0 : (d - lo.at) / span;
  const bottomRgb = mixRgb(lo.bottom, hi.bottom, k);
  return {
    top: rgba(mixRgb(lo.top, hi.top, k), 1),
    bottom: rgba(bottomRgb, 1),
    bottomRgb,
    shafts: mix(lo.shafts, hi.shafts, k),
    snow: mix(lo.snow, hi.snow, k),
    glow: mix(lo.glow, hi.glow, k),
    glowColor: mixRgb(lo.glowColor, hi.glowColor, k),
    gloom: mix(lo.gloom, hi.gloom, k),
  };
}
