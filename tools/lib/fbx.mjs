// FBX 바이너리 파서 + 메시 추출.
//
// 이 환경에는 Blender 가 없다. 외부 3D 에셋을 굽는 도구들이 공유하는 최소 FBX 리더다:
// 메시 기하만 읽는다 — 재질·텍스처·스킨은 여기서 필요 없고, 읽으려면 파서가 몇 배로
// 커진다(스킨이 필요한 도구는 fbxSkin.mjs 가 이 파서 위에 따로 얹는다).
//
// (한때 여기 정면 직교 투영 소프트웨어 렌더러 + PNG 인코더도 있었다 — 잠수부를
// PNG 스프라이트로 굽던 bake-diver-3d.mjs 전용이었는데, 그 도구가 glb 굽기
// [bake-diver-glb.mjs]로 대체되며 지웠다. 남은 소비자가 없었다.)

import { inflateSync } from 'node:zlib';

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
