// 포식자 굽기 - poly.pizza 의 Quaternius 저폴리 물고기(glTF, CC0) -> anglerfish.glb ·
// goblinShark.glb · squid.glb.
//
// 소스는 assets-raw/poly-pizza/{anglerfish,goblin-shark,squid}.glb (Quaternius, CC0,
// poly.pizza 배포). 세 파일 다 재질(머티리얼) baseColorFactor 로 색을 칠했지
// COLOR_0 정점 속성이 없고, squid 만 텍스처(Sushi_Atlas.png, 512x512)를 쓴다 -
// 런타임 이미지 자산을 0개로 유지해야 하므로(프로젝트 규칙) 굽는 시점에 재질 색과
// 텍스처를 전부 정점 색으로 눌러 담는다:
//   - 재질만 있는 프리미티브(아귀·고블린상어 전부) - baseColorFactor 는 glTF 규격상
//     linear 색공간이므로, 화면에 그대로 보이려면 sRGB 로 변환해 정점 색에 넣는다.
//   - 텍스처가 있는 프리미티브(오징어) - baseColorFactor 가 [1,1,1,1](흰색, 텍스처를
//     그대로 곱하지 않고 통과) 이므로, 텍스처를 UV 로 쌍선형 샘플링해 그대로 쓴다
//     (PNG 는 이미 sRGB 인코딩이라 추가 변환이 필요 없다). 아틀라스를 실측해 보면
//     (report 참고) 단일 색이 아니라 여러 색 블록의 모자이크라 - 이 물고기 하나만의
//     색이 아니라 여러 저폴리 모델이 공유하는 아틀라스로 보인다 - 정점 하나로 뭉개지
//     않고 UV 로 각각 다르게 샘플링한다.
//
// 아귀·고블린상어는 스킨(joints/weights) + 6개 애니메이션 클립을 갖고 있다. 그중
// "Fish_Armature|Swimming_Normal"(56 키프레임, 2.292초)을 고른다 - 6개 중 가장
// 길고 촘촘한 클립이고, 이름 그대로 반복 재생을 노리고 만든 유영 루프다(Attack/
// Death/Out_Of_Water 는 한 번 재생하는 동작이지 루프가 아니고, Swimming_Fast/
// Swimming_Impulse 는 그보다 짧고 거칠다). 스키닝은 잠수부와 같은 방식으로 CPU 로
// 미리 계산해 정점 위치를 몇 프레임 구워 넣는다(tools/lib/gltf.mjs 의 skinVertex -
// glTF 표준 LBS 공식, three Matrix4/Quaternion 으로 계산). 런타임은 여전히 스키닝을
// 안 한다 - glb.ts 는 diver.glb 와 똑같은 최소 포맷(position/normal/color/index +
// 정점 애니메이션 델타)만 읽는다.
//
// 오징어는 스킨도 애니메이션도 없다 - 정지 메시만 굽는다. predators.ts 가 런타임에서
// 흔들림·회전으로 생기를 준다.
//
// 좌표계 - 소스 파일을 실측해(report 참고) 세 축의 역할을 확인했다:
//   * X 는 좌우 대칭축이다(정점을 X 로 뒤집었을 때 가장 가까운 이웃까지 거리가
//     세 축 중 가장 작다 - 실측 11.3 vs Y 28.5 vs Z 17.5, 아귀 기준).
//   * Y 는 코-꼬리 축이다(바운딩박스에서 가장 긴 축이고, Eyes·Teeth·유인등 머티리얼이
//     전부 +Y 쪽에, Fins 가 -Y 쪽에 몰려 있다).
//   * Z 는 등-배 축이다(나머지 하나). 유인등(Light, 실제로 머리 위에 달린 기관)이
//     가장 -Z 쪽에 있고, 고블린상어의 옅은 배색(GoblinShark_Light)이 +Z 쪽에 있어
//     -Z=등(위) / +Z=배(아래) 로 확인된다.
// 우리 장면은 diver.glb 와 같은 관례(Y=위, +Z=정면)를 쓰므로 (x,y,z)_src ->
// (x, -z, y) 로 옮긴다 - 왼쪽 그대로, 등(-Z_src)이 새 +Y(위), 코(+Y_src)가 새
// +Z(정면). 이 변환은 행렬식이 +1(순수 회전) 이라 손대칭이 안 뒤집힌다 - winding
// order 를 다시 걱정할 필요가 없다(법선은 최종 위치에서 다시 계산한다).
//
// 오징어는 재질 그룹이 하나뿐이라 눈·이빨 같은 표지로 좌우/앞뒤를 가늠할 수 없다.
// 대신 Y 값별로 XZ 반경을 재 보면(report 참고) +Y 쪽 끝은 반경이 거의 0 으로
// 좁아지는 뾰족한 외투막(몸통) 끝이고, -Y 쪽은 그보다 넓다 - 오징어는 몸통(외투막)
// 끝이 뾰족하고 팔 다발이 있는 쪽이 그 반대다. 이 게임 장면에서 오징어는 위에서
// 팔을 내밀며 내려오는 촉수 연출을 이어받으므로, 소스 좌표를 그대로 두면(Y 는
// 이미 우리 Y=위 관례와 같은 방향) 별도 회전 없이 -Y(팔 쪽)가 저절로 아래를
// 향한다 - predators.ts 가 이 사실에 기대어 추가 보정 회전을 하지 않는다.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeFlatNormals, quantizeDeltaFrames } from './lib/bakeAnim.mjs';
import { writeGlb } from './lib/glbWrite.mjs';
import {
  animationDuration,
  buildNodeIndex,
  decodePng,
  evaluateAnimation,
  globalMatrix,
  parseGlb,
  readAccessorFloat,
  readAccessorRaw,
  sampleBilinear,
  skinVertex,
} from './lib/gltf.mjs';

