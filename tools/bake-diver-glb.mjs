// 잠수부 굽기 - Quaternius SpaceSuit(FBX, CC0) -> diver.glb
//
// 예전 도구(bake-diver-3d.mjs)는 같은 FBX 를 소프트웨어 렌더러로 PNG 한 장에 구웠다.
// 이 도구는 그다음 세대(정적 3D 메시)를 거쳐, 이제는 Quaternius 애니메이션
// 라이브러리(assets-raw/quaternius-men/unpacked/Animations.fbx)의 Idle 클립을 실제
// 스켈레탈 애니메이션으로 구워 넣는다 - 몸 전체를 흔드는 사인 두 개로 "떠 있는 척"
// 하던 걸(game/src/render3d/diver.ts 의 예전 방식) 진짜 관절 움직임으로 바꾼다.
//
// 런타임에는 스키닝을 절대 안 한다(SkinnedMesh, 본 계층 없음 - glb.ts 는 최소
// 파서로 계속 남는다). 대신 이 도구가 오프라인에서 Idle 루프를 몇 프레임 샘플링해
// 스키닝을 CPU 로 미리 계산하고, 정점 위치를 그대로 구워 glb 에 얹는다. 런타임은
// 그 프레임 사이를 보간만 한다 - diver.ts 참고.
//
// 좌표계로 두 번 틀렸던 기록을 남긴다:
//   * FBX 표준은 Y-up 이지만 Blender 로 내보낸 것은 Z-up 이다. 틀리면 정수리에서
//     내려다본 그림(팔이 좌우로 뻗은 T 자)이 나온다.
//   * Blender 인물은 -Y 를 향해 서 있다. 그대로 보면 뒤통수만 나온다.
//
// 텍스처를 안 쓰고 버텍스 컬러로 칠한다. 런타임 이미지 파일이 0개가 된다.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeFlatNormals, quantizeDeltaFrames } from './lib/bakeAnim.mjs';
import { meshesOf, parseFbx } from './lib/fbx.mjs';
import { writeGlb } from './lib/glbWrite.mjs';
import {
  clusterOffsets,
  computeGlobalTransforms,
  findMeshModelId,
  globalTransformStatic,
  indexClustersByVertex,
  invertAffine,
  parseAnimationClip,
  parseModelHierarchy,
  parseSkin,
  skinAllVertices,
} from './lib/fbxSkin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// unpacked/ 의 SpaceSuit 부위 FBX 는 assets-raw/quaternius-men/SpaceSuit/ 와 구조가
// 동일하다(바이트 단위로 같다) - 애니메이션 라이브러리와 한 폴더에 있는 unpacked/ 를 쓴다.
const SRC = resolve(ROOT, 'assets-raw/quaternius-men/unpacked');
const OUT = resolve(ROOT, 'game/src/assets/sprites3d/diver.glb');

// ---- 모델 치수 (bake-diver-3d.mjs 에서 그대로. 단위: 모델 좌표, z 가 높이) ----
// 팔 각도를 직접 돌리던 예전 도구와 달리 이제는 정점 자체가 Idle 클립을 통해
// "팔을 내린" 스킨 결과로 나오므로 TORSO_HALF_W/SHOULDER_Z/ARM_DROP 은 더 필요
// 없다. 전신 높이 정규화 기준(HEAD_TOP_Z, FOOT_Z)만 그대로 쓴다 - 이 값을 바꾸면
// CELLS_TALL 등 diver.ts/depthProjection.ts 의 기존 보정 상수와 어긋난다.
const HEAD_TOP_Z = 1.89;
const FOOT_Z = 0;

// 잠수복 팔레트 (0..255). 구리 헬멧이 정체를 한 번에 알리고, 네오프렌 몸통과 납 부츠가
// 그걸 받친다. 몸통을 너무 어둡게 두면 640m 물빛에 실루엣이 잠긴다 - 대비는 헬멧이 만든다.
const HELMET = [186, 148, 86];
const SUIT = [56, 84, 106];
const PANTS = [40, 62, 82];
const BOOT = [118, 104, 88];
const TINT = { Head: HELMET, Body: SUIT, Legs: PANTS, Feet: BOOT };

