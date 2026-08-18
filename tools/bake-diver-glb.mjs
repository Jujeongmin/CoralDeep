// 잠수부 굽기 — Quaternius SpaceSuit(FBX, CC0) -> diver.glb
//
// 예전 도구(bake-diver-3d.mjs)는 같은 FBX 를 소프트웨어 렌더러로 PNG 한 장에 구웠다.
// 이제 런타임이 3D 라서 기하를 그대로 내보낸다. 치수·포즈·팔레트는 그 도구의 것을
// 그대로 쓴다 — 직접 재본 값이라 다시 유도하면 틀린다.
//
// 좌표계로 두 번 틀렸던 기록을 남긴다:
//   * FBX 표준은 Y-up 이지만 Blender 로 내보낸 것은 Z-up 이다. 틀리면 정수리에서
//     내려다본 그림(팔이 좌우로 뻗은 T 자)이 나온다.
//   * Blender 인물은 -Y 를 향해 서 있다. 그대로 보면 뒤통수만 나온다.
//
// 텍스처를 안 쓰고 버텍스 컬러로 칠한다. 런타임 이미지 파일이 0개가 된다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { meshesOf, parseFbx } from './lib/fbx.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'assets-raw/quaternius-men/SpaceSuit');
const OUT = resolve(ROOT, 'game/src/assets/sprites3d/diver.glb');

// ---- 모델 치수 (bake-diver-3d.mjs 에서 그대로. 단위: 모델 좌표, z 가 높이) ----
const TORSO_HALF_W = 0.19; // 이 바깥은 팔
const SHOULDER_Z = 1.5; // 팔이 붙는 높이 (회전축)
const HEAD_TOP_Z = 1.89;
const FOOT_Z = 0;

/** 팔을 내리는 각도. 0 이면 T 포즈, 완전 수직은 차렷이라 뻣뻣하다. 75도가 자연스럽다. */
const ARM_DROP = (75 * Math.PI) / 180;

// 잠수복 팔레트 (0..255). 구리 헬멧이 정체를 한 번에 알리고, 네오프렌 몸통과 납 부츠가
// 그걸 받친다. 몸통을 너무 어둡게 두면 640m 물빛에 실루엣이 잠긴다 — 대비는 헬멧이 만든다.
const HELMET = [186, 148, 86];
const SUIT = [56, 84, 106];
const PANTS = [40, 62, 82];
const BOOT = [118, 104, 88];

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
      const dx = x - side * TORSO_HALF_W;
      const dz = verts[i + 2] - SHOULDER_Z;
      verts[i] = side * TORSO_HALF_W + (dx * cos + side * dz * sin);
      verts[i + 2] = SHOULDER_Z + (-side * dx * sin + dz * cos);
    }
    return { verts, tris: m.tris };
  });
}

// 팔은 Body 에 붙어 있으므로 Body 만 포즈를 잡는다.
// 부위마다 색이 다르므로 색을 달고 다닌다.
const tinted = [
  ...parts.Head.map((m) => ({ ...m, rgb: HELMET })),
  ...poseArms(parts.Body).map((m) => ({ ...m, rgb: SUIT })),
  ...parts.Legs.map((m) => ({ ...m, rgb: PANTS })),
  ...parts.Feet.map((m) => ({ ...m, rgb: BOOT })),
];

/** 모델 좌표 -> Y-up, +Z 정면 */
const mapVert = (v, i) => [v[i], v[i + 2], -v[i + 1]];

/**
 * 부위 메시들을 정점 하나짜리 버퍼로 합친다.
 * 부위마다 인덱스가 0부터 다시 시작하므로 오프셋을 더해야 한다.
 */
