// FBX 미리보기 렌더러.  실행: node tools/fbx-preview.mjs <파일...>
//
// 왜 이런 게 필요한가: 외부 3D 에셋(Quaternius 등)이 이 게임 화풍에 맞는지 보려면
// 일단 눈으로 봐야 하는데, 이 환경에 Blender 가 없다. 무거운 도구를 깔지 않고
// **실루엣과 비율만** 확인하려는 것이므로 정면 직교 투영 + 플랫 셰이딩이면 충분하다.
//
// 하는 일: FBX(바이너리) 에서 메시 정점·폴리곤만 꺼내 정면에서 직교 투영하고,
// 면 법선으로 플랫 셰이딩해 PNG 로 굽는다. 재질·텍스처·스킨은 읽지 않는다 —
// 실루엣 판단에 필요 없고, 읽으려면 파서가 몇 배로 커진다.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

// ---------- FBX 바이너리 파서 ----------
//
// 구조: 27바이트 헤더 뒤로 노드가 이어진다. 노드 하나는
//   EndOffset, NumProperties, PropertyListLen, NameLen, Name, 속성들, 자식들, 널레코드
// 7500 이상 버전은 오프셋 필드가 32비트가 아니라 64비트다 — 이걸 놓치면 통째로 어긋난다.

function parseFbx(buf) {
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500;
  const readOff = (p) => (wide ? Number(buf.readBigUInt64LE(p)) : buf.readUInt32LE(p));
  const offSize = wide ? 8 : 4;

  function readArray(p, type) {
    const len = buf.readUInt32LE(p);
    const encoding = buf.readUInt32LE(p + 4);
    const compLen = buf.readUInt32LE(p + 8);
    let data = buf.slice(p + 12, p + 12 + compLen);
    if (encoding === 1) data = inflateSync(data);
    const out = [];
    const step = type === 'd' ? 8 : 4;
    for (let i = 0; i < len; i++) {
      const o = i * step;
      if (type === 'd') out.push(data.readDoubleLE(o));
      else if (type === 'f') out.push(data.readFloatLE(o));
      else if (type === 'i') out.push(data.readInt32LE(o));
      else if (type === 'l') out.push(Number(data.readBigInt64LE(i * 8)));
    }
    return { value: out, next: p + 12 + compLen };
  }

  function readProperty(p) {
    const code = String.fromCharCode(buf[p]);
    p += 1;
    switch (code) {
      case 'Y': return { value: buf.readInt16LE(p), next: p + 2 };
      case 'C': return { value: buf[p] !== 0, next: p + 1 };
      case 'I': return { value: buf.readInt32LE(p), next: p + 4 };
      case 'F': return { value: buf.readFloatLE(p), next: p + 4 };
      case 'D': return { value: buf.readDoubleLE(p), next: p + 8 };
      case 'L': return { value: Number(buf.readBigInt64LE(p)), next: p + 8 };
      case 'f': case 'd': case 'l': case 'i': case 'b':
        return readArray(p, code);
      case 'S': case 'R': {
        const len = buf.readUInt32LE(p);
        const v = code === 'S' ? buf.toString('utf8', p + 4, p + 4 + len) : buf.slice(p + 4, p + 4 + len);
        return { value: v, next: p + 4 + len };
      }
      default:
        throw new Error(`unknown property code ${code}`);
    }
  }

  function readNode(p) {
    const end = readOff(p);
    const numProps = readOff(p + offSize);
    const nameLen = buf[p + offSize * 3];
    // 널 레코드 = 이 계층의 끝
    if (end === 0) return { node: null, next: p + offSize * 3 + 1 };
    const name = buf.toString('utf8', p + offSize * 3 + 1, p + offSize * 3 + 1 + nameLen);
    let q = p + offSize * 3 + 1 + nameLen;
    const props = [];
    for (let i = 0; i < numProps; i++) {
      const r = readProperty(q);
      props.push(r.value);
      q = r.next;
    }
    const children = [];
    while (q < end - 13) {
      const r = readNode(q);
      if (!r.node) { q = r.next; break; }
      children.push(r.node);
      q = r.next;
    }
    return { node: { name, props, children }, next: end };
  }

  const nodes = [];
  let p = 27;
  while (p < buf.length - 20) {
    const r = readNode(p);
    if (!r.node) break;
    nodes.push(r.node);
    p = r.next;
  }
  return nodes;
}

/** 트리에서 이름이 같은 노드를 전부 모은다 */
function findAll(nodes, name, out = []) {
  for (const n of nodes) {
    if (n.name === name) out.push(n);
    findAll(n.children, name, out);
  }
  return out;
}

function child(node, name) {
  return node.children.find((c) => c.name === name);
}

// ---------- 최소 PNG 인코더 ----------
//
// 캔버스도 이미지 라이브러리도 없으므로 직접 쓴다.
// PNG 는 필터 바이트가 앞에 붙은 스캔라인을 zlib 으로 압축한 것이라 이 정도면 된다.

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // 필터 없음
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ---------- 렌더 ----------

/**
 * 정면(+Z 를 보는) 직교 투영으로 플랫 셰이딩 렌더.
 *
 * z-버퍼를 쓴다. 폴리곤을 그냥 순서대로 칠하면 뒤통수가 얼굴 위에 덮인다.
 */
