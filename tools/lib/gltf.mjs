// glTF(.glb) 최소 리더 — poly.pizza 에서 받은 Quaternius 저폴리 물고기들을 굽는 데만 쓴다.
//
// fbx.mjs/fbxSkin.mjs 가 FBX 를 위해 그랬듯, 여기서도 규격 전부를 구현하지 않는다.
// 우리가 실제로 굽는 세 파일(anglerfish.glb, goblin-shark.glb, squid.glb)이 쓰는
// 부분집합만 읽는다 — POSITION/NORMAL/TEXCOORD_n/JOINTS_0/WEIGHTS_0 accessor,
// 노드 TRS 계층(matrix 필드는 안 씀 — 세 파일 다 안 쓴다), 단일 skin, LINEAR
// 보간 애니메이션 채널(translation/rotation/scale). 이 파일이 GLTFLoader 를
// 대신하려는 게 아니다 — Node 오프라인 도구 안에서만 쓰고, 런타임(game/src)에는
// 안 들어간다(런타임은 여전히 render3d/glb.ts 의 우리 포맷 전용 파서만 쓴다).
//
// 행렬·쿼터니언 수학은 직접 구현하지 않고 three 코어(Matrix4/Quaternion/Vector3)를
// 그대로 쓴다 — three 는 이미 프로젝트 의존성이고, 이 계산은 순수 수학이라 Node 에서
// DOM 없이도 그대로 동작한다(브라우저 전용 API 를 안 쓴다). "three core만, examples
// 금지·GLTFLoader 금지" 규칙은 런타임 번들 얘기다 — 이 파일은 빌드타임 Node 스크립트고
// GLTFLoader 가 아니라 우리가 직접 짠 JSON/바이너리 파서다.

import * as THREE from 'three';

const COMPONENT_TYPES = {
  5120: { ctor: Int8Array, size: 1 },
  5121: { ctor: Uint8Array, size: 1 },
  5122: { ctor: Int16Array, size: 2 },
  5123: { ctor: Uint16Array, size: 2 },
  5125: { ctor: Uint32Array, size: 4 },
  5126: { ctor: Float32Array, size: 4 },
};

const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** glb 컨테이너(헤더 + JSON 청크 + BIN 청크)를 연다. */
export function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('glb 헤더가 아니다(glTF 매직 불일치)');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let p = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  while (p < buf.length) {
    const chunkLen = buf.readUInt32LE(p);
    const chunkType = buf.readUInt32LE(p + 4);
    const data = buf.subarray(p + 8, p + 8 + chunkLen);
    if (chunkType === 0x004e4942) bin = data; // 'BIN\0'
    p += 8 + chunkLen;
  }
  return { json, bin };
}

/**
 * accessor 하나를 원시 타입 배열로 읽는다 — normalize/역직렬화 없이 componentType
 * 그대로(JOINTS_0 의 정수 인덱스를 실수로 뭉개면 안 되므로 Float32 로 강제하지 않는다).
 * bufferView 에 byteStride 가 있으면(인터리브) 그것대로 건너뛰며 읽는다 — 우리가 굽는
 * 세 파일은 전부 stride 가 없지만(직접 덤프해 확인했다) 방어적으로 지원해 둔다.
 */
export function readAccessorRaw(json, bin, index) {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const { ctor, size } = COMPONENT_TYPES[acc.componentType];
  const nc = NUM_COMPONENTS[acc.type];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? nc * size;
  const out = new ctor(acc.count * nc);
  for (let i = 0; i < acc.count; i++) {
    const off = base + i * stride;
    for (let c = 0; c < nc; c++) {
      out[i * nc + c] = readComponent(bin, off + c * size, ctor);
    }
  }
  return out;
}

function readComponent(bin, byteOffset, ctor) {
  // bin 은 Node Buffer(=Uint8Array 뷰) — DataView 로 읽으면 정렬 문제없이 안전하다.
  const dv = new DataView(bin.buffer, bin.byteOffset + byteOffset);
  switch (ctor) {
    case Int8Array:
      return dv.getInt8(0);
    case Uint8Array:
      return dv.getUint8(0);
    case Int16Array:
      return dv.getInt16(0, true);
    case Uint16Array:
      return dv.getUint16(0, true);
    case Uint32Array:
      return dv.getUint32(0, true);
    case Float32Array:
      return dv.getFloat32(0, true);
    default:
      throw new Error('알 수 없는 컴포넌트 타입');
  }
}