// ---- 재생할 애니메이션 클립 ----
//
// Animations.fbx 에는 Idle 계열이 6개 있다: Idle, Idle_Gun, Idle_Gun_Pointing,
// Idle_Gun_Shoot, Idle_Neutral, Idle_Sword. 잠수부는 총도 칼도 안 드므로 후보는
// Idle 과 Idle_Neutral 둘로 좁혀진다. 8프레임 샘플로 정점 움직임 범위를 재보면
// Idle 이 0.0335, Idle_Neutral 이 0.0159(정규화된 모델 좌표 기준, 전신 높이가 1) -
// 거의 절반이다. 이 게임은 런타임에서 루프를 몇 배 느리게 늘려 재생하므로(diver.ts
// 의 IDLE_ANIM_LOOP_SECONDS), 원본 움직임이 작을수록 늘렸을 때 거의 안 보이게
// 잦아든다. 부유감을 살리려면 원본이 더 큰 쪽이 유리해 Idle 을 골랐다. 두 클립
// 다 팔은 이미 T포즈가 아니라 몸통 옆으로 내려와 있다(원본 클립 자체가 그렇게
// 애니메이션되어 있다) - 예전 poseArms() 같은 수동 회전은 더는 필요 없다.
const ANIM_CLIP = 'CharacterArmature|Idle';

// 루프 한 바퀴를 몇 프레임으로 구울까.
//
// 정점 5470개 * 3축 * 2바이트(Int16 델타) = 프레임당 32820바이트. 예산은
// "추가되는 애니메이션 데이터 400KB 이하". 프레임 0 은 POSITION 자체이므로 델타를
// 저장할 필요가 없다 - 실제로 굽는 델타는 FRAME_COUNT-1 개.
//   11 * 32820 ≈ 351.6KB  (FRAME_COUNT=12, 이 값)
//   12 * 32820 ≈ 384.6KB  (FRAME_COUNT=13, 여유가 빠듯하다)
// Idle 클립 자체가 50프레임(30fps, 1.667초)이고 움직임이 느린 호흡·흔들림
// 수준이라 12프레임 샘플로도 원본 곡선과 시각적으로 거의 구분이 안 된다.
const FRAME_COUNT = 12;

const PART_NAMES = ['Head', 'Body', 'Legs', 'Feet'];

const parts = PART_NAMES.map((name) => {
  const nodes = parseFbx(readFileSync(resolve(SRC, `SpaceSuit_${name}.fbx`)));
  const hierarchy = parseModelHierarchy(nodes);
  const meshModelId = findMeshModelId(nodes);
  const meshGlobalNow = globalTransformStatic(hierarchy, meshModelId);
  const invMeshGlobalNow = invertAffine(meshGlobalNow);
  const clusters = indexClustersByVertex(clusterOffsets(parseSkin(nodes), meshGlobalNow));
  const mesh = meshesOf(nodes)[0];
  return { name, mesh, clusters, invMeshGlobalNow, rgb: TINT[name] };
});

const animNodes = parseFbx(readFileSync(resolve(SRC, 'Animations.fbx')));
const animHierarchy = parseModelHierarchy(animNodes);
const clip = parseAnimationClip(animNodes, ANIM_CLIP);

/** 모델 좌표 -> Y-up, +Z 정면 */
const mapVert = (v, i) => [v[i], v[i + 2], -v[i + 1]];

/**
 * 시각 t(초) 에서 네 부위를 전부 스킨해 Head, Body, Legs, Feet 순서로 이어붙인,
 * 아직 정규화 전인 위치 배열을 만든다. 순서는 buildColorAndIndex() 의 순서와
 * 반드시 같아야 정점 인덱스가 어긋나지 않는다.
 */
function mergedPositionAt(t) {
  const boneGlobals = computeGlobalTransforms(animHierarchy, clip, t);
  const position = [];
  for (const part of parts) {
    const skinned = skinAllVertices(part.mesh.verts, part.clusters, boneGlobals, part.invMeshGlobalNow);
    for (let i = 0; i < skinned.length; i += 3) {
      const [x, y, z] = mapVert(skinned, i);
      position.push(x, y, z);
    }
  }
  return new Float32Array(position);
}

/** 색·인덱스는 애니메이션과 무관 - 부위별 정점 개수·삼각형만 있으면 한 번만 지으면 된다. */
function buildColorAndIndex() {
  const color = [];
  const index = [];
  let base = 0;
  for (const part of parts) {
    const n = part.mesh.verts.length / 3;
    for (let i = 0; i < n; i++) color.push(part.rgb[0] / 255, part.rgb[1] / 255, part.rgb[2] / 255);
    for (const tri of part.mesh.tris) index.push(base + tri[0], base + tri[1], base + tri[2]);
    base += n;
  }
  return { color: new Float32Array(color), index: new Uint32Array(index) };
}