import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, 'assets-raw/poly-pizza');
const OUT_DIR = resolve(ROOT, 'game/src/assets/sprites3d');

const CLIP_NAME = 'Fish_Armature|Swimming_Normal';
/**
 * 루프 하나를 몇 프레임으로 구울까. 예산은 "추가되는 자산 총 무게 400KB 이하"
 * (세 마리 합산, 정지 지오메트리 + 애니메이션 델타 전부 포함).
 *
 * 재질 그룹(=프리미티브)마다 정점을 안 나누면 flatShading 이 깨지므로(면마다 다른
 * 색인데 정점을 공유하면 경계가 뭉개진다) 머티리얼 경계에서 정점이 쪼개져,
 * 삼각형 수(아귀 1870 · 고블린상어 1270)보다 실제 정점 수(아귀 2566 · 고블린상어
 * 1844)가 더 많다 - 처음에 accessor 하나(=프리미티브 하나, 즉 재질 하나)의
 * count 만 보고 "아귀 420정점"으로 어림잡았던 건 틀렸다(그건 이빨 하나의
 * 정점 수였다) - 실제 예산 계산은 이 실측치를 써야 한다.
 *
 * 정지 지오메트리(position+normal+color+index)만으로:
 *   아귀       2566정점 * 36B + 1870삼각형*3*4B ≈ 112.1KB
 *   고블린상어 1844정점 * 36B + 1270삼각형*3*4B ≈  79.7KB
 *   오징어     1029정점 * 36B + 1296삼각형*3*4B ≈  51.4KB
 *   합계 ≈ 243.2KB - 이미 예산의 60% 를 차지한다.
 * 남은 ≈157KB 를 아귀·고블린상어 둘이 나눠 쓴다. 델타 프레임 하나당(둘 합산)
 * 정점수*3축*2바이트 = (2566+1844)*6 ≈ 25.8KB 이므로, 6프레임(델타 5개)이면
 * 5*25.8 ≈ 129KB 로 합계 ≈372KB - 예산 안에서 여유 있게 들어간다(실측치는
 * 콘솔 로그 참고). 원본 클립은 56키프레임(24fps)이니 6프레임은 크게 솎아낸
 * 쪽이지만, 유영 동작은 척추를 따라 도는 단일 주기 파형이라 몇 개 안 되는
 * 샘플을 선형보간해도(런타임이 하는 일) 파형 형태가 크게 안 뭉개진다 -
 * 잠수부의 미묘한 호흡(진폭 작고 다주파수)과는 다른 사정이다.
 */
const FRAME_COUNT = 6;

