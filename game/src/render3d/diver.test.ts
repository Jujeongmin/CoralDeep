// 잠수부 검증.
//
// 예전에는 대기 중 흔들림(bob)이 빈 띠(clearBand)를 벗어나지 않는지가 이 파일의
// 핵심이었다 — 사용자 요청으로 그 흔들림 자체를 없앴으므로(diver.ts step() 참고,
// 이제 대기 중엔 완전히 정지한다) 전제가 바뀌었다. 이 파일은 새 현실을 검증한다:
//  1) 흔들림이 없는 정적 크기만으로도 침범 불변식이 성립한다는 것(옛 클램프 여유
//     계산의 자리를 대신한다).
//  2) 접지 위치에 더 이상 안전 여유(reachPx)가 없다는 것 — place() 는 이제
//     anchor 를 그대로 심는다.
//  3) 실제로 구운 diver.glb 를 읽어, 대기 중 유일하게 남은 움직임(Idle 스켈레탈
//     정점 애니메이션)이 발을 얼마나 움직이는지, 그리고 탈출용 Walk 클립이 실제로
//     걷는 동작인지(발이 유의미하게 움직이는지)를 데이터로 확인한다.
//
// diver.ts 는 Diver 클래스가 constructor(private scene: THREE.Scene) 같은 TS
// parameter property 를 써서 npm test 의 Node 내장 strip-only 로더로 못 읽는다
// (depthProjection.ts 상단 주석 참고 — seafloor.ts 와 같은 이유다). glb.ts 와
// bakedAnim.ts 는 순수 함수/평범한 인터페이스라 문제없이 임포트할 수 있다 —
// 실제 구운 파일을 그대로 읽어 검증하는 3번 테스트가 가능한 이유다.

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

import { unpackAnimFrames } from './bakedAnim.ts';
import { depthScale } from './depthProjection.ts';
import { parseGlb } from './glb.ts';
import { planeView, screenToPlane } from './projection.ts';

const CAM_Z = 10;
const FOV = 45;
/** diver.ts 의 HOME_Z */
const HOME_Z = 1.2;
/** diver.ts 의 CELLS_TALL */
const CELLS_TALL = 1.9;
/** stage.ts setBoardRect() 의 대기 크기 클램프 여유 */
const REST_MARGIN = 0.9;

// ---- 1) 흔들림 없는 정적 크기가 빈 띠를 넘지 않는다 ----
//
// stage.ts 는 cellPx = min(r.cell, bandHeightPx*REST_MARGIN/CELLS_TALL) 로 잠수부
// 기준 칸 크기를 정한다. 흔들림이 있던 시절엔 이 위에 bob/tilt 여유를 또 계산해야
// 했지만(옛 maxIdleBobWorld/maxStandingBobWorld), 이제 몸은 완전히 정지하므로
// heightPx = cellPx*CELLS_TALL 이 bandHeightPx 를 넘지 않는 것만으로 침범 불변식이
// 끝난다 — 클램프 공식 자체가 그 상한을 강제한다는 걸 수로 확인한다.
test('정지 상태: 클램프된 대기 크기(cellPx*CELLS_TALL)는 어떤 빈 띠에서도 그 빈 띠를 넘지 않는다', () => {
  for (const [rCell, bandHeightPx] of [
    [40, 600], // 여유로운 빈 띠 -- 클램프가 안 걸리는 경우
    [200, 120], // 빡빡한 빈 띠 -- 클램프가 실제로 걸리는 경우
    [10, 8], // 극단적으로 좁은 빈 띠
  ]) {
    const cellPx = Math.min(rCell, (bandHeightPx * REST_MARGIN) / CELLS_TALL);
    const heightPx = cellPx * CELLS_TALL;
    assert.ok(
      heightPx <= bandHeightPx + 1e-9,
      `heightPx(${heightPx}) 가 bandHeightPx(${bandHeightPx}) 를 넘었다 (rCell=${rCell})`,
    );
  }
});

test('정지 상태: 여유로운 빈 띠에서는 클램프가 안 걸려 r.cell 그대로 쓴다', () => {
  const rCell = 40;
  const bandHeightPx = 600;
  const cellPx = Math.min(rCell, (bandHeightPx * REST_MARGIN) / CELLS_TALL);
  assert.equal(cellPx, rCell);
});

// ---- 2) place() 는 이제 anchor 를 그대로 심는다(추가 여유 없음) ----
//
// 예전엔 접지 상태에서 standingTiltReachPx() 만큼 anchor 보다 위로 몸을 세웠다
// (기울기가 접지선을 파고들지 않게 하는 안전 여유). 기울기 자체가 없어졌으므로
// place() 의 새 공식은 depthScale·screenToPlane 만으로 anchor 를 그대로 옮긴다 —
// 그 공식이 정말 anchor 와 정확히 대응하는지(왕복하면 원래 화면 좌표로 돌아오는지)
// 확인한다.
test('place(): 접지선에 심은 자리를 다시 화면으로 투영하면 원래 anchor 로 돌아온다(추가 여유 없음)', () => {
  const screenW = 400;
  const screenH = 800;
  const view = planeView(screenW, screenH, FOV, CAM_Z);
  const anchor = { x: 173.4, y: 210.8 };

  // diver.ts place() 의 grounded 경로가 실제로 하는 계산 그대로.
  const k = depthScale(CAM_Z, HOME_Z);
  const p = screenToPlane(anchor.x, anchor.y, screenW, screenH, view);
  const home = { x: p.x * k, y: p.y * k };

  // 화면 px <-> z=0 평면 world 는 상수배(screenToPlane 은 선형)이므로, home 을
  // 같은 배율로 되돌리면 정확히 anchor 가 나와야 한다(오프셋이 없다는 뜻).
  const backX = (home.x / k / view.worldW + 0.5) * screenW;
  const backY = (0.5 - home.y / k / view.worldH) * screenH;
  assert.ok(Math.abs(backX - anchor.x) < 1e-9);
  assert.ok(Math.abs(backY - anchor.y) < 1e-9);
});

