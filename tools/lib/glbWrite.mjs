// 우리 런타임(game/src/render3d/glb.ts)이 읽는 최소 glb 를 쓴다.
//
// bake-diver-glb.mjs 가 처음 이 형식을 만들었다. 이제 bake-predators-glb.mjs 도
// 같은 형식(position/normal/color/index + 선택적 정점 애니메이션 델타)을 굽게 되면서,
// 두 도구가 각자 파일 쓰기 코드를 들고 있으면 형식이 슬쩍 갈라지기 쉽다 — 여기 하나로
// 모아 둔다.
//
// extras 필드 이름은 diverAnim 이 아니라 bakedAnim 이다 — 잠수부 전용이 아니라 이
// 포맷을 쓰는 모두(잠수부·아귀·고블린상어)의 공용 필드이기 때문이다. glb.ts 쪽도
// 같은 이름으로 읽는다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const pad4 = (n) => (n + 3) & ~3;

/**
 * @param outPath 쓸 경로
 * @param position/normal/color Float32Array (정점 수 * 3)
 * @param index Uint32Array
 * @param anim null 이면 애니메이션 없음. 있으면
 *   { frameCount, scale:[sx,sy,sz], deltaInt16, loopSeconds? }.
 *   loopSeconds 는 선택 — 원본 클립이 자연스러운 루프 길이(초)를 알려줄 때만 채운다
 *   (예: 물고기의 Swimming_Normal). 잠수부처럼 일부러 원본보다 훨씬 느리게 트는
 *   경우는 호출부(diver.ts)가 자기만의 상수를 쓰므로 안 채워도 된다.
 * @returns anim 이 있으면 그 델타 바이트 수(로그용), 없으면 0.
 */
export function writeGlb(outPath, { position, normal, color, index, anim }) {
  const parts = [
    Buffer.from(position.buffer, position.byteOffset, position.byteLength),
    Buffer.from(normal.buffer, normal.byteOffset, normal.byteLength),
    Buffer.from(color.buffer, color.byteOffset, color.byteLength),
    Buffer.from(index.buffer, index.byteOffset, index.byteLength),
  ];
  let deltaBuf = null;
  if (anim) {
    deltaBuf = Buffer.from(anim.deltaInt16.buffer, anim.deltaInt16.byteOffset, anim.deltaInt16.byteLength);
    parts.push(deltaBuf);
  }
  const bin = Buffer.concat(parts);

  const offs = {
    pos: 0,
    nrm: position.byteLength,
    col: position.byteLength + normal.byteLength,
    idx: position.byteLength + normal.byteLength + color.byteLength,
    anim: position.byteLength + normal.byteLength + color.byteLength + index.byteLength,
  };

  const bufferViews = [
    { buffer: 0, byteOffset: offs.pos, byteLength: position.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offs.nrm, byteLength: normal.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offs.col, byteLength: color.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offs.idx, byteLength: index.byteLength, target: 34963 },
  ];
  if (anim) bufferViews.push({ buffer: 0, byteOffset: offs.anim, byteLength: deltaBuf.length });

  const json = {
    asset: { version: '2.0', generator: 'coral-deep bake' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: position.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: normal.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: color.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: index.length, type: 'SCALAR' },
    ],
  };
  if (anim) {
    json.extras = {
      bakedAnim: {
        // 프레임 0 은 POSITION(accessor 0) 그대로다. 프레임 1..frameCount-1 은
        // POSITION 대비 델타를 축마다 대칭 스케일로 양자화한 Int16 다:
        //   delta[axis] = int16 * scale[axis]
        // deltasBufferView 안 레이아웃은 [frame][vertex][xyz] — glb.ts 참고.
        frameCount: anim.frameCount,
        scale: anim.scale,
        deltasBufferView: 4,
        ...(anim.loopSeconds !== undefined ? { loopSeconds: anim.loopSeconds } : {}),
      },
    };
  }

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
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([head, jsonHead, jsonBuf, jsonPad, binHead, bin, binPad]));
  return deltaBuf ? deltaBuf.length : 0;
}