function merge(meshes) {
  const position = [];
  const color = [];
  const index = [];
  for (const m of meshes) {
    const base = position.length / 3;
    for (let i = 0; i < m.verts.length; i += 3) {
      const [x, y, z] = mapVert(m.verts, i);
      position.push(x, y, z);
      color.push(m.rgb[0] / 255, m.rgb[1] / 255, m.rgb[2] / 255);
    }
    for (const tri of m.tris) index.push(base + tri[0], base + tri[1], base + tri[2]);
  }
  return {
    position: new Float32Array(position),
    color: new Float32Array(color),
    index: new Uint32Array(index),
  };
}

/**
 * 발이 y=0, 정수리가 y=1 이 되도록 정규화한다.
 * 런타임이 칸 크기에 맞춰 scale 만 곱하면 되게 하려면 전신 높이가 1 이어야 한다.
 * 좌우·앞뒤는 가운데로 모은다.
 */
function normalize(position) {
  const span = HEAD_TOP_Z - FOOT_Z;
  let minY = Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < position.length; i += 3) {
    minY = Math.min(minY, position[i + 1]);
    cx += position[i];
    cz += position[i + 2];
  }
  const n = position.length / 3;
  cx /= n;
  cz /= n;
  for (let i = 0; i < position.length; i += 3) {
    position[i] = (position[i] - cx) / span;
    position[i + 1] = (position[i + 1] - minY) / span;
    position[i + 2] = (position[i + 2] - cz) / span;
  }
}

/**
 * 면 법선을 정점에 누적한 뒤 정규화한다.
 * 런타임이 flatShading 을 쓰므로 정밀할 필요는 없다.
 */
function computeNormals(position, index) {
  const normal = new Float32Array(position.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3;
    const b = index[i + 1] * 3;
    const c = index[i + 2] * 3;
    const ux = position[b] - position[a];
    const uy = position[b + 1] - position[a + 1];
    const uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a];
    const vy = position[c + 1] - position[a + 1];
    const vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      normal[o] += nx;
      normal[o + 1] += ny;
      normal[o + 2] += nz;
    }
  }
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= l;
    normal[i + 1] /= l;
    normal[i + 2] /= l;
  }
  return normal;
}

/**
 * 최소 glb 작성기.
 * 읽을 파서도 우리가 쓰므로 규격 전부를 만족시킬 필요는 없다. 그래도 확장자를 .glb 로
 * 쓰는 이상 헤더·청크 구조는 규격대로 맞춘다 — 나중에 다른 도구로 열어볼 때 그게 싸다.
 */
function writeGlb(position, normal, color, index) {
  const pad4 = (n) => (n + 3) & ~3;
  const bin = Buffer.concat([
    Buffer.from(position.buffer, position.byteOffset, position.byteLength),
    Buffer.from(normal.buffer, normal.byteOffset, normal.byteLength),
    Buffer.from(color.buffer, color.byteOffset, color.byteLength),
    Buffer.from(index.buffer, index.byteOffset, index.byteLength),
  ]);
  const offs = {
    pos: 0,
    nrm: position.byteLength,
    col: position.byteLength + normal.byteLength,
    idx: position.byteLength + normal.byteLength + color.byteLength,
  };
  const json = {
    asset: { version: '2.0', generator: 'coral-deep bake-diver-glb' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3 }] },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: offs.pos, byteLength: position.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs.nrm, byteLength: normal.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs.col, byteLength: color.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs.idx, byteLength: index.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: position.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: normal.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: color.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: index.length, type: 'SCALAR' },
    ],
  };
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20);
  const binPad = Buffer.alloc(pad4(bin.length) - bin.length, 0);
  const total = 12 + 8 + jsonBuf.length + jsonPad.length + 8 + bin.length + binPad.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); // 'glTF'
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length + jsonPad.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length + binPad.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // 'BIN'
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.concat([head, jsonHead, jsonBuf, jsonPad, binHead, bin, binPad]));
}

const merged = merge(tinted);
normalize(merged.position);
const normal = computeNormals(merged.position, merged.index);
writeGlb(merged.position, normal, merged.color, merged.index);
console.log(`diver.glb  정점 ${merged.position.length / 3}  삼각형 ${merged.index.length / 3}`);
