// FBX 스킨(뼈대, 클러스터, 바인드 행렬)과 애니메이션 커브를 읽는다.
//
// fbx.mjs 는 일부러 지오메트리만 읽는다(그 파일 상단 주석 참고) - 정적 메시를 굽는
// 도구들은 그걸로 충분했다. 잠수부·포식자의 스켈레탈 애니메이션을 구우려면 뼈대, 스킨
// 웨이트, 바인드 행렬, 애니메이션 커브가 다 필요해서 이 파일을 따로 뒀다 - fbx.mjs 를
// 그대로 둔 채 그 위에 얹으면, 정적 메시만 읽는 다른 소비자에 영향이 없다.
//
// parseFbx() 로 얻은 노드 트리는 재사용한다(중복 구현하지 않는다).

import { parseFbx } from './fbx.mjs';

// ---------- 4x4 행렬 ----------
//
// row-major 배열 16개: m[row*4+col]. 이동은 각 행의 4번째 값(m[3], m[7], m[11])에 있다.
// v' = M * v (v 는 [x,y,z,1] 열벡터) 로 점을 옮긴다.

function matIdentity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** a*b - b 를 먼저 적용한 뒤 a 를 적용하는 것과 같다. */
function matMultiply(a, b) {
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/**
 * FBX 의 Transform/TransformLink 16개 값은 column-major 로 저장된다(OpenGL 관례이자
 * FBX SDK 관례). 이 파서의 내부 표현(row-major)으로 옮겨 담는다.
 */
function matFromColumnMajor(arr) {
  const m = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      m[row * 4 + col] = arr[col * 4 + row];
    }
  }
  return m;
}

function matFromTranslation(x, y, z) {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

function matFromScale(x, y, z) {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/**
 * FBX 기본 회전 순서(RotationOrder 미지정 = eEulerXYZ)는 "X 축부터 회전"을
 * 내재(intrinsic) 좌표축 기준으로 뜻한다. 고정축(외재) 합성으로 바꾸면 순서가
 * 뒤집혀 R = Rz(z) * Ry(y) * Rx(x) 다(내재 XYZ = 외재 ZYX, 표준 항등식). three.js
 * FBXLoader 도 FBX 회전순서 0 을 자신의 Euler 순서 'ZYX' 로 매핑한다 - 같은 결론이다.
 *
 * 이 프로젝트가 쓰는 Quaternius 리그의 모든 Model 에는 RotationOrder, PreRotation,
 * PostRotation, 피벗 프로퍼티가 없다(직접 덤프해서 확인했다) - 있었다면 이 함수로는
 * 부족하다.
 */
function matFromEulerZYXDeg(rx, ry, rz) {
  const d = Math.PI / 180;
  const x = rx * d, y = ry * d, z = rz * d;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  const Rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1];
  const Ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1];
  const Rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return matMultiply(Rz, matMultiply(Ry, Rx));
}

/** 로컬 변환 = T * R * S (피벗, pre/post-rotation 없음 - 위 주석 참고). */
function matFromTRS(t, r, s) {
  return matMultiply(
    matFromTranslation(t[0], t[1], t[2]),
    matMultiply(matFromEulerZYXDeg(r[0], r[1], r[2]), matFromScale(s[0], s[1], s[2])),
  );
}

/**
 * 아핀 행렬(마지막 행이 [0,0,0,1])의 역행렬.
 * M = [R T; 0 1] 이면 M^-1 = [R^-1  -R^-1*T; 0 1] - 3x3 만 여인수로 뒤집으면 된다.
 */
function matInvertAffine(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-20) throw new Error('행렬을 뒤집을 수 없다(특이행렬)');
  const invDet = 1 / det;
  const r0 = [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet];
  const r1 = [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet];
  const r2 = [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet];
  const tx = m[3], ty = m[7], tz = m[11];
  const ix = -(r0[0] * tx + r0[1] * ty + r0[2] * tz);
  const iy = -(r1[0] * tx + r1[1] * ty + r1[2] * tz);
  const iz = -(r2[0] * tx + r2[1] * ty + r2[2] * tz);
  return [r0[0], r0[1], r0[2], ix, r1[0], r1[1], r1[2], iy, r2[0], r2[1], r2[2], iz, 0, 0, 0, 1];
}