/** 편의 함수 — Float32Array 로 바로 쓰고 싶을 때(POSITION/NORMAL/WEIGHTS_0/TEXCOORD 등). */
export function readAccessorFloat(json, bin, index) {
  const raw = readAccessorRaw(json, bin, index);
  return raw instanceof Float32Array ? raw : Float32Array.from(raw);
}

// ---------- 노드 계층 ----------

/**
 * 노드 배열을 그대로 감싸면서 부모 맵을 붙인다. glTF 는 각 노드가 children 을
 * 들고 있지 배열이 부모를 안 들고 있으므로(FBX 의 OO 커넥션과 달리) 역으로 훑어
 * parentOf 맵을 만든다.
 */
export function buildNodeIndex(json) {
  const parentOf = new Map();
  json.nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parentOf.set(c, i);
  });
  return { nodes: json.nodes, parentOf };
}

/** 노드 하나의 로컬 TRS(있으면 애니메이션 오버라이드로 덮은 값)로 로컬 행렬을 만든다. */
function localMatrix(node, trsOverride) {
  const t = trsOverride?.t ?? node.translation ?? [0, 0, 0];
  const r = trsOverride?.r ?? node.rotation ?? [0, 0, 0, 1];
  const s = trsOverride?.s ?? node.scale ?? [1, 1, 1];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t[0], t[1], t[2]),
    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
}

/**
 * 노드 nodeIndex 의 전역(월드) 행렬. overrides 는 nodeIndex -> {t,r,s} 맵으로,
 * 있는 노드만 애니메이션 값을 쓰고 없으면 바인드(정지) TRS 를 쓴다.
 */
export function globalMatrix(nodeIndex, nodeIdx, overrides, cache = new Map()) {
  if (cache.has(nodeIndex)) return cache.get(nodeIndex);
  const node = nodeIdx.nodes[nodeIndex];
  const local = localMatrix(node, overrides?.get(nodeIndex));
  const parentId = nodeIdx.parentOf.get(nodeIndex);
  const g =
    parentId === undefined
      ? local
      : globalMatrix(parentId, nodeIdx, overrides, cache).clone().multiply(local);
  cache.set(nodeIndex, g);
  return g;
}

// ---------- 애니메이션 ----------

