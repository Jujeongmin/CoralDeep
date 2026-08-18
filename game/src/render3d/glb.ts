// 우리가 구운 glb 만 읽는 최소 파서.
//
// three 의 GLTFLoader 를 쓰지 않는 이유는 크기다. 로더는 스킨·애니메이션·재질·확장
// 규격을 전부 다루느라 three 본체에 맞먹게 크다. 우리 파일은 메시 하나에 위치·법선·
// 버텍스 컬러뿐이고, 그 구조는 굽는 도구가 보장한다.
//
// diver.glb 는 여기에 애니메이션 프레임도 얹는다(tools/bake-diver-glb.mjs 가
// Idle 클립을 몇 프레임 스키닝해 구운 것) - 하지만 glTF 정식 애니메이션 규격(스켈레톤,
// 채널, 보간기)이 아니라 우리만의 커스텀 필드다. 그러면 이 파서가 GLTFLoader 급으로
// 커질 이유가 없다: extras.diverAnim 에 프레임 수·양자화 스케일·델타 데이터의
// bufferView 번호만 있고, 그 델타를 어떻게 보간해 재생할지는 diver.ts 가 정한다.

export interface GlbMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  /** 없으면(구버전 glb 등) 애니메이션 없이 정지 포즈로 그린다. */
  anim: GlbAnim | null;
}

export interface GlbAnim {
  /** 프레임 0 은 position 그대로다. 이 값은 프레임 총 개수(0 포함). */
  frameCount: number;
  /**
   * 프레임 1..frameCount-1 의 정점 위치 = position + delta.
   * delta 는 Int16 로 양자화돼 있다 - 축마다 dequant 식은:
   *   delta[axis] = deltasInt16[...] * scale[axis]
   * (bake-diver-glb.mjs 가 축마다 관측된 최대 절댓값 / 32767 로 스케일을 잡았다.
   * 대칭 양자화라 zero-point 보정이 없다.)
   */
  scale: readonly [number, number, number];
  /**
   * 레이아웃은 [frame][vertex][xyz] - frame 은 0-based 지만 실제로는 1번 프레임부터
   * 시작한다(프레임 0 은 델타가 없으므로). 즉 deltas 의 길이는
   * (frameCount - 1) * vertexCount * 3.
   */
  deltas: Int16Array;
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
  const position = read(prim.attributes.POSITION) as Float32Array;

  let anim: GlbAnim | null = null;
  const diverAnim = json.extras?.diverAnim;
  if (diverAnim) {
    const bv = json.bufferViews[diverAnim.deltasBufferView];
    const off = binStart + (bv.byteOffset ?? 0);
    const vertexCount = position.length / 3;
    const deltaCount = (diverAnim.frameCount - 1) * vertexCount * 3;
    anim = {
      frameCount: diverAnim.frameCount,
      scale: diverAnim.scale,
      deltas: new Int16Array(buf.slice(off, off + deltaCount * 2)),
    };
  }

  return {
    position,
    normal: read(prim.attributes.NORMAL) as Float32Array,
    color: read(prim.attributes.COLOR_0) as Float32Array,
    index: read(prim.indices) as Uint32Array,
    anim,
  };
}
