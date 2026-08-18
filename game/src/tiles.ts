// 보드 타일·장애물 에셋과 래스터 캐시.
//
// SVG 필터(내부 그림자·스페큘러·드롭섀도)는 예쁘지만 매 프레임 적용하면 느리다.
// 그래서 칸 크기가 정해질 때 한 번만 오프스크린 캔버스로 구워두고, 그리기는 blit 만 한다.

import tile0 from './assets/tiles/tile-0.svg';
import tile1 from './assets/tiles/tile-1.svg';
import tile2 from './assets/tiles/tile-2.svg';
import tile3 from './assets/tiles/tile-3.svg';
import tile4 from './assets/tiles/tile-4.svg';
import tile5 from './assets/tiles/tile-5.svg';
import rock1 from './assets/tiles/rock-1.svg';
import rock2 from './assets/tiles/rock-2.svg';
import iceUrl from './assets/tiles/ice.svg';
import netUrl from './assets/tiles/net.svg';
import boulder1 from './assets/tiles/boulder-1.svg';
import boulder2 from './assets/tiles/boulder-2.svg';
import boulder3 from './assets/tiles/boulder-3.svg';
import boulder4 from './assets/tiles/boulder-4.svg';
import { type TextureName, clearPatterns, preloadTextures, texture } from './textures.ts';

const URLS = {
  tile0,
  tile1,
  tile2,
  tile3,
  tile4,
  tile5,
  rock1,
  rock2,
  ice: iceUrl,
  net: netUrl,
  boulder1,
  boulder2,
  boulder3,
  boulder4,
} as const;

export type TileArt = keyof typeof URLS;

export const TILE_ART: TileArt[] = ['tile0', 'tile1', 'tile2', 'tile3', 'tile4', 'tile5'];

/** 장면용 바위 변형 */
export const BOULDER_ART: TileArt[] = ['boulder1', 'boulder2', 'boulder3', 'boulder4'];

/** 사진 질감을 입힐 바위 계열 에셋. tex = 쓸 텍스처, zoom = 칸 대비 타일 크기 */
const ROCK_SKIN: Partial<Record<TileArt, { tex: TextureName; zoom: number; alpha: number }>> = {
  // 보드 위 장애물은 '산호암'이다. 맨 암석보다 산호가 붙은 벽 사진이 맞다.
  // alpha 를 더 올리면 SVG 의 베벨·하이라이트가 묻혀 납작한 얼룩이 된다.
  // 질감은 사진, 굴곡은 SVG 조명 — 둘 다 보여야 한다.
  rock1: { tex: 'coral', zoom: 1.4, alpha: 0.42 },
  rock2: { tex: 'coral', zoom: 1.4, alpha: 0.42 },
  boulder1: { tex: 'boulder', zoom: 1.3, alpha: 0.55 },
  boulder2: { tex: 'boulder', zoom: 1.3, alpha: 0.55 },
  boulder3: { tex: 'boulder', zoom: 1.3, alpha: 0.55 },
  boulder4: { tex: 'boulder', zoom: 1.3, alpha: 0.55 },
};

const images = {} as Record<TileArt, HTMLImageElement>;
/** 구워둔 래스터. 키는 `이름@변길이` */
const baked = new Map<string, HTMLCanvasElement>();
let requested = false;

export function preloadTiles(): void {
  if (requested) return;
  requested = true;
  preloadTextures();
  for (const name of Object.keys(URLS) as TileArt[]) {
    const img = new Image();
    img.decoding = 'async';
    img.src = URLS[name];
    images[name] = img;
  }
}

function ready(name: TileArt): HTMLImageElement | null {
  preloadTiles();
  const img = images[name];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** 에셋이 다 준비됐는가 (준비 전에는 호출부가 단색 폴백을 그린다) */
export function tilesReady(): boolean {
  return (Object.keys(URLS) as TileArt[]).every((n) => ready(n) !== null);
}

/**
 * 지정한 변 길이로 구운 래스터를 준다. 없으면 굽고 캐시한다.
 * 아직 이미지가 안 올라왔으면 null.
 */
export function bakedTile(name: TileArt, size: number): HTMLCanvasElement | null {
  const px = Math.max(8, Math.round(size));
  const key = `${name}@${px}`;
  const hit = baked.get(key);
  if (hit) return hit;

  const img = ready(name);
  if (!img) return null;

  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, px, px);

  // 바위 계열은 SVG 로 만든 실루엣·베벨 위에 실제 암석 사진을 얹는다.
  // 형태는 SVG 가, 표면 질감은 사진이 담당한다 — 이래야 '돌'로 보인다.
  const skin = ROCK_SKIN[name];
  if (skin) {
    const tex = texture(skin.tex);
    if (!tex) return null; // 사진이 아직이면 굽지 않는다 (다음 호출에 다시 시도)
    const skinCanvas = document.createElement('canvas');
    skinCanvas.width = px;
    skinCanvas.height = px;
    const sx = skinCanvas.getContext('2d');
    const pattern = sx && sx.createPattern(tex, 'repeat');
    if (sx && pattern) {
      pattern.setTransform(new DOMMatrix().scale((px * skin.zoom) / tex.naturalWidth));
      sx.fillStyle = pattern;
      sx.fillRect(0, 0, px, px);
      // 바위 실루엣으로 오려낸다. 이걸 안 하면 overlay 합성이 투명한 바깥까지
      // 칠해서 네모난 판때기가 된다 (source-atop 과 달리 overlay 는 알파를 안 지킨다).
      sx.globalCompositeOperation = 'destination-in';
      sx.drawImage(img, 0, 0, px, px);

      ctx.save();
      ctx.globalAlpha = skin.alpha;
      ctx.drawImage(skinCanvas, 0, 0);
      // overlay 로 한 번 더 — 사진의 명암이 베벨과 곱해져 굴곡이 살아난다
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = skin.alpha * 0.7;
      ctx.drawImage(skinCanvas, 0, 0);
      ctx.restore();
    }
  }

  baked.set(key, canvas);
  return canvas;
}

/** 화면 크기가 바뀌면 구워둔 래스터를 전부 버린다 (크기가 달라져 다시 구워야 한다) */
export function clearBaked(): void {
  baked.clear();
  clearPatterns();
}