function render(meshes, W, H, opts = {}) {
  /**
   * 어느 축이 위인가.
   *
   * FBX 는 Y-up 이 표준이지만 Blender 에서 내보낸 것은 Z-up 인 경우가 많다.
   * 틀리면 인물을 정수리에서 내려다본 그림이 나온다 (팔이 좌우로 뻗은 T 자).
   * `up` 은 화면 세로로 쓸 축, `depth` 는 카메라 방향 축이다.
   */
  const zUp = opts.up !== 'y';
  /**
   * 카메라가 보는 쪽.
   *
   * Blender 로 만든 인물은 보통 -Y 를 향한다. 그대로 +Y 쪽에서 보면 뒤통수만 나온다.
   * 깊이 축의 부호를 뒤집어 앞에서 보게 한다 (`--back` 이면 그대로 뒤에서 본다).
   */
  const face = opts.back ? 1 : -1;
  const hor = (v, i) => v[i] * (opts.back ? -1 : 1); // 뒤에서 보면 좌우도 뒤집힌다
  const ver = (v, i) => (zUp ? v[i + 2] : v[i + 1]);
  const dep = (v, i) => (zUp ? v[i + 1] : v[i + 2]) * face;

  const rgba = Buffer.alloc(W * H * 4);
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const bg = opts.bg ?? [12, 34, 48];
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }

  // 전체 바운딩 박스로 화면에 맞춘다 (부위별로 따로 맞추면 서로 크기가 안 맞는다)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of meshes) {
    for (let i = 0; i < m.verts.length; i += 3) {
      const x = hor(m.verts, i);
      const y = ver(m.verts, i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const pad = 0.06;
  const scale = Math.min((W * (1 - pad * 2)) / (maxX - minX), (H * (1 - pad * 2)) / (maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // FBX 는 Y 가 위. 화면은 아래로 증가하므로 뒤집는다.
  const proj = (x, y) => [W / 2 + (x - cx) * scale, H / 2 - (y - cy) * scale];

  const light = [-0.4, 0.7, 0.6];
  const ll = Math.hypot(...light);

  for (const m of meshes) {
    for (const tri of m.tris) {
      // [화면가로, 화면세로, 깊이] 로 정규화해서 이후 계산은 축을 신경 쓰지 않게 한다
      const p = [0, 1, 2].map((k) => {
        const i = tri[k] * 3;
        return [hor(m.verts, i), ver(m.verts, i), dep(m.verts, i)];
      });
      // 면 법선
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...n) || 1;
      const lambert = Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / (nl * ll));
      const shade = 0.25 + lambert * 0.75;
      const col = (m.color ?? [200, 205, 210]).map((c) => Math.min(255, c * shade));

      const s = p.map(([x, y]) => proj(x, y));
      const zs = p.map(([, , z]) => z);
      const bx0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
      const bx1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const by0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
      const by1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
      if (Math.abs(area) < 1e-9) continue;

      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
          const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          // 카메라는 +Z 쪽에 있다 — z 가 클수록 앞
          const z = -(w0 * zs[0] + w1 * zs[1] + w2 * zs[2]);
          const idx = y * W + x;
          if (z >= zbuf[idx]) continue;
          zbuf[idx] = z;
          rgba[idx * 4] = col[0];
          rgba[idx * 4 + 1] = col[1];
          rgba[idx * 4 + 2] = col[2];
          rgba[idx * 4 + 3] = 255;
        }
      }
    }
  }
  return rgba;
}

/** Geometry 노드에서 정점과 삼각형을 꺼낸다 */
function meshesOf(fbxNodes) {
  const out = [];
  for (const g of findAll(fbxNodes, 'Geometry')) {
    const vs = child(g, 'Vertices');
    const pi = child(g, 'PolygonVertexIndex');
    if (!vs || !pi) continue;
    const verts = vs.props[0];
    const idx = pi.props[0];
    // FBX 폴리곤: 마지막 인덱스가 음수(~i)로 표시되어 면의 끝을 알린다. n각형은 부채꼴로 쪼갠다.
    const tris = [];
    let face = [];
    for (const raw of idx) {
      const last = raw < 0;
      face.push(last ? ~raw : raw);
      if (last) {
        for (let k = 1; k + 1 < face.length; k++) tris.push([face[0], face[k], face[k + 1]]);
        face = [];
      }
    }
    out.push({ verts, tris });
  }
  return out;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node tools/fbx-preview.mjs <file.fbx>...');
  process.exit(1);
}

// 부위별로 색을 달리해 어디가 어느 조각인지 보이게 한다
const PART_COLOR = {
  head: [232, 200, 170],
  body: [235, 240, 245],
  legs: [120, 170, 200],
  feet: [200, 130, 70],
};

const all = [];
for (const f of files) {
  const nodes = parseFbx(readFileSync(f));
  const ms = meshesOf(nodes);
  const key = Object.keys(PART_COLOR).find((k) => basename(f).toLowerCase().includes(k));
  for (const m of ms) m.color = PART_COLOR[key] ?? [200, 205, 210];
  all.push(...ms);
  console.log(`${basename(f)}: ${ms.length} mesh, ${ms.reduce((s, m) => s + m.tris.length, 0)} tri`);
}

const W = 480;
const H = 800;
writePng('fbx-preview.png', W, H, render(all, W, H));
console.log(`wrote fbx-preview.png (${W}x${H})`);