/**
 * 발이 y=0, 정수리가 y=1 이 되는 정규화 상수를 프레임 하나에서 구한다.
 * 모든 프레임에 이 값을 그대로 재사용해야 한다 - 프레임마다 따로 구하면(포즈가
 * 조금만 바뀌어도 정점 평균이 흔들리므로) 진짜 움직임이 아닌 "재중심 잡기" 흔들림이
 * 델타에 섞여 들어간다.
 */
function computeNormalizeParams(position) {
  const span = HEAD_TOP_Z - FOOT_Z;
  let minY = Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < position.length; i += 3) {
    minY = Math.min(minY, position[i + 1]);
    cx += position[i];
    cz += position[i + 2];
  }
  const n = position.length / 3;
  return { span, minY, cx: cx / n, cz: cz / n };
}

function applyNormalize(position, params) {
  const { span, minY, cx, cz } = params;
  for (let i = 0; i < position.length; i += 3) {
    position[i] = (position[i] - cx) / span;
    position[i + 1] = (position[i + 1] - minY) / span;
    position[i + 2] = (position[i + 2] - cz) / span;
  }
}

// 법선 계산(프레임 0 만, 전 프레임이 공유)과 델타 양자화는 tools/lib/bakeAnim.mjs
// 로 옮겼다 — bake-predators-glb.mjs 도 같은 방식을 그대로 재사용한다(Idle 은
// 가슴이 살짝 오르내리는 정도라 법선을 프레임마다 다시 구울 만큼 크게 안 바뀐다는
// 판단은 여전히 유효하다 - bakeAnim.mjs 주석 참고). glb 작성도 tools/lib/glbWrite.mjs
// 로 옮겼다 — 두 굽기 도구가 각자 파일 쓰기 코드를 들면 형식이 슬쩍 갈라지기
// 쉬워서다. extras 필드 이름도 diverAnim 이 아니라 bakedAnim 이다(glbWrite.mjs
// 주석 참고) — glb.ts 가 그 이름으로 읽는다.

// ---- 굽기 ----

const { color, index } = buildColorAndIndex();

const frame0Raw = mergedPositionAt(0);
const normParams = computeNormalizeParams(frame0Raw);
applyNormalize(frame0Raw, normParams);
const position = frame0Raw;
const normal = computeFlatNormals(position, index);

const vertCount = position.length / 3;
const deltaFrames = [];
for (let i = 1; i < FRAME_COUNT; i++) {
  const t = (clip.durationSeconds * i) / FRAME_COUNT;
  const raw = mergedPositionAt(t);
  applyNormalize(raw, normParams);
  const delta = new Float32Array(raw.length);
  for (let k = 0; k < raw.length; k++) delta[k] = raw[k] - position[k];
  deltaFrames.push(delta);
}

const { scale, deltaInt16 } = quantizeDeltaFrames(deltaFrames, vertCount);

// 실루엣이 프레임 사이에서 얼마나 움직이는지(정규화 모델 좌표, 전신 높이가 1) -
// 검증할 때 화면 px 로 환산하는 데 쓴다.
let maxRangeSq = 0;
for (let vi = 0; vi < vertCount; vi++) {
  let mn = [position[vi * 3], position[vi * 3 + 1], position[vi * 3 + 2]];
  let mx = [...mn];
  for (const delta of deltaFrames) {
    for (let a = 0; a < 3; a++) {
      const v = position[vi * 3 + a] + delta[vi * 3 + a];
      mn[a] = Math.min(mn[a], v);
      mx[a] = Math.max(mx[a], v);
    }
  }
  const dx = mx[0] - mn[0], dy = mx[1] - mn[1], dz = mx[2] - mn[2];
  maxRangeSq = Math.max(maxRangeSq, dx * dx + dy * dy + dz * dz);
}
const maxSilhouetteRange = Math.sqrt(maxRangeSq);

const animBytes = writeGlb(OUT, {
  position,
  normal,
  color,
  index,
  anim: { frameCount: FRAME_COUNT, scale, deltaInt16 },
});

console.log(`diver.glb  정점 ${position.length / 3}  삼각형 ${index.length / 3}`);
console.log(
  `애니메이션  clip=${ANIM_CLIP}  프레임 ${FRAME_COUNT}(루프 ${clip.durationSeconds.toFixed(3)}s 를 균등 샘플)` +
    `  델타 ${(animBytes / 1024).toFixed(1)}KB  축스케일 ${scale.map((s) => s.toExponential(3)).join(', ')}`,
);
console.log(
  `가장 많이 움직이는 정점의 프레임 간 최대 이동 범위(정규화 모델 좌표, 전신 높이=1): ${maxSilhouetteRange.toFixed(4)}` +
    ` (전신 높이 82px 기준 약 ${(maxSilhouetteRange * 82).toFixed(1)}px)`,
);