/** 소스 좌표 -> 우리 관례(Y=위, +Z=정면). 파일 상단 "좌표계" 주석 참고. */
function mapVert(v) {
  return new THREE.Vector3(v.x, -v.z, v.y);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function loadSource(fileBase) {
  const buf = readFileSync(resolve(SRC_DIR, `${fileBase}.glb`));
  return parseGlb(buf);
}

/** mesh 를 참조하는 노드(스킨 유무와 무관 - squid 도 이 함수로 찾는다) */
function findMeshNode(json) {
  const i = json.nodes.findIndex((n) => n.mesh !== undefined);
  if (i < 0) throw new Error('mesh 를 참조하는 노드를 못 찾았다');
  return i;
}

/**
 * 스킨된 물고기(아귀·고블린상어) 하나를 굽는다.
 *
 * @param fileBase 소스 파일 이름(확장자 제외)
 * @param outName 출력 파일 이름(확장자 제외)
 */
function bakeSkinnedFish(fileBase, outName) {
  const { json, bin } = loadSource(fileBase);
  const nodeIdx = buildNodeIndex(json);
  const meshNode = findMeshNode(json);
  // 메시 노드 자신은 이 두 리그에서 애니메이션되지 않는다(채널이 조인트 노드만
  // 겨냥한다 - 직접 덤프해 확인했다) - 바인드(정지) 전역 행렬로 충분하다.
  const meshGlobal = globalMatrix(meshNode, nodeIdx, null);

  const skin = json.skins[0];
  const invBindAll = readAccessorFloat(json, bin, skin.inverseBindMatrices);
  const invBind = skin.joints.map((_, i) => new THREE.Matrix4().fromArray(invBindAll, i * 16));

  const animation = json.animations.find((a) => a.name === CLIP_NAME);
  if (!animation) throw new Error(`${fileBase}: 클립 '${CLIP_NAME}' 을 못 찾았다`);
  const duration = animationDuration(json, bin, animation);

  /** 시각 t 에서 조인트별 최종 행렬(boneGlobal * invBind) - gltf.mjs skinVertex 입력. */
  function jointMatricesAt(t) {
    const overrides = t === null ? null : evaluateAnimation(json, bin, animation, t);
    const cache = new Map();
    return skin.joints.map((jointNode, i) =>
      globalMatrix(jointNode, nodeIdx, overrides, cache).clone().multiply(invBind[i]),
    );
  }

  // 프리미티브(머티리얼 그룹)를 하나로 합친다 - 잠수부가 부위(Head/Body/Legs/Feet)를
  // 합치던 것과 같은 이유다: 우리 포맷은 프리미티브 하나(재질 하나 + vertexColors)만
  // 다룬다(glb.ts 참고).
  const prims = json.meshes[0].primitives;
  const perPrimVerts = prims.map((prim) => ({
    position: readAccessorFloat(json, bin, prim.attributes.POSITION),
    joints: readAccessorRaw(json, bin, prim.attributes.JOINTS_0),
    weights: readAccessorFloat(json, bin, prim.attributes.WEIGHTS_0),
    index: readAccessorRaw(json, bin, prim.indices),
    materialIndex: prim.material,
  }));
  const vertCount = perPrimVerts.reduce((n, p) => n + p.position.length / 3, 0);

  /** t=null 이면 애니메이션 오버라이드 없이(바인드 포즈) 스킨한다. */
  function mergedPositionAt(t) {
    const jm = jointMatricesAt(t);
    const out = new Float32Array(vertCount * 3);
    let vi = 0;
    for (const p of perPrimVerts) {
      const n = p.position.length / 3;
      for (let i = 0; i < n; i++) {
        const local = new THREE.Vector3(p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]);
        const v1 = local.applyMatrix4(meshGlobal);
        const skinned = skinVertex(
          v1,
          [p.joints[i * 4], p.joints[i * 4 + 1], p.joints[i * 4 + 2], p.joints[i * 4 + 3]],
          [p.weights[i * 4], p.weights[i * 4 + 1], p.weights[i * 4 + 2], p.weights[i * 4 + 3]],
          jm,
        );
        const mapped = mapVert(skinned);
        out[(vi + i) * 3] = mapped.x;
        out[(vi + i) * 3 + 1] = mapped.y;
        out[(vi + i) * 3 + 2] = mapped.z;
      }
      vi += n;
    }
    return out;
  }

  function buildColorAndIndex() {
    const color = new Float32Array(vertCount * 3);
    const index = new Uint32Array(perPrimVerts.reduce((n, p) => n + p.index.length, 0));
    let vbase = 0, ibase = 0;
    for (const p of perPrimVerts) {
      const mat = json.materials[p.materialIndex];
      const [rl, gl, bl] = mat.pbrMetallicRoughness.baseColorFactor;
      const r = linearToSrgb(rl), g = linearToSrgb(gl), b = linearToSrgb(bl);
      const n = p.position.length / 3;
      for (let i = 0; i < n; i++) {
        color[(vbase + i) * 3] = r;
        color[(vbase + i) * 3 + 1] = g;
        color[(vbase + i) * 3 + 2] = b;
      }
      for (let i = 0; i < p.index.length; i++) index[ibase + i] = vbase + p.index[i];
      vbase += n;
      ibase += p.index.length;
    }
    return { color, index };
  }

  // 정규화 - 바인드 포즈(t=0 프레임)의 바운딩박스 중심을 원점으로, 코-꼬리 축(우리
  // 좌표계의 +Z, mapVert 이후)의 전체 길이가 1 이 되게 스케일한다. "몸길이 1" 이
  // predators.ts 쪽 스케일 계산 기준이 된다(place() 가 world 단위 몸길이를 그대로
  // 목표 화면 크기로 곱하면 된다) - 잠수부가 "키 1"을 쓰는 것과 같은 관례다.
  const frame0Raw = mergedPositionAt(0);
  const bbox = bboxOf(frame0Raw);
  const center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  const bodyLength = bbox.max[2] - bbox.min[2]; // +Z 가 코-꼬리
  const normalize = (arr) => {
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = (arr[i] - center[0]) / bodyLength;
      arr[i + 1] = (arr[i + 1] - center[1]) / bodyLength;
      arr[i + 2] = (arr[i + 2] - center[2]) / bodyLength;
    }
  };
  normalize(frame0Raw);
  const position = frame0Raw;
  const { color, index } = buildColorAndIndex();
  const normal = computeFlatNormals(position, index);

  const deltaFrames = [];
  for (let i = 1; i < FRAME_COUNT; i++) {
    const t = (duration * i) / FRAME_COUNT;
    const raw = mergedPositionAt(t);
    normalize(raw);
    const delta = new Float32Array(raw.length);
    for (let k = 0; k < raw.length; k++) delta[k] = raw[k] - position[k];
    deltaFrames.push(delta);
  }
  const { scale, deltaInt16 } = quantizeDeltaFrames(deltaFrames, vertCount);

  // 원점(몸 중심) 기준 최대 정점 거리 — 모든 프레임(바인드 + 델타 적용)에 걸쳐 잰다.
  // predators.ts/predators.test.ts 가 이 값을 "몸길이=1 기준 바운딩 반지름"으로
  // 그대로 옮겨 적어(EEL_HEAD_REACH 가 하던 역할과 같다) danger=1 에서 보드 사각형을
  // 안 넘는지 검증한다 — 애니메이션 중 가장 많이 뻗는 프레임까지 포함해야 안전하다.
  let maxReachSq = 0;
  for (let vi = 0; vi < vertCount; vi++) {
    const bx = position[vi * 3], by = position[vi * 3 + 1], bz = position[vi * 3 + 2];
    maxReachSq = Math.max(maxReachSq, bx * bx + by * by + bz * bz);
    for (const delta of deltaFrames) {
      const x = bx + delta[vi * 3], y = by + delta[vi * 3 + 1], z = bz + delta[vi * 3 + 2];
      maxReachSq = Math.max(maxReachSq, x * x + y * y + z * z);
    }
  }
  const maxReach = Math.sqrt(maxReachSq);

  // 루프 이음매 확인 - t=duration(다음 바퀴의 시작과 같아야 할 시점)을 따로 샘플링해
  // t=0 과 얼마나 벌어지는지 잰다. 정점 애니메이션 델타로는 안 굽는 값이고(프레임은
  // t=duration*(FRAME_COUNT-1)/FRAME_COUNT 까지만 굽는다 - 이 결과의 다음 프레임이
  // 곧 프레임 0 으로 돌아간다는 가정), 그 가정이 맞는지 로그로만 확인한다.
  const seamRaw = mergedPositionAt(duration);
  normalize(seamRaw);
  let seamMaxDelta = 0;
  for (let i = 0; i < seamRaw.length; i++) seamMaxDelta = Math.max(seamMaxDelta, Math.abs(seamRaw[i] - position[i]));

  const outPath = resolve(OUT_DIR, `${outName}.glb`);
  const animBytes = writeGlb(outPath, {
    position,
    normal,
    color,
    index,
    anim: { frameCount: FRAME_COUNT, scale, deltaInt16, loopSeconds: duration },
  });

  console.log(`${outName}.glb  정점 ${vertCount}  삼각형 ${index.length / 3}`);
  console.log(
    `  애니메이션  clip=${CLIP_NAME}  프레임 ${FRAME_COUNT}(루프 ${duration.toFixed(3)}s 를 균등 샘플)` +
      `  델타 ${(animBytes / 1024).toFixed(1)}KB  축스케일 ${scale.map((s) => s.toExponential(3)).join(', ')}`,
  );
  console.log(`  루프 이음매(t=0 vs t=duration, 몸길이=1 기준 최대 정점 이동): ${seamMaxDelta.toFixed(4)}`);
  console.log(`  원점 기준 최대 정점 거리(전 프레임, 몸길이=1 기준): ${maxReach.toFixed(4)}`);

  return { vertCount, triCount: index.length / 3, fileBytes: statSize(outPath), animBytes };
}

