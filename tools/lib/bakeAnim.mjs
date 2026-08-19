// 정점 애니메이션을 굽는 두 굽기 도구(bake-diver-glb.mjs, bake-predators-glb.mjs)가
// 공통으로 쓰는 두 계산 — 평면(flat) 법선과 델타 양자화. 잠수부에서 먼저 만들어져
// 검증된 방식이라(diver.glb 로 실측 확인됨) 물고기 쪽도 그대로 재사용한다 — 다른
// 스킴을 새로 만들지 않는다.

/**
 * 면 법선을 정점에 누적한 뒤 정규화한다 — 저폴리 flatShading 전용(정점을 공유하지
 * 않는 별도 삼각형이면 진짜 flat, 공유하면 그 정점들의 인접 면 평균이 된다).
 *
 * 한 프레임(보통 바인드/기준 자세)에서만 계산해 애니메이션 전 프레임이 공유한다 —
 * 우리 포맷은애초에 법선을 애니메이션하지 않는다(bakedAnim 은 POSITION 델타만
 * 굽는다 — glb.ts/diver.ts 참고). 그림자가 없는 flatShading 렌더링에서는 이
 * 근사가 프레임 사이 미묘한 법선 오차보다 훨씬 싸다.
 */
export function computeFlatNormals(position, index) {
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
 * 델타 프레임들(기준 자세 대비 Float32 변위, 프레임마다 하나씩)을 축마다 대칭
 * 양자화한 Int16 로 압축한다 — 스케일은 그 축에서 관측된 최대 절댓값 / 32767.
 * (delta[axis] = int16 * scale[axis] 로 되돌린다 — glb.ts/diver.ts 의 dequant 식과 같다.)
 */
export function quantizeDeltaFrames(deltaFrames, vertCount) {
  const scale = [0, 0, 0];
  for (const delta of deltaFrames) {
    for (let i = 0; i < delta.length; i += 3) {
      scale[0] = Math.max(scale[0], Math.abs(delta[i]));
      scale[1] = Math.max(scale[1], Math.abs(delta[i + 1]));
      scale[2] = Math.max(scale[2], Math.abs(delta[i + 2]));
    }
  }
  for (let a = 0; a < 3; a++) scale[a] = scale[a] / 32767 || 1; // 그 축이 아예 안 움직이면 0/0 방지용 1

  const deltaInt16 = new Int16Array(deltaFrames.length * vertCount * 3);
  let w = 0;
  for (const delta of deltaFrames) {
    for (let i = 0; i < delta.length; i += 3) {
      deltaInt16[w++] = Math.round(delta[i] / scale[0]);
      deltaInt16[w++] = Math.round(delta[i + 1] / scale[1]);
      deltaInt16[w++] = Math.round(delta[i + 2] / scale[2]);
    }
  }
  return { scale, deltaInt16 };
}
