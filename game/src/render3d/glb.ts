// 우리가 구운 glb 만 읽는 최소 파서.
//
// three 의 GLTFLoader 를 쓰지 않는 이유는 크기다. 로더는 스킨·애니메이션·재질·확장
// 규격을 전부 다루느라 three 본체에 맞먹게 크다. 우리 파일은 메시 하나에 위치·법선·
// 버텍스 컬러뿐이고, 그 구조는 굽는 도구가 보장한다.

export interface GlbMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
}

export function parseGlb(buf: ArrayBuffer): GlbMesh {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glb 가 아니다');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;

  const read = (accessorIndex: number): Float32Array | Uint32Array => {
    const acc = json.accessors[accessorIndex];
    const bv = json.bufferViews[acc.bufferView];
    const off = binStart + (bv.byteOffset ?? 0);
    const n = acc.count * (acc.type === 'SCALAR' ? 1 : 3);
    return acc.componentType === 5126
      ? new Float32Array(buf.slice(off, off + n * 4))
      : new Uint32Array(buf.slice(off, off + n * 4));
  };

  const prim = json.meshes[0].primitives[0];
  return {
    position: read(prim.attributes.POSITION) as Float32Array,
    normal: read(prim.attributes.NORMAL) as Float32Array,
    color: read(prim.attributes.COLOR_0) as Float32Array,
    index: read(prim.indices) as Uint32Array,
  };
}