function bboxOf(position) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], position[i + a]);
      max[a] = Math.max(max[a], position[i + a]);
    }
  }
  return { min, max };
}

function statSize(path) {
  return readFileSync(path).byteLength;
}

/**
 * 오징어 - 스킨도 애니메이션도 없는 단일 정지 메시. 유일한 소스가 텍스처
 * (Sushi_Atlas.png)라 UV 로 쌍선형 샘플링해 정점 색을 굽는다(파일 상단 주석).
 * 좌표는 변환하지 않는다(이미 Y=위 관례와 맞는다 - 파일 상단 주석 참고).
 */
function bakeSquid() {
  const { json, bin } = loadSource('squid');
  const nodeIdx = buildNodeIndex(json);
  const meshNode = findMeshNode(json);
  const meshGlobal = globalMatrix(meshNode, nodeIdx, null);

  const prim = json.meshes[0].primitives[0];
  const posRaw = readAccessorFloat(json, bin, prim.attributes.POSITION);
  const uv = readAccessorFloat(json, bin, prim.attributes.TEXCOORD_0);
  const index = Uint32Array.from(readAccessorRaw(json, bin, prim.indices));
  const vertCount = posRaw.length / 3;

  const position = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const v = new THREE.Vector3(posRaw[i * 3], posRaw[i * 3 + 1], posRaw[i * 3 + 2]).applyMatrix4(meshGlobal);
    position[i * 3] = v.x;
    position[i * 3 + 1] = v.y;
    position[i * 3 + 2] = v.z;
  }

  const bbox = bboxOf(position);
  const center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  const bodyLength = bbox.max[1] - bbox.min[1]; // Y 가 외투막(몸통) 축 - 파일 상단 주석
  for (let i = 0; i < position.length; i += 3) {
    position[i] = (position[i] - center[0]) / bodyLength;
    position[i + 1] = (position[i + 1] - center[1]) / bodyLength;
    position[i + 2] = (position[i + 2] - center[2]) / bodyLength;
  }

  const mat = json.materials[prim.material];
  const texInfo = mat.pbrMetallicRoughness.baseColorTexture;
  const imgBufferView = json.images[json.textures[texInfo.index].source].bufferView;
  const bv = json.bufferViews[imgBufferView];
  const imgBuf = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const tex = decodePng(imgBuf);

  const color = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const [r, g, b] = sampleBilinear(tex, uv[i * 2], uv[i * 2 + 1]);
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;
  }

  const normal = computeFlatNormals(position, index);

  let maxReachSq = 0;
  for (let i = 0; i < position.length; i += 3) {
    maxReachSq = Math.max(maxReachSq, position[i] ** 2 + position[i + 1] ** 2 + position[i + 2] ** 2);
  }
  const maxReach = Math.sqrt(maxReachSq);

  const outPath = resolve(OUT_DIR, 'squid.glb');
  writeGlb(outPath, { position, normal, color, index, anim: null });

  console.log(`squid.glb  정점 ${vertCount}  삼각형 ${index.length / 3}  텍스처 ${tex.width}x${tex.height} -> 정점색`);
  console.log(`  원점 기준 최대 정점 거리(몸길이=1 기준): ${maxReach.toFixed(4)}`);

  return { vertCount, triCount: index.length / 3, fileBytes: statSize(outPath) };
}

// ---- 굽기 ----

const anglerfish = bakeSkinnedFish('anglerfish', 'anglerfish');
const goblinShark = bakeSkinnedFish('goblin-shark', 'goblinShark');
const squid = bakeSquid();

const totalBytes = anglerfish.fileBytes + goblinShark.fileBytes + squid.fileBytes;
const totalTris = anglerfish.triCount + goblinShark.triCount + squid.triCount;
console.log(
  `합계  파일 ${(totalBytes / 1024).toFixed(1)}KB  삼각형 ${totalTris}` +
    `  (예산 400KB / 40000 삼각형 대비)`,
);
