// 캐릭터 스프라이트 로더.
//
// 부위를 따로 회전시켜야 발버둥치는 동작이 나오므로 한 장짜리 그림이 아니라 조각으로 쓴다.
//
// 잠수부는 Quaternius 의 SpaceSuit(CC0, FBX)를 `tools/bake-diver-3d.mjs` 로 구운 PNG 한 장이다.
// 원본이 T 포즈라 굽기 전에 3D 에서 팔을 내려 자세를 잡는다. 기준점과 전신 높이는
// 그 도구가 `diver.json` 으로 함께 내보낸다 — 손으로 옮겨 적으면 굽는 기준을 고칠 때마다 어긋난다.
//
// 곰치와 케이지는 여전히 직접 그린 SVG 다 (`tools/make-sprites.mjs`).

import cageBars from './assets/sprites/cage-bars.svg';
import eelHead from './assets/sprites/eel-head.svg';
import eelJaw from './assets/sprites/eel-jaw.svg';
import diver from './assets/sprites3d/diver.png';
import diverMeta from './assets/sprites3d/diver.json';

const URLS = {
  cageBars,
  diver,
  eelHead,
  eelJaw,
} as const;

export type SpriteName = keyof typeof URLS;

/** 구운 잠수부의 기준점·전신 높이 (스프라이트 픽셀) */
export const DIVER_META = diverMeta;

/** 회전·배치 기준점. 잠수부는 굽는 도구가, 곰치는 make-sprites.mjs 가 정한다. */
export const PIVOT: Partial<Record<SpriteName, [number, number]>> = {
  diver: diverMeta.anchor as [number, number],
  eelHead: [10, 60],
  eelJaw: [10, 8],
};

const images = {} as Record<SpriteName, HTMLImageElement>;
let requested = false;

/** 스프라이트를 미리 올려둔다. 여러 번 불러도 한 번만 동작한다. */
export function preloadSprites(): void {
  if (requested) return;
  requested = true;
  for (const name of Object.keys(URLS) as SpriteName[]) {
    const img = new Image();
    img.decoding = 'async';
    img.src = URLS[name];
    images[name] = img;
  }
}

/** 그릴 준비가 된 이미지. 아직이면 null (그 프레임만 건너뛴다). */
export function sprite(name: SpriteName): HTMLImageElement | null {
  preloadSprites();
  const img = images[name];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** 모든 스프라이트가 준비됐는가 */
export function spritesReady(): boolean {
  preloadSprites();
  return (Object.keys(URLS) as SpriteName[]).every((n) => sprite(n) !== null);
}

export interface DrawPartOptions {
  /** 관절을 놓을 캔버스 좌표 */
  x: number;
  y: number;
  /** 원본 대비 배율 */
  scale: number;
  /** 관절 기준 회전 (라디안) */
  rotation?: number;
  /** 좌우 반전 */
  flip?: boolean;
  alpha?: number;
}

/**
 * 부위를 관절 기준으로 그린다.
 * PIVOT 이 없는 부위는 이미지 중앙을 기준으로 삼는다.
 */
export function drawPart(
  ctx: CanvasRenderingContext2D,
  name: SpriteName,
  opts: DrawPartOptions,
): void {
  const img = sprite(name);
  if (!img) return;

  const [px, py] = PIVOT[name] ?? [img.naturalWidth / 2, img.naturalHeight / 2];
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.translate(opts.x, opts.y);
  if (opts.rotation) ctx.rotate(opts.rotation);
  ctx.scale(opts.flip ? -opts.scale : opts.scale, opts.scale);
  ctx.drawImage(img, -px, -py);
  ctx.restore();
}
