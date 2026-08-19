// FBX 재질(Material) 색 읽기.
//
// fbx.mjs 의 meshesOf() 는 지오메트리 전용이다(파일 상단 주석 참고) - 다만 폴리곤당
// "이 폴리곤이 재질 슬롯 몇 번을 쓰는가"(LayerElementMaterial)는 Geometry 노드
// 자신의 자식이라 그쪽에서 값싸게 읽어 triMaterial 로 돌려준다. 그 슬롯 번호가
// 실제로 어떤 색인지는 또 다른 이야기다 - 재질 정의(Objects/Material,
// Properties70 안의 DiffuseColor)와 "이 메시가 재질을 어떤 순서로 물고 있는가"
// (Connections 의 OO 커넥션, Material -> Model)를 조합해야 한다. fbxSkin.mjs 가
// 스킨(클러스터·본)을 파서 위에 따로 얹은 것과 같은 이유로, 재질도 여기 별도
// 파일로 얹는다 - meshesOf() 를 계속 "지오메트리만" 알게 유지한다.
//
// 텍스처(Texture/Video 노드)는 SpaceSuit 네 부위 어디에도 없다(직접 확인함 -
// bake-diver-glb.mjs 개정 기록 참고) - 색은 전부 Material 의 flat DiffuseColor 다.

function findAll(nodes, name, out = []) {
  for (const n of nodes) {
    if (n.name === name) out.push(n);
    findAll(n.children, name, out);
  }
  return out;
}

// FBX 오브젝트 이름은 "표시이름\0클래스이름" 형태다 - fbxSkin.mjs 의 stripName() 과
// 같은 규칙.
const NAME_SEPARATOR = String.fromCharCode(0);
const stripName = (raw) => String(raw).split(NAME_SEPARATOR)[0];

function diffuseColorOf(materialNode) {
  const p70 = materialNode.children.find((c) => c.name === 'Properties70');
  if (!p70) return null;
  const p = p70.children.find((c) => c.props[0] === 'DiffuseColor');
  if (!p) return null;
  // P 프로퍼티 레이아웃: [이름, 타입, 라벨, 플래그, 값...] - 색은 뒤 3개(r,g,b).
  return [p.props[4], p.props[5], p.props[6]];
}

/**
 * meshModelId(fbxSkin.mjs 의 findMeshModelId() 로 구한 "메시 노드" id)에 연결된
 * 재질들을, LayerElementMaterial 의 슬롯 순서 그대로 돌려준다.
 *
 * 슬롯 순서 = Connections 안에서 "Material -> meshModelId" OO 커넥션이 나열되는
 * 순서. FBX 익스포터(Blender)가 이 순서를 곧 머티리얼 슬롯 인덱스로 쓰므로,
 * meshesOf() 가 돌려준 triMaterial 의 값과 이 배열의 인덱스가 그대로 대응한다.
 *
 * 색은 리니어(0..1) 그대로 돌려준다 - 감마 변환은 호출자 몫이다(color.mjs 의
 * linearToSrgb, 정점별로 평균을 낸 *뒤에* 한 번만 적용해야 한다 - 평균 전에
 * 감마를 걸면 밝기가 이중으로 왜곡된다).
 */
export function materialPaletteOf(fbxNodes, meshModelId) {
  const materials = findAll(fbxNodes, 'Material');
  const byId = new Map();
  for (const m of materials) {
    const color = diffuseColorOf(m);
    if (color) byId.set(m.props[0], { name: stripName(m.props[1]), color });
  }
  const connsNode = findAll(fbxNodes, 'Connections')[0];
  const conns = connsNode ? connsNode.children : [];
  const palette = [];
  for (const c of conns) {
    if (c.props[0] === 'OO' && c.props[2] === meshModelId && byId.has(c.props[1])) {
      palette.push(byId.get(c.props[1]));
    }
  }
  return palette;
}
