// 정점 애니메이션 프레임 재생 — diver.ts 가 먼저 만든 방식(스키닝을 오프라인에서
// 미리 계산해 몇 프레임을 굽고, 런타임은 그 사이를 보간만 한다)을 predators.ts(아귀·
// 고블린상어)도 그대로 쓴다. 두 파일이 각자 이 로직을 복사해 들면 스킴이 슬쩍
// 갈라지기 쉬워서 여기 하나로 모은다.

import type { GlbAnim } from './glb.ts';

/**
 * anim.deltas(Int16, 축마다 대칭 양자화)를 프레임별 Float32Array 로 풀어 둔다.
 * frames[0] 은 position 자체(복사본)고, frames[1..frameCount-1] 은
 * position + delta*scale 이다 - 굽는 도구가 쓰는 것과 같은 dequant 식이다.
 * 매 프레임 정수->실수 변환을 반복하지 않으려고 로드 시점에 한 번만 푼다.
 */
export function unpackAnimFrames(position: Float32Array, anim: GlbAnim): Float32Array[] {
  const [sx, sy, sz] = anim.scale;
  const vertexCount = position.length / 3;
  const frames: Float32Array[] = [position.slice()];
  for (let f = 1; f < anim.frameCount; f++) {
    const frame = new Float32Array(position.length);
    const base = (f - 1) * vertexCount * 3;
    for (let vi = 0; vi < vertexCount; vi++) {
      const o = vi * 3;
      frame[o] = position[o] + anim.deltas[base + o] * sx;
      frame[o + 1] = position[o + 1] + anim.deltas[base + o + 1] * sy;
      frame[o + 2] = position[o + 2] + anim.deltas[base + o + 2] * sz;
    }
    frames.push(frame);
  }
  return frames;
}

/**
 * phase01(0..1, 루프 안에서 어디인가)에서 두 프레임을 선형보간해 out 에 덮어쓴다.
 * out 은 매 프레임 새로 만들지 않고 호출부가 들고 있는 버퍼를 그대로 넘긴다
 * (지오메트리 속성 버퍼를 제자리에서 덮어써야 하므로 - 파일 상단 "no per-frame
 * allocation" 규칙).
 */
export function sampleAnimFrame(frames: Float32Array[], phase01: number, out: Float32Array): void {
  const frameCount = frames.length;
  const scaled = phase01 * frameCount;
  const i0 = Math.floor(scaled) % frameCount;
  const i1 = (i0 + 1) % frameCount;
  const frac = scaled - Math.floor(scaled);
  const a = frames[i0];
  const b = frames[i1];
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * frac;
}
