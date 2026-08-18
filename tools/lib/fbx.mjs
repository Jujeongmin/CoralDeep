// FBX 읽기 + 소프트웨어 렌더 + PNG 쓰기.
//
// 이 환경에는 Blender 도 이미지 라이브러리도 없다. 외부 3D 에셋을 2D 스프라이트로 굽는 데
// 필요한 최소한만 직접 구현한다: 메시 기하만 읽고, 정면 직교 투영으로 플랫 셰이딩하고,
// PNG 로 쓴다. 재질·텍스처·스킨은 읽지 않는다 — 스프라이트로 구울 때 필요 없고,
// 읽으려면 파서가 몇 배로 커진다.

import { writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

// ---------- FBX 바이너리 파서 ----------
//
// 구조: 27바이트 헤더 뒤로 노드가 이어진다. 노드 하나는
//   EndOffset, NumProperties, PropertyListLen, NameLen, Name, 속성들, 자식들, 널레코드
// 7500 이상 버전은 오프셋 필드가 32비트가 아니라 64비트다 — 놓치면 통째로 어긋난다.

export function parseFbx(buf) {
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
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      if (type === 'd') out[i] = data.readDoubleLE(i * 8);
      else if (type === 'f') out[i] = data.readFloatLE(i * 4);
      else if (type === 'i') out[i] = data.readInt32LE(i * 4);
      else if (type === 'l') out[i] = Number(data.readBigInt64LE(i * 8));
      else out[i] = data[i];
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
        throw new Error(`unknown FBX property code ${code}`);
    }
  }

  function readNode(p) {
    const end = readOff(p);
    const numProps = readOff(p + offSize);
    const nameLen = buf[p + offSize * 3];
    if (end === 0) return { node: null, next: p + offSize * 3 + 1 }; // 널 레코드 = 계층 끝
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

function findAll(nodes, name, out = []) {
  for (const n of nodes) {
    if (n.name === name) out.push(n);
    findAll(n.children, name, out);
  }
  return out;
}

/**
 * Geometry 노드에서 정점과 삼각형을 꺼낸다.
 *
 * FBX 폴리곤 인덱스는 면의 **마지막** 인덱스를 음수(~i)로 표시해 면의 끝을 알린다.
 * n각형은 부채꼴로 쪼갠다.
 */
export function meshesOf(fbxNodes) {
  const out = [];
  for (const g of findAll(fbxNodes, 'Geometry')) {
    const vs = g.children.find((c) => c.name === 'Vertices');
    const pi = g.children.find((c) => c.name === 'PolygonVertexIndex');
    if (!vs || !pi) continue;
    const verts = vs.props[0];
    const tris = [];
    let face = [];
    for (const raw of pi.props[0]) {
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

// ---------- 최소 PNG 인코더 ----------

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

export function writePng(path, w, h, rgba) {
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
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ---------- 좌표계 ----------

/**
 * 모델 좌표를 [화면가로, 화면세로, 깊이] 로 바꾼다.
 *
 * FBX 표준은 Y-up 이지만 Blender 로 내보낸 것은 Z-up 인 경우가 많다. 틀리면 인물을
 * 정수리에서 내려다본 그림(팔이 좌우로 뻗은 T 자)이 나온다.
 * 또 Blender 인물은 보통 **-Y 를 향해** 서 있어서, 그대로 보면 뒤통수만 나온다.
 */
export function axisMapper({ up = 'z', back = false } = {}) {
  const zUp = up !== 'y';
  const s = back ? 1 : -1;
  return (v, i) => [
    v[i] * (back ? -1 : 1),
    zUp ? v[i + 2] : v[i + 1],
    (zUp ? v[i + 1] : v[i + 2]) * s,
  ];
}

/** 정점 배열 전체의 [가로, 세로, 깊이] 범위 */
export function boundsOf(meshes, map) {
  const b = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  for (const m of meshes) {
    for (let i = 0; i < m.verts.length; i += 3) {
      const [x, y, z] = map(m.verts, i);
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    }
  }
  return b;
}

// ---------- 렌더 ----------

/**
 * 정면 직교 투영 + 플랫 셰이딩.
 *
 * z-버퍼를 쓴다. 폴리곤을 순서대로 칠하면 뒤통수가 얼굴 위에 덮인다.
 * `project(x, y)` 가 모델 좌표를 화면 픽셀로 옮긴다 — 호출부가 넘겨줘야
 * 부위를 따로 그려도 서로 크기·위치가 어긋나지 않는다.
 */
export function render(
  meshes,
  W,
  H,
  {
    map,
    project,
    bg = null,
    light = [-0.45, 0.6, 0.65],
    /**
     * 아래에서 되받아 올라오는 물빛.
     *
     * 키 라이트 하나만 쓰면 그늘진 면이 그냥 어두운 회색이 되어 심해 배경 위에서
     * 구멍처럼 뚫려 보인다. 이 게임의 타일·곰치·아이콘은 전부 바닥에 물빛 림라이트를
     * 깔아 물속에 뜬 덩어리로 읽히게 했다 — 잠수부도 같은 빛을 받아야 한 화면에 선다.
     */
    fill = [0.2, -0.85, 0.4],
    fillColor = [110, 190, 235],
    fillStrength = 0.42,
  },
) {
  const rgba = Buffer.alloc(W * H * 4);
  if (bg) {
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
    }
  }
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const ll = Math.hypot(...light);
  const fl = Math.hypot(...fill);

  for (const m of meshes) {
    for (const tri of m.tris) {
      const p = tri.map((vi) => map(m.verts, vi * 3));
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...n) || 1;
      const lambert = Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / (nl * ll));
      const rim = Math.max(0, (n[0] * fill[0] + n[1] * fill[1] + n[2] * fill[2]) / (nl * fl));
      // 완전 검정은 만들지 않는다 — 심해 배경 위에서 구멍처럼 보인다
      const shade = 0.34 + lambert * 0.72;
      const base = m.color ?? [200, 205, 210];
      // 아래를 향한 면일수록 물빛이 얹힌다
      const col = base.map((c, i) =>
        Math.min(255, c * shade + fillColor[i] * rim * fillStrength),
      );

      const s = p.map(([x, y]) => project(x, y));
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
          // 카메라는 깊이 +∞ 쪽 — 깊이가 클수록 앞이다
          const z = -(w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2]);
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