/** 채널 하나(sampler)를 시간 t 에서 평가한다 — LINEAR 보간, T/S 는 lerp, R 은 slerp. */
function evalSampler(json, bin, sampler, t, path) {
  const times = readAccessorFloat(json, bin, sampler.input);
  const values = readAccessorFloat(json, bin, sampler.output);
  const nc = path === 'rotation' ? 4 : 3;
  if (t <= times[0]) return values.slice(0, nc);
  const last = times.length - 1;
  if (t >= times[last]) return values.slice(last * nc, last * nc + nc);
  let i = 1;
  while (times[i] < t) i++;
  const t0 = times[i - 1];
  const t1 = times[i];
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const a = values.slice((i - 1) * nc, (i - 1) * nc + nc);
  const b = values.slice(i * nc, i * nc + nc);
  if (path === 'rotation') {
    const qa = new THREE.Quaternion(a[0], a[1], a[2], a[3]);
    const qb = new THREE.Quaternion(b[0], b[1], b[2], b[3]);
    qa.slerp(qb, f);
    return [qa.x, qa.y, qa.z, qa.w];
  }
  const out = new Array(nc);
  for (let k = 0; k < nc; k++) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

/**
 * animation 하나를 시각 t 에서 평가해 nodeIndex -> {t,r,s} 오버라이드 맵을 만든다.
 * (경로별로 값이 없는 채널은 그 노드의 바인드 TRS 를 그대로 쓰도록 비워 둔다 —
 * globalMatrix() 의 localMatrix() 가 이미 그렇게 폴백한다.)
 */
export function evaluateAnimation(json, bin, animation, t) {
  const overrides = new Map();
  for (const ch of animation.channels) {
    const sampler = animation.samplers[ch.sampler];
    const value = evalSampler(json, bin, sampler, t, ch.target.path);
    let entry = overrides.get(ch.target.node);
    if (!entry) {
      entry = {};
      overrides.set(ch.target.node, entry);
    }
    if (ch.target.path === 'translation') entry.t = value;
    else if (ch.target.path === 'rotation') entry.r = value;
    else if (ch.target.path === 'scale') entry.s = value;
  }
  return overrides;
}

/** animation 의 길이(초) — 채널들의 keyframe 중 가장 늦은 시각. */
export function animationDuration(json, bin, animation) {
  let dur = 0;
  for (const s of animation.samplers) {
    const times = readAccessorFloat(json, bin, s.input);
    dur = Math.max(dur, times[times.length - 1] ?? 0);
  }
  return dur;
}

// ---------- 스킨 ----------

/**
 * 정점 하나를 스킨한다. jointMatrices 는 이미 boneGlobal * inverseBind 까지 곱해
 * 둔 THREE.Matrix4 배열(스킨의 joints 배열과 같은 순서). glTF 표준 LBS 공식대로,
 * 먼저 로컬 정점을 meshGlobal 로 옮긴 뒤(v1) 그 결과에 각 조인트 행렬을 가중
 * 평균한다 — three.js SkinnedMesh 가 bindMatrix=meshGlobal(바인드 시점) 로 계산하는
 * 것과 동일한 결과가 나옴을 직접 유도해 확인했다(report 참고): bindMatrix 와
 * bindMatrixInverse 가 서로 상쇄되어 최종식은
 *   final = Σ w_i · (boneGlobal_i · inverseBind_i) · (meshGlobal · localVertex)
 * 로 정리된다 — meshGlobal 을 조인트 쪽에서 다시 나눌 필요가 없다.
 */
export function skinVertex(v1, joints, weights, jointMatrices) {
  let x = 0, y = 0, z = 0, wsum = 0;
  for (let k = 0; k < 4; k++) {
    const w = weights[k];
    if (w <= 0) continue;
    const m = jointMatrices[joints[k]];
    const p = v1.clone().applyMatrix4(m);
    x += p.x * w; y += p.y * w; z += p.z * w;
    wsum += w;
  }
  if (wsum < 1e-8) return v1.clone();
  return new THREE.Vector3(x / wsum, y / wsum, z / wsum);
}

// ---------- PNG(RGBA8) 디코더 ----------

import { inflateSync } from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 최소 PNG 디코더 — RGBA8(colorType 6, bitDepth 8) 전용이다. 굽는 세 glTF 파일 중
 * squid 하나만 텍스처를 쓰고, 그 텍스처가 이 형식이라(직접 덤프해 확인했다) 다른
 * colorType/bitDepth 는 지원하지 않는다(만나면 에러로 멈춘다 — 조용히 잘못된 색을
 * 굽지 않는다). 압축 해제는 Node 내장 zlib(PNG IDAT 은 zlib 스트림)를 쓰고, 필터
 * 복원(paeth 포함)만 직접 구현한다 — PNG 규격 자체가 그 정도로 단순하다.
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 시그니처가 아니다');
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatParts = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 8 + len + 4;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`지원 안 하는 PNG 형식 bitDepth=${bitDepth} colorType=${colorType} (RGBA8 만 지원)`);
  }
  const raw = inflateSync(Buffer.concat(idatParts));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw[src + x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      out[y * stride + x] = v;
    }
  }
  return { width, height, data: out };
}

/** 텍스처 하나를 UV 로 쌍선형 샘플링한다(CLAMP). 결과는 0..1 RGBA. */
export function sampleBilinear(tex, u, v) {
  const { width, height, data } = tex;
  const x = Math.min(Math.max(u, 0), 1) * (width - 1);
  const y = Math.min(Math.max(1 - v, 0), 1) * (height - 1); // glTF 는 v=0 이 위쪽
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0, fy = y - y0;
  const at = (xx, yy, c) => data[(yy * width + xx) * 4 + c] / 255;
  const lerp = (a, b, f) => a + (b - a) * f;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = lerp(at(x0, y0, c), at(x1, y0, c), fx);
    const bot = lerp(at(x0, y1, c), at(x1, y1, c), fx);
    out[c] = lerp(top, bot, fy);
  }
  return out;
}
