// 사진 텍스처 로더.
//
// Poly Haven(CC0) 4k 디퓨즈를 tools 하네스에서 축소 + 심해 색보정해 구운 결과물이다.
// 원본 라이선스: CC0 (https://polyhaven.com/textures)
//   gravel  ← coral_gravel
//   rock    ← dark_rock_02
//   boulder ← rock_boulder_cracked
//   sand    ← coast_sand_05
//   coral   ← coral_fort_wall_01
//
// 전부 심리스라 그냥 반복 패턴으로 깔면 된다.
// 절차적으로 찍던 자갈·바위 무늬 대신 이걸 깔아야 '게임 그래픽'이 아니라 실물로 읽힌다.

import boulderTex from './assets/textures/boulder.jpg';
import coralTex from './assets/textures/coral.jpg';
import gravelTex from './assets/textures/gravel.jpg';
import rockTex from './assets/textures/rock.jpg';
import sandTex from './assets/textures/sand.jpg';

const URLS = {
  gravel: gravelTex,
  rock: rockTex,
  boulder: boulderTex,
  sand: sandTex,
  coral: coralTex,
} as const;

export type TextureName = keyof typeof URLS;

const images = {} as Record<TextureName, HTMLImageElement>;
const patterns = new Map<string, CanvasPattern>();
let requested = false;

export function preloadTextures(): void {
  if (requested) return;
  requested = true;
  for (const name of Object.keys(URLS) as TextureName[]) {
    const img = new Image();
    img.decoding = 'async';
    img.src = URLS[name];
    images[name] = img;
  }
}

/** 준비된 이미지. 아직이면 null — 호출부는 그 프레임을 건너뛰거나 폴백을 쓴다. */
export function texture(name: TextureName): HTMLImageElement | null {
  preloadTextures();
  const img = images[name];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function texturesReady(): boolean {
  preloadTextures();
  return (Object.keys(URLS) as TextureName[]).every((n) => texture(n) !== null);
}

/**
 * 반복 패턴. `scale` 로 원본 대비 배율을 준다 (알갱이 크기 조절).
 * 패턴은 컨텍스트에 묶이지 않으므로 캐시해도 된다.
 */
export function texturePattern(
  ctx: CanvasRenderingContext2D,
  name: TextureName,
  scale = 1,
): CanvasPattern | null {
  const key = `${name}@${scale.toFixed(3)}`;
  const hit = patterns.get(key);
  if (hit) return hit;

  const img = texture(name);
  if (!img) return null;

  let source: HTMLImageElement | HTMLCanvasElement = img;
  if (scale !== 1) {
    const size = Math.max(8, Math.round(img.naturalWidth * scale));
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const cx = c.getContext('2d');
    if (!cx) return null;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, size, size);
    source = c;
  }

  const pattern = ctx.createPattern(source, 'repeat');
  if (!pattern) return null;
  patterns.set(key, pattern);
  return pattern;
}

/** 화면 크기가 바뀌어 배율이 달라지면 패턴 캐시를 버린다 */
export function clearPatterns(): void {
  patterns.clear();
}