function matTransformPoint(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

// bake 스크립트가 meshGlobalNow 를 직접 다뤄야 해서(아래 clusterOffsets 주석 참고)
// 행렬 유틸을 공개로 내보낸다.
export { matInvertAffine as invertAffine, matTransformPoint as transformPoint };

// ---------- FBX 트리 helpers ----------

function findAll(nodes, name, out = []) {
  for (const n of nodes) {
    if (n.name === name) out.push(n);
    findAll(n.children, name, out);
  }
  return out;
}

/**
 * FBX 오브젝트 이름은 표시이름 뒤에 NUL 바이트 하나, 그다음 클래스이름이 붙는
 * 형태로 저장된다. NUL 앞까지만 잘라 표시이름만 얻는다. 소스 파일에 제어문자를
 * 그대로 박아두면 지저분하므로 charCode 로 구분자를 만든다.
 */
const NAME_SEPARATOR = String.fromCharCode(0);
function stripName(raw) {
  return String(raw).split(NAME_SEPARATOR)[0];
}

function objectsIndex(fbxNodes) {
  const objects = findAll(fbxNodes, 'Objects')[0];
  const conns = findAll(fbxNodes, 'Connections')[0];
  const byId = new Map();
  for (const c of objects.children) byId.set(c.props[0], c);
  return { objects, conns: conns ? conns.children : [], byId };
}

function properties70Of(node) {
  const p70 = node.children.find((c) => c.name === 'Properties70');
  const map = new Map();
  if (p70) for (const p of p70.children) map.set(p.props[0], p.props.slice(4));
  return map;
}

// ---------- 뼈대 계층 ----------

/**
 * fbxNodes 안의 모든 Model 을 읽어 id -> {name, parentId, t, r, s} 맵으로 돌려준다.
 * 부모는 Connections 의 OO 커넥션(자식id, 부모id)으로 찾는다(부모가 없으면 0 = 씬 루트).
 *
 * FBX 는 OO 커넥션 하나로 계층(부모-자식)과 스킨 바인딩(본-클러스터)을 둘 다
 * 표현한다 - 예를 들어 "OO | Root본id | RootSubDeformer(클러스터)id" 커넥션이
 * "OO | Root본id | CharacterArmature(진짜 부모)id" 와 나란히 존재한다. 대상이
 * Model 이 아닌 커넥션(클러스터·Skin 등을 가리키는 것)을 걸러내지 않으면 본의
 * 부모가 자신의 클러스터로 잘못 잡혀 전역 행렬이 통째로 틀어진다(직접 겪은 버그 -
 * CharacterArmature 의 Scale=100 이 전역 행렬에서 사라지는 형태로 드러났다).
 */
export function parseModelHierarchy(fbxNodes) {
  const { objects, conns, byId } = objectsIndex(fbxNodes);
  const parentOf = new Map();
  for (const c of conns) {
    if (c.props[0] !== 'OO') continue;
    const parentId = c.props[2];
    const parentObj = parentId === 0 ? null : byId.get(parentId);
    if (parentId !== 0 && parentObj?.name !== 'Model') continue;
    parentOf.set(c.props[1], parentId);
  }
  const hierarchy = new Map();
  for (const m of objects.children) {
    if (m.name !== 'Model') continue;
    const props = properties70Of(m);
    hierarchy.set(m.props[0], {
      id: m.props[0],
      name: stripName(m.props[1]),
      parentId: parentOf.get(m.props[0]) ?? 0,
      t: props.get('Lcl Translation') ?? [0, 0, 0],
      r: props.get('Lcl Rotation') ?? [0, 0, 0],
      s: props.get('Lcl Scaling') ?? [1, 1, 1],
    });
  }
  return hierarchy;
}

/**
 * hierarchy 의 정적(바인드) 로컬 값만으로 전역 행렬을 계산한다.
 * 애니메이션 없이 - SpaceSuit_*.fbx 자체 계층으로 Cluster.TransformLink 를
 * 재현할 수 있는지 확인하는 정합성 검사(bake 스크립트)에 쓴다.
 */
export function globalTransformStatic(hierarchy, id) {
  const cache = new Map();
  function go(boneId) {
    if (boneId === 0) return matIdentity();
    if (cache.has(boneId)) return cache.get(boneId);
    const node = hierarchy.get(boneId);
    if (!node) return matIdentity();
    const local = matFromTRS(node.t, node.r, node.s);
    const g = matMultiply(go(node.parentId), local);
    cache.set(boneId, g);
    return g;
  }
  return go(id);
}

/**
 * 이 fbx 안의 (유일한) Geometry 를 사용하는 Model 의 id 를 찾는다 - "메시 노드"다.
 * Geometry 는 Model 이 아니므로 parseModelHierarchy() 의 계층에는 안 잡히지만,
 * 이 메시 노드 자신의 전역 행렬(meshGlobalTransform, 아래)이 스키닝 공식에 필요하다.
 */
export function findMeshModelId(fbxNodes) {
  const { objects, conns } = objectsIndex(fbxNodes);
  const geometry = objects.children.find((o) => o.name === 'Geometry');
  if (!geometry) return null;
  const modelConn = conns.find((c) => c.props[0] === 'OO' && c.props[1] === geometry.props[0]);
  return modelConn ? modelConn.props[2] : null;
}

// ---------- 스킨(클러스터) ----------

/**
 * Skin Deformer 하나(이 부위 파일엔 항상 하나)의 Cluster 들을 읽는다.
 * 각 클러스터: 영향받는 정점 인덱스, 가중치, 바인드 시점 본 전역 행렬(TransformLink).
 *
 * Transform 필드도 같이 읽어 두지만(디버깅용으로 남겨 둔다) 스키닝에는 안 쓴다 -
 * clusterOffsets() 주석 참고. FBX 문서상으로는 "메시의 바인드 시점 전역 행렬이라
 * 클러스터마다 같아야 한다"지만, 이 파일(Blender 익스포터가 낸 FBX)에서는 실제로
 * 클러스터마다 값이 제각각이었다 - 신뢰할 수 없는 필드로 판단했다.
 *
 * boneId 는 "본Model 이 클러스터의 자식으로 연결된 OO 커넥션"으로 찾는다(FBX 관례).
 */
export function parseSkin(fbxNodes) {
  const { objects, conns } = objectsIndex(fbxNodes);
  const skin = objects.children.find((o) => o.name === 'Deformer' && o.props[2] === 'Skin');
  if (!skin) return null;
  const clusterIds = new Set(
    conns.filter((c) => c.props[0] === 'OO' && c.props[2] === skin.props[0]).map((c) => c.props[1]),
  );
  const byId = new Map();
  for (const o of objects.children) byId.set(o.props[0], o);

  const clusters = [];
  for (const clusterId of clusterIds) {
    const node = byId.get(clusterId);
    if (!node || node.props[2] !== 'Cluster') continue;
    const boneConn = conns.find(
      (c) => c.props[0] === 'OO' && c.props[2] === clusterId && byId.get(c.props[1])?.name === 'Model',
    );
    if (!boneConn) continue;
    const boneModel = byId.get(boneConn.props[1]);
    const indexesNode = node.children.find((c) => c.name === 'Indexes');
    const weightsNode = node.children.find((c) => c.name === 'Weights');
    const transformNode = node.children.find((c) => c.name === 'Transform');
    const transformLinkNode = node.children.find((c) => c.name === 'TransformLink');
    if (!indexesNode || !weightsNode || !transformNode || !transformLinkNode) continue;
    clusters.push({
      boneId: boneModel.props[0],
      boneName: stripName(boneModel.props[1]),
      indexes: indexesNode.props[0],
      weights: weightsNode.props[0],
      transform: matFromColumnMajor(transformNode.props[0]),
      transformLink: matFromColumnMajor(transformLinkNode.props[0]),
    });
  }
  return clusters;
}

/**
 * 각 클러스터의 "오프셋 행렬" = inverse(TransformLink) * meshGlobalNow 를 미리
 * 계산해 둔다. 프레임마다 안 변하므로 한 번만 계산한다.
 *
 * meshGlobalNow 는 이 부위 fbx 의 메시 노드 자신의 전역 행렬
 * (findMeshModelId + globalTransformStatic 로 구한다) - Geometry.Vertices(원본
 * 정점)는 메시 노드의 로컬 공간에 있고, TransformLink 는 ×100 스케일에 축이 다시
 * 매겨진(Blender Z-up -> FBX Y-up 변환이 CharacterArmature/Root 본에 박혀 있다)
 * "본 전역 좌표계"에 있다 - 두 좌표계가 다르므로 meshGlobalNow 로 먼저 옮겨야
 * TransformLink 와 같은 자로 잴 수 있다.
 *
 * 스키닝 시(skinAllVertices 참고):
 *   frameMatrix_i = boneGlobal_i(t) * offset_i     (오프셋까지는 "본 전역 좌표계"에 있다)
 *   blended       = (sum_i weight_i * frameMatrix_i * vertex_meshLocal) / sum_i weight_i
 *   skinnedVertex = inverse(meshGlobalNow) * blended   (다시 원본 정점 좌표계로)
 *
 * 왜 이렇게 알아냈는지: Cluster 의 "Transform" 필드(메시의 바인드 시점 전역 행렬로
 * 문서화돼 있다)를 그대로 곱하는 FBX SDK 샘플 공식을 먼저 시도했는데, 이 파일
 * (Blender 익스포터가 낸 FBX)은 클러스터마다 Transform 값이 제각각이었다(같은
 * 스킨이면 같아야 하는데 아니었다 - Blender 익스포터 특유의 값으로 보인다). 대신
 * meshGlobalNow 를 직접 계산해 썼더니: (1) 바인드 포즈 왕복이 오차 0(2041개 정점
 * 전부) 이고, (2) Idle 클립처럼 본이 바인드와 크게 다른 각도로 돌아가 있는 프레임도
 * (예: 위팔이 바인드 대비 85도 이상 돌아간다) 팔 길이 정도의 정상적인 변위를 낸다 -
 * meshGlobalNow 를 안 쓰면 같은 프레임에서 정점이 수십~수백 단위로 튀었다(직접
 * 겪은 버그 - tools/lib/fbxSkin.mjs 개발 중 실측).
 */
export function clusterOffsets(clusters, meshGlobalNow) {
  return clusters.map((c) => ({
    ...c,
    offset: matMultiply(matInvertAffine(c.transformLink), meshGlobalNow),
  }));
}

// ---------- 애니메이션 커브 ----------

/** 1 초 = 46186158000 FBX 틱 - FBX 포맷에 박힌 상수(프레임레이트와 무관하게 고정). */
const FBX_TICKS_PER_SECOND = 46186158000;

function evalCurveAtTicks(curve, ticks) {
  const times = curve.times;
  const values = curve.values;
  if (times.length === 0) return curve.default;
  if (ticks <= times[0]) return values[0];
  if (ticks >= times[times.length - 1]) return values[values.length - 1];
  // 이진 탐색 없이 선형 탐색 - 키 개수가 적어(수십~수백) 문제되지 않는다.
  for (let i = 1; i < times.length; i++) {
    if (ticks <= times[i]) {
      const t0 = times[i - 1], t1 = times[i];
      const v0 = values[i - 1], v1 = values[i];
      const f = t1 === t0 ? 0 : (ticks - t0) / (t1 - t0);
      // 키의 접선(베지어)은 무시하고 선형 보간한다. 이 클립은 키가 촘촘해서
      // (Idle 은 50 프레임 클립에 대부분 매 프레임 키가 있다) 차이가 시각적으로
      // 안 드러난다. baked 프레임 자체도 몇 개로 솎아 다시 보간할 것이므로
      // 원본 커브의 곡률을 완벽히 살릴 필요가 없다.
      return v0 + (v1 - v0) * f;
    }
  }
  return values[values.length - 1];
}

/**
 * 이름이 정확히 일치하는 AnimationStack 하나를 골라, 본별 T/R/S 커브를 읽는다.
 * stackName 은 "CharacterArmature|Idle" 처럼 파이프 뒤 접미사까지 정확히 맞아야
 * 한다(Idle, Idle_Neutral, Idle_Gun 등이 전부 접두사를 공유하므로 시작 문자열만
 * 비교하면 잘못 걸린다).
 */
export function parseAnimationClip(fbxNodes, stackName) {
  const { objects, conns, byId } = objectsIndex(fbxNodes);
  const stack = objects.children.find(
    (o) => o.name === 'AnimationStack' && stripName(o.props[1]) === stackName,
  );
  if (!stack) {
    const names = objects.children.filter((o) => o.name === 'AnimationStack').map((o) => stripName(o.props[1]));
    throw new Error(`AnimationStack '${stackName}' 을 못 찾았다. 있는 것들: ${names.join(', ')}`);
  }
  const props = properties70Of(stack);
  const stopTicks = (props.get('LocalStop') ?? [0])[0];
  const durationSeconds = stopTicks / FBX_TICKS_PER_SECOND;

  const layerConn = conns.find((c) => c.props[0] === 'OO' && c.props[2] === stack.props[0]);
  const layer = byId.get(layerConn.props[1]);
  const curveNodeConns = conns.filter((c) => c.props[0] === 'OO' && c.props[2] === layer.props[0]);

  const AXIS = { X: 0, Y: 1, Z: 2 };
  const CHANNEL_KEY = { T: 't', R: 'r', S: 's' };
  const curvesByBone = new Map();

  for (const cnc of curveNodeConns) {
    const curveNode = byId.get(cnc.props[1]);
    if (!curveNode || curveNode.name !== 'AnimationCurveNode') continue;
    // 커브노드 -> 본(Model) 연결: OP 커넥션의 출발점이 이 커브노드다.
    const modelConn = conns.find((c) => c.props[0] === 'OP' && c.props[1] === curveNode.props[0]);
    if (!modelConn) continue;
    const model = byId.get(modelConn.props[2]);
    if (!model || model.name !== 'Model') continue;
    const channelKey = CHANNEL_KEY[stripName(curveNode.props[1])];
    if (!channelKey) continue;

    let entry = curvesByBone.get(model.props[0]);
    if (!entry) {
      entry = { t: null, r: null, s: null };
      curvesByBone.set(model.props[0], entry);
    }
    const axisCurves = [null, null, null];
    // 커브노드 <- 개별 AnimationCurve(d|X, d|Y, d|Z) 연결: 이 커브노드가 도착점이다.
    const axisConns = conns.filter((c) => c.props[0] === 'OP' && c.props[2] === curveNode.props[0]);
    for (const ac of axisConns) {
      const curveObj = byId.get(ac.props[1]);
      if (!curveObj || curveObj.name !== 'AnimationCurve') continue;
      const axis = AXIS[String(ac.props[3]).split('|')[1]];
      if (axis === undefined) continue;
      const keyTime = curveObj.children.find((c) => c.name === 'KeyTime')?.props[0] ?? [];
      const keyValue = curveObj.children.find((c) => c.name === 'KeyValueFloat')?.props[0] ?? [];
      const defaultValue = curveObj.children.find((c) => c.name === 'Default')?.props[0] ?? 0;
      axisCurves[axis] = { times: keyTime, values: keyValue, default: defaultValue };
    }
    entry[channelKey] = axisCurves;
  }

  return { durationSeconds, curvesByBone };
}

/**
 * 시간 t(초 - 0..durationSeconds 범위로 미리 wrap 해서 넘긴다)에서 본 하나의 로컬
 * T/R/S 를 구한다. 커브가 없는 채널, 축은 hierarchy 의 바인드 값을 그대로 쓴다
 * (애니메이션이 그 본을 건드리지 않는다는 뜻이므로 정지 값이 맞다).
 */
function evaluateLocalTRS(hierarchyNode, curveEntry, tSeconds) {
  const ticks = tSeconds * FBX_TICKS_PER_SECOND;
  const pick = (axes, restAxes) => {
    if (!axes) return restAxes;
    return [0, 1, 2].map((i) => (axes[i] ? evalCurveAtTicks(axes[i], ticks) : restAxes[i]));
  };
  return {
    t: pick(curveEntry?.t, hierarchyNode.t),
    r: pick(curveEntry?.r, hierarchyNode.r),
    s: pick(curveEntry?.s, hierarchyNode.s),
  };
}

/** 애니메이션 시각 t 에서 모든 본의 전역 행렬을 계산한다(FK, 부모가 먼저 계산된다). */
export function computeGlobalTransforms(hierarchy, clip, tSeconds) {
  const cache = new Map();
  function go(boneId) {
    if (boneId === 0) return matIdentity();
    if (cache.has(boneId)) return cache.get(boneId);
    const node = hierarchy.get(boneId);
    if (!node) return matIdentity();
    const curveEntry = clip.curvesByBone.get(boneId);
    const trs = evaluateLocalTRS(node, curveEntry, tSeconds);
    const local = matFromTRS(trs.t, trs.r, trs.s);
    const g = matMultiply(go(node.parentId), local);
    cache.set(boneId, g);
    return g;
  }
  const out = new Map();
  for (const id of hierarchy.keys()) out.set(id, go(id));
  return out;
}

/**
 * offsetClusters(clusterOffsets() 의 결과)와 본 전역 행렬(computeGlobalTransforms())로
 * 정점 하나를 "본 전역 좌표계"에서 스킨한다(clusterOffsets 주석의 blended 단계까지).
 * verts 는 fbx.mjs 의 meshesOf() 가 돌려주는 평탄화된 배열이고 vi 는 그 안의 정점
 * 인덱스다. 최종적으로 원본 정점 좌표계로 되돌리려면 결과에 inverse(meshGlobalNow)
 * 를 곱해야 한다 - skinAllVertices() 가 그것까지 한다.
 */
function skinVertexRaw(verts, vi, offsetClusters, boneGlobals) {
  const x = verts[vi * 3], y = verts[vi * 3 + 1], z = verts[vi * 3 + 2];
  let ax = 0, ay = 0, az = 0, wsum = 0;
  for (const c of offsetClusters) {
    const w = c.vertexWeight?.get(vi);
    if (w === undefined) continue;
    const bg = boneGlobals.get(c.boneId);
    if (!bg) continue;
    const m = matMultiply(bg, c.offset);
    const p = matTransformPoint(m, x, y, z);
    ax += p[0] * w; ay += p[1] * w; az += p[2] * w;
    wsum += w;
  }
  if (wsum < 1e-8) return [x, y, z];
  return [ax / wsum, ay / wsum, az / wsum];
}

/** offsetClusters 에 정점 인덱스 -> 가중치 조회용 Map 을 달아 준다(스킨 계산 전 1회 준비). */
export function indexClustersByVertex(offsetClusters) {
  for (const c of offsetClusters) {
    const map = new Map();
    for (let k = 0; k < c.indexes.length; k++) map.set(c.indexes[k], c.weights[k]);
    c.vertexWeight = map;
  }
  return offsetClusters;
}

/**
 * verts 전체(fbx.mjs meshesOf() 의 평탄화 배열)를 스킨해 새 Float32Array 로 돌려준다.
 * skinVertexRaw() 로 "본 전역 좌표계" 결과를 얻은 뒤 inverse(meshGlobalNow) 를 곱해
 * 원본 정점 좌표계(따라서 이 게임의 나머지 굽기 파이프라인이 기대하는 좌표계)로
 * 되돌린다. 가중치 합이 1인 아핀결합이라 이 마무리 곱을 정점마다 각각 하지 않고
 * (클러스터 개수만큼 반복하지 않고) 블렌딩 결과 하나에 한 번만 곱해도 수학적으로
 * 동일하다.
 */
export function skinAllVertices(verts, offsetClusters, boneGlobals, invMeshGlobalNow) {
  const n = verts.length / 3;
  const out = new Float32Array(verts.length);
  for (let vi = 0; vi < n; vi++) {
    const [bx, by, bz] = skinVertexRaw(verts, vi, offsetClusters, boneGlobals);
    const p = matTransformPoint(invMeshGlobalNow, bx, by, bz);
    out[vi * 3] = p[0];
    out[vi * 3 + 1] = p[1];
    out[vi * 3 + 2] = p[2];
  }
  return out;
}

export const __internal = {
  matIdentity, matMultiply, matFromColumnMajor, matFromTranslation, matFromScale,
  matFromEulerZYXDeg, matFromTRS, matInvertAffine, matTransformPoint,
};
