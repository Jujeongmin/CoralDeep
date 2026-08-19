// 우리가 구운 glb 만 읽는 최소 파서.
//
// three 의 GLTFLoader 를 쓰지 않는 이유는 크기다. 로더는 스킨·애니메이션·재질·확장
// 규격을 전부 다루느라 three 본체에 맞먹게 크다. 우리 파일은 메시 하나에 위치·법선·
// 버텍스 컬러뿐이고, 그 구조는 굽는 도구가 보장한다.
//
// diver.glb·anglerfish.glb·goblinShark.glb 는 여기에 애니메이션 프레임도 얹는다
// (tools/bake-diver-glb.mjs·tools/bake-predators-glb.mjs 가 스킨 클립을 몇 프레임
// CPU 로 스키닝해 구운 것) - 하지만 glTF 정식 애니메이션 규격(스켈레톤, 채널,
// 보간기)이 아니라 우리만의 커스텀 필드다. 그러면 이 파서가 GLTFLoader 급으로
// 커질 이유가 없다: extras.bakedAnim 에 프레임 수·양자화 스케일·델타 데이터의
// bufferView 번호만 있고, 그 델타를 어떻게 보간해 재생할지는 호출부(diver.ts /
// predators.ts)가 정한다. 필드 이름이 diverAnim 이 아니라 bakedAnim 인 이유도
// 같다 — 잠수부 전용이 아니라 이 포맷을 쓰는 모두의 공용 필드다.
//
// diver.glb 는 클립을 두 개(Idle·Walk) 갖고 있어 extras.bakedAnim(단수) 하나로는
// 못 담는다 — 그래서 extras.bakedAnims(복수, 클립 배열)를 추가로 읽는다. 두 필드는
// 서로 배타적으로 쓰인다(굽는 도구가 어느 하나만 쓴다) - bakedAnim(단수) 쪽 파싱은
// 한 글자도 안 바꿨으므로 물고기 쪽(단일 클립) glb·파서 동작은 그대로다.

export interface GlbMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  /** 없으면(구버전 glb 등) 애니메이션 없이 정지 포즈로 그린다. */
  anim: GlbAnim | null;
  /**
   * 이름 붙은 클립이 둘 이상인 메시(잠수부 — Idle·Walk)만 채워진다. extras 의
   * `bakedAnims`(복수형) 필드에서 읽는다 — `bakedAnim`(단수, 위 anim 필드)과는
   * 서로 다른 필드라 기존 단일 클립 메시(아귀·고블린상어)는 전혀 안 건드린다.
   * 둘 다 프레임 0(POSITION 그대로)을 공유 기준 자세로 삼는다 — 클립마다 델타를
   * 담을 bufferView 만 따로 갖는다.
   */
  anims: (GlbAnim & { name: string })[] | null;
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
  /**
   * 원본 클립의 자연스러운 루프 길이(초) — 있으면 굽는 도구가 알려준 값이다
   * (물고기의 Swimming_Normal 처럼 "원래 이 속도로 도는 게 자연스럽다"인 클립).
   * 없으면(잠수부처럼 호출부가 일부러 다른 속도로 트는 경우) 호출부가 자기 상수를 쓴다.
   */
  loopSeconds?: number;
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
  const vertexCount = position.length / 3;

  interface ClipJson {
    frameCount: number;
    scale: readonly [number, number, number];
    deltasBufferView: number;
    loopSeconds?: number;
  }
  // clipJson 은 { frameCount, scale, deltasBufferView, loopSeconds? } 모양 —
  // bakedAnim(단수)과 bakedAnims(복수) 배열의 원소가 같은 모양을 쓴다(복수 쪽은
  // 여기에 name 이 하나 더 있다 - decodeClip 은 그 이름을 몰라도 된다).
  const decodeClip = (clipJson: ClipJson): GlbAnim => {
    const bv = json.bufferViews[clipJson.deltasBufferView];
    const off = binStart + (bv.byteOffset ?? 0);
    const deltaCount = (clipJson.frameCount - 1) * vertexCount * 3;
    return {
      frameCount: clipJson.frameCount,
      scale: clipJson.scale,
      deltas: new Int16Array(buf.slice(off, off + deltaCount * 2)),
      ...(clipJson.loopSeconds !== undefined ? { loopSeconds: clipJson.loopSeconds } : {}),
    };
  };

  let anim: GlbAnim | null = null;
  const bakedAnim = json.extras?.bakedAnim;
  if (bakedAnim) anim = decodeClip(bakedAnim);

  let anims: (GlbAnim & { name: string })[] | null = null;
  const bakedAnims = json.extras?.bakedAnims;
  if (bakedAnims) {
    anims = bakedAnims.map((clipJson: ClipJson & { name: string }) => ({
      name: clipJson.name,
      ...decodeClip(clipJson),
    }));
  }

  return {
    position,
    normal: read(prim.attributes.NORMAL) as Float32Array,
    color: read(prim.attributes.COLOR_0) as Float32Array,
    index: read(prim.indices) as Uint32Array,
    anim,
    anims,
  };
}