// ---- 3) 실제로 구운 diver.glb 를 읽어 검증한다 ----

const glbUrl = new URL('../assets/sprites3d/diver.glb', import.meta.url);
const glbBuf = readFileSync(glbUrl);
// Buffer.buffer 는 풀링 때문에 여분 바이트를 가질 수 있다 -- byteOffset/byteLength 로 정확히 자른다.
const mesh = parseGlb(glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength) as ArrayBuffer);

/** 대기 중 잠수부의 대략적인 화면 높이(px) — 82px 는 bake-diver-glb.mjs 검증
 * 로그가 쓰는 것과 같은 기준값(전형적인 칸 크기 기준 실측)이다. */
const TYPICAL_HEIGHT_PX = 82;

test('diver.glb 는 Idle·Walk 두 클립을 모두 담고 있다', () => {
  assert.ok(mesh.anims, 'mesh.anims 가 없다 -- bakedAnims(복수) 가 안 구워졌다');
  const names = mesh.anims!.map((a) => a.name).sort();
  assert.deepEqual(names, ['Idle', 'Walk']);
});

test('Idle 클립: 발 정점(frame0 y<0.03)이 루프 전체에서 사실상 안 움직인다(1px 미만)', () => {
  const idle = mesh.anims!.find((a) => a.name === 'Idle')!;
  const frames = unpackAnimFrames(mesh.position, idle);
  const vertexCount = mesh.position.length / 3;

  const footVerts: number[] = [];
  for (let vi = 0; vi < vertexCount; vi++) if (mesh.position[vi * 3 + 1] < 0.03) footVerts.push(vi);
  assert.ok(footVerts.length > 0, '발 정점을 하나도 못 찾았다 -- 정규화 기준이 바뀌었을 수 있다');

  let maxRangeSq = 0;
  for (const vi of footVerts) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const f of frames) {
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], f[vi * 3 + a]);
        mx[a] = Math.max(mx[a], f[vi * 3 + a]);
      }
    }
    const dx = mx[0] - mn[0], dy = mx[1] - mn[1], dz = mx[2] - mn[2];
    maxRangeSq = Math.max(maxRangeSq, dx * dx + dy * dy + dz * dz);
  }
  const maxRangePx = Math.sqrt(maxRangeSq) * TYPICAL_HEIGHT_PX;
  assert.ok(maxRangePx < 1, `발 정점이 ${maxRangePx.toFixed(3)}px 나 움직인다 -- 대기 중 정지 전제가 깨졌다`);
});

test('Walk 클립: 원본 루프 길이(약 1.33초)를 그대로 들고 있다', () => {
  const walk = mesh.anims!.find((a) => a.name === 'Walk')!;
  assert.ok(walk.loopSeconds !== undefined, 'Walk 클립에 loopSeconds 가 없다 -- diver.ts 가 원본 속도로 못 튼다');
  assert.ok(Math.abs(walk.loopSeconds! - 1.3333) < 0.01, `loopSeconds=${walk.loopSeconds} 가 예상(1.333s)과 다르다`);
});

test('Walk 클립: 발이 실제로 걷는 만큼(눈에 띄게) 움직인다', () => {
  const walk = mesh.anims!.find((a) => a.name === 'Walk')!;
  const frames = unpackAnimFrames(mesh.position, walk);
  const vertexCount = mesh.position.length / 3;

  const footVerts: number[] = [];
  for (let vi = 0; vi < vertexCount; vi++) if (mesh.position[vi * 3 + 1] < 0.03) footVerts.push(vi);

  let maxRangeSq = 0;
  for (const vi of footVerts) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const f of frames) {
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], f[vi * 3 + a]);
        mx[a] = Math.max(mx[a], f[vi * 3 + a]);
      }
    }
    const dx = mx[0] - mn[0], dy = mx[1] - mn[1], dz = mx[2] - mn[2];
    maxRangeSq = Math.max(maxRangeSq, dx * dx + dy * dy + dz * dz);
  }
  const maxRangePx = Math.sqrt(maxRangeSq) * TYPICAL_HEIGHT_PX;
  // Idle 의 발 움직임(<1px)과 뚜렷이 대비되는 하한 -- "정말 걷는 것처럼 보이는가"의
  // 최소선으로 10px 를 잡는다(실측은 약 44.6px, 아래 기준 대비 넉넉한 여유가 있다).
  assert.ok(maxRangePx > 10, `발이 겨우 ${maxRangePx.toFixed(1)}px 밖에 안 움직인다 -- Walk 라기엔 너무 정적이다`);
});

test('diver.glb 파일 전체 크기가 1.1MB 예산 안에 있다', () => {
  const bytes = statSync(glbUrl).size;
  assert.ok(bytes <= 1_100_000, `diver.glb 가 ${(bytes / 1024).toFixed(1)}KB 로 1.1MB 예산을 넘었다`);
});
