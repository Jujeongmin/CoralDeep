// Quaternius SpaceSuit(FBX) 를 잠수부 스프라이트 한 장으로 굽는다.
//   실행: node tools/bake-diver-3d.mjs
//
// 예전에는 부위별로 잘라 여섯 장을 굽고 런타임에 관절마다 돌렸다. 그러면 관절마다
// 이음매가 드러나고, 저폴리 모델은 관절부가 실제로 이어져 있지 않아 팔을 꺾을수록
// 종이인형처럼 보인다. 지금은 **한 장으로 굽는다.**
//
// 대신 T 포즈 그대로 두면 팔이 좌우로 뻗은 채라 못 쓴다. 그래서 **굽기 전에 3D 에서
// 팔을 내린다** — 어깨를 축으로 팔 정점만 돌린다. 포즈를 미리 고정하니 런타임에는
// 회전이 없고, 이음매도 없다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meshesOf, parseFbx, render, writePng } from './lib/fbx.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'assets-raw/quaternius-men/SpaceSuit');
const OUT = resolve(ROOT, 'game/src/assets/sprites3d');

/** 1 모델 단위 = 몇 픽셀로 구울까. 인게임 최대 높이의 2배쯤 되게 잡는다. */
const PPU = 170;
/** 가장자리가 잘리지 않게 두는 여백(px) */
const PAD = 6;

// ---- 모델 치수 (직접 재본 값, 단위: 모델 좌표) ----
//
//   Head  z 1.43..1.89   x ±0.16
//   Body  z 0.99..1.59   x ±0.84  ← ±0.19 바깥이 팔
//   Legs  z 0.22..1.03   x ±0.18
//   Feet  z 0.00..0.27   x ±0.19
//
// 전신 높이 1.89, 머리 0.46 → 약 4.1 등신.
const TORSO_HALF_W = 0.19; // 이 바깥은 팔
const SHOULDER_Z = 1.5; // 팔이 붙는 높이 (회전축)
const ANCHOR_Z = 1.52; // 스프라이트 기준점 = 몸통 윗면
const HEAD_TOP_Z = 1.89;
const FOOT_Z = 0;

/**
 * 팔을 내리는 각도(라디안).
 *
 * 0 이면 T 포즈, π/2 면 완전히 수직이다. 완전 수직은 차렷 자세라 뻣뻣하고, 물속에
 * 떠 있는 사람으로도 안 보인다. 75° 쯤 내리면 겨드랑이가 살짝 열려 자연스럽다.
 */
const ARM_DROP = (75 * Math.PI) / 180;

const parts = {};
for (const name of ['Head', 'Body', 'Legs', 'Feet']) {
  parts[name] = meshesOf(parseFbx(readFileSync(resolve(SRC, `SpaceSuit_${name}.fbx`))));
}

/**
 * 팔 정점을 어깨 축으로 돌려 아래로 내린다.
 *
 * T 포즈라 팔이 X 축에 정렬돼 있어서 (x, z) 평면 회전 하나로 끝난다.
 * 오른팔(+x)과 왼팔(-x)은 서로 반대로 돌아야 둘 다 아래로 간다.
 */
function poseArms(meshes) {
  const cos = Math.cos(ARM_DROP);
  const sin = Math.sin(ARM_DROP);
  return meshes.map((m) => {
    const verts = m.verts.slice();
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i];
      if (Math.abs(x) <= TORSO_HALF_W) continue;
      const side = x > 0 ? 1 : -1;
      // 어깨를 원점으로 옮겨서 돌리고 되돌린다
      const dx = x - side * TORSO_HALF_W;
      const dz = verts[i + 2] - SHOULDER_Z;
      verts[i] = side * TORSO_HALF_W + (dx * cos + side * dz * sin);
      verts[i + 2] = SHOULDER_Z + (-side * dx * sin + dz * cos);
    }
    return { verts, tris: m.tris, color: m.color };
  });
}

// 잠수복 팔레트.
//
// 원본 모델은 흰 셔츠 + 청바지라 그대로 구우면 심해 잠수부로 안 읽힌다. 형태는
// 못 바꾸니 색으로 읽힌다: **구리 헬멧**이 정체를 한 번에 알리고, 네오프렌 몸통과
// 납 부츠가 그걸 받친다. 헬멧은 원래 불투명 판이라 얼굴이 없는데, 구리로 칠하면
// 그게 결함이 아니라 잠수 헬멧의 면갑으로 보인다.
//
// 몸통을 너무 어둡게 두면 640m 물빛에 잠겨 실루엣이 사라진다. 중간 톤을 유지하고
// 대비는 헬멧이 만든다.
const HELMET = [186, 148, 86];
const SUIT = [56, 84, 106];
const PANTS = [40, 62, 82];
const BOOT = [118, 104, 88];

const tint = (meshes, color) => meshes.map((m) => ({ ...m, color }));

// 팔은 Body 에 붙어 있으므로 Body 만 포즈를 잡는다
const all = [
  ...tint(parts.Head, HELMET),
  ...tint(poseArms(parts.Body), SUIT),
  ...tint(parts.Legs, PANTS),
  ...tint(parts.Feet, BOOT),
];

// ---- 좌표계 ----
// 모델은 Z-up 이고 -Y 를 향해 서 있다. 화면 [가로, 세로, 깊이] 로 옮긴다.
const map = (v, i) => [v[i], v[i + 2], -v[i + 1]];

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const m of all) {
  for (const tri of m.tris) {
    for (const vi of tri) {
      const [x, y] = map(m.verts, vi * 3);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
}

const W = Math.ceil((maxX - minX) * PPU) + PAD * 2;
const H = Math.ceil((maxY - minY) * PPU) + PAD * 2;
const project = (x, y) => [PAD + (x - minX) * PPU, PAD + (maxY - y) * PPU];

mkdirSync(OUT, { recursive: true });
writePng(resolve(OUT, 'diver.png'), W, H, render(all, W, H, { map, project }));

// 기준점: 몸통 윗면 한가운데. 장면 배치가 이 점을 기준으로 계산한다.
const [ax, ay] = project(0, ANCHOR_Z);

const meta = {
  ppu: PPU,
  size: [W, H],
  /** 스프라이트 안에서 기준점이 놓인 픽셀 */
  anchor: [Math.round(ax), Math.round(ay)],
  rig: {
    /** 기준점에서 발바닥까지 — 장면에 놓을 때 발 높이를 맞추는 기준 */
    feet: (ANCHOR_Z - FOOT_Z) * PPU,
    /** 머리 꼭대기부터 발바닥까지 = 전신 높이 (배율 계산용) */
    span: (HEAD_TOP_Z - FOOT_Z) * PPU,
  },
};
writeFileSync(resolve(OUT, 'diver.json'), `${JSON.stringify(meta, null, 2)}\n`);

const tris = all.reduce((s, m) => s + m.tris.length, 0);
console.log(`diver.png  ${W}x${H}  ${tris} tri  anchor ${meta.anchor}`);
console.log('rig', meta.rig);
