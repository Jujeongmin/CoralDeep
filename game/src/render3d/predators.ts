// 포식자 — 곰치 · 아귀 · 대왕오징어 촉수. 한 번에 하나만 씬에 있다.
//
// 셋의 생김새와 등장 방향은 다르지만 '얼마나 가까워졌는가'는 하나의 값(danger)이다.
//   * 곰치 — 오른쪽 바위굴에서 몸을 뻗는다. 뻗어 나온 길이가 남은 시간이다.
//   * 아귀 — 열린 물에서 헤엄쳐 온다. 유인등이 먼저 보이고 몸은 물빛에 잠겨 있다가
//     가까워져야 드러난다. 얼마나 보이는가가 시간이다.
//   * 촉수 — 위에서 팔 하나만 내려온다. 몸통을 끝내 안 보여주는 게 핵심이다.
//     화면 밖에 얼마나 큰 게 있는지 모르는 편이 다 보여주는 것보다 무섭다.
//
// 2D 때 쓰던 트릭 하나가 필요 없어졌다: danger 가 높을 때 아래턱만 잠수부 위에 한 번 더
// 그리던 것. 3D 는 깊이 버퍼가 알아서 하므로 접근 곡선의 z 를 잠수부보다 앞으로 잡기만
// 하면 잠수부가 위턱과 아래턱 사이에 놓인다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import type { PredatorKind } from '../levels.ts';

/** 튜브 분할 수. 정점 개수가 프레임마다 같아야 버퍼를 재할당하지 않는다. */
const TUBE_SEG = 24;
const TUBE_RADIAL = 6;

// 곰치 머리 — 튜브 끝(제어점 3, 몸을 뻗을수록 카메라 쪽으로 나오는 쪽)에 붙는
// 저폴리 부품 몇 개. 전부 head 그룹의 로컬 좌표(오른쪽=+x, 위=+y, 접선 방향=+z)다.
/** 주둥이(스냅) 반지름과, 그 중심이 앵커(튜브 끝점)에서 접선 방향으로 얼마나 앞인가 */
const EEL_SNOUT_RADIUS = 0.24;
const EEL_SNOUT_FORWARD = 0.16;
/** 눈 반지름과 좌우 대칭 오프셋(오른쪽 눈 기준, 왼쪽은 x 부호만 뒤집는다) */
const EEL_EYE_RADIUS = 0.05;
const EEL_EYE_OFFSET = new THREE.Vector3(0.15, 0.1, 0.22);
/** 아래턱 상자 — 앞으로 내밀어 벌어진 턱을 암시한다 */
const EEL_JAW_SIZE = new THREE.Vector3(0.14, 0.05, 0.22);
const EEL_JAW_OFFSET = new THREE.Vector3(0, -0.12, 0.34);
/** 이빨 — 아래턱 위에 돋은 작은 원뿔 두 개 */
const EEL_TOOTH_RADIUS = 0.03;
const EEL_TOOTH_HEIGHT = 0.07;
const EEL_TOOTH_X = 0.045;

// 머리 부품(주둥이·눈·턱·이빨) 전체가 앵커(head 그룹 원점 = 튜브 끝 제어점)에서
// 얼마나 멀리까지 뻗는가(EEL_HEAD_REACH = 0.5) — predators.test.ts 가 이 값을
// 그대로 옮겨 적어 danger=1 에서도 보드 사각형(빈 띠)을 침범하지 않는지
// 검증한다(파일 상단 클래스 주석과 같은 이유 — parameter property 때문에 두
// 파일이 상수를 각자 들고 있다). 여기서는 상수로 안 두고 주석에만 남긴다(런타임
// 코드에서 안 쓰이는 상수는 noUnusedLocals 에 걸린다). 가장 먼 점은 아래턱의
// 앞쪽 아래 모서리다:
//   forward = EEL_JAW_OFFSET.z + EEL_JAW_SIZE.z/2 = 0.34 + 0.11 = 0.45
//   down    = |EEL_JAW_OFFSET.y| + EEL_JAW_SIZE.y/2 = 0.12 + 0.025 = 0.145
//   side    = EEL_JAW_SIZE.x/2 = 0.07
//   reach   = sqrt(0.45² + 0.145² + 0.07²) ≈ 0.478 -> 여유를 두고 0.5 로 올린다.
// (주둥이·눈·이빨은 각각 계산해도 이보다 작다 — 주둥이 0.40, 눈 0.334, 이빨 0.382.)

// 아귀 머리 — 유인등(lure)만으로는 '튜브에 매달린 구슬'로 읽혀 몸통과 머리가
// 안 갈린다. 작은 주둥이 덩어리 + 눈만 더해 머리 윤곽을 준다(턱·이빨은 아귀
// 특징이 아니라 곰치 쪽에만 둔다). 유인등과 같은 앵커(튜브 끝)를 쓴다.
const ANGLER_SNOUT_RADIUS = 0.16;
const ANGLER_SNOUT_FORWARD = 0.05;
const ANGLER_EYE_RADIUS = 0.04;
const ANGLER_EYE_OFFSET = new THREE.Vector3(0.1, 0.06, 0.14);
// 아귀 머리 최대 반지름(앵커 기준) — 주둥이 forward+radius = 0.05+0.16 = 0.21,
// 눈 |offset|+radius ≈ 0.222. 튜브 반지름 상한(predators.test.ts 의
// MAX_TUBE_RADIUS = 0.38)보다 작으므로 튜브가 이미 검증하는 범위 안에 들어간다 —
// EEL_HEAD_REACH 와 달리 테스트를 따로 늘릴 필요가 없다.

export class Predators {
  private group = new THREE.Group();
  private body: THREE.Mesh;
  private lure: THREE.Mesh | null = null;
  private head: THREE.Group | null = null;
  private headGeoms: THREE.BufferGeometry[] = [];
  private headMats: THREE.Material[] = [];
  private curve: THREE.CatmullRomCurve3;
  private mat: THREE.MeshLambertMaterial;
  private lureMat: THREE.MeshBasicMaterial | null = null;
  private t = 0;
  private danger = 0;

  constructor(
    private scene: THREE.Scene,
    private kind: PredatorKind,
  ) {
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints(0));
    this.mat = new THREE.MeshLambertMaterial({ color: 0x2c4450, flatShading: true });
    this.body = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, TUBE_SEG, 0.28, TUBE_RADIAL, false),
      this.mat,
    );
    this.group.add(this.body);

    if (kind === 'angler') {
      this.lureMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
      this.lure = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.lureMat);
      this.group.add(this.lure);
      this.head = this.buildAnglerHead();
      this.group.add(this.head);
    } else if (kind === 'eel') {
      this.head = this.buildEelHead();
      this.group.add(this.head);
    }
    // 촉수는 몸통을 끝내 안 보여주는 게 핵심이라(파일 상단 주석) 머리를 안 만든다.
    scene.add(this.group);
  }

  /**
   * 곰치 머리 — 주둥이(스냅) + 눈 두 개 + 아래턱 + 이빨 두 개. 전부 저폴리
   * primitive 몇 개라 삼각형 172개, 드로우콜 6개(스냅1 · 눈2 · 턱1 · 이빨2)뿐이다.
   * 매 프레임 rebuild() 가 이 그룹 전체를 튜브 끝 제어점에 옮기고 접선으로
   * 돌리기만 한다 — 지오메트리는 여기서 한 번만 만든다(프레임마다 재할당 금지).
   */
  private buildEelHead(): THREE.Group {
    const g = new THREE.Group();

    // 주둥이 — 몸통 재질(this.mat)을 그대로 써서 setMood() 의 깊이별 어둡기를
    // 자동으로 같이 받는다(따로 관리할 재질을 늘리지 않는다).
    const snoutGeom = new THREE.SphereGeometry(EEL_SNOUT_RADIUS, 8, 6);
    const snout = new THREE.Mesh(snoutGeom, this.mat);
    snout.position.set(0, 0, EEL_SNOUT_FORWARD);
    g.add(snout);
    this.headGeoms.push(snoutGeom);

    // 눈 — 항상 진하게, 물빛에 안 묻히게 MeshBasicMaterial(비조명)로 둔다.
    const eyeGeom = new THREE.SphereGeometry(EEL_EYE_RADIUS, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.copy(EEL_EYE_OFFSET);
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-EEL_EYE_OFFSET.x, EEL_EYE_OFFSET.y, EEL_EYE_OFFSET.z);
    g.add(eyeR, eyeL);
    this.headGeoms.push(eyeGeom);
    this.headMats.push(eyeMat);

    // 아래턱 — 몸통 재질과 같은 톤이면 눈에 안 띄므로 살짝 밝은 안쪽 색을 준다.
    const jawGeom = new THREE.BoxGeometry(EEL_JAW_SIZE.x, EEL_JAW_SIZE.y, EEL_JAW_SIZE.z);
    const jawMat = new THREE.MeshLambertMaterial({ color: 0x8a9a95, flatShading: true });
    const jaw = new THREE.Mesh(jawGeom, jawMat);
    jaw.position.copy(EEL_JAW_OFFSET);
    g.add(jaw);
    this.headGeoms.push(jawGeom);
    this.headMats.push(jawMat);

    // 이빨 — 아래턱 윗면에서 위로 돋은 작은 원뿔 두 개(벌어진 턱의 암시).
    const toothGeom = new THREE.ConeGeometry(EEL_TOOTH_RADIUS, EEL_TOOTH_HEIGHT, 3);
    const toothMat = new THREE.MeshBasicMaterial({ color: 0xe9ecec });
    const toothY = EEL_JAW_OFFSET.y + EEL_JAW_SIZE.y / 2 + EEL_TOOTH_HEIGHT / 2;
    const toothR = new THREE.Mesh(toothGeom, toothMat);
    toothR.position.set(EEL_TOOTH_X, toothY, EEL_JAW_OFFSET.z);
    const toothL = new THREE.Mesh(toothGeom, toothMat);
    toothL.position.set(-EEL_TOOTH_X, toothY, EEL_JAW_OFFSET.z);
    g.add(toothR, toothL);
    this.headGeoms.push(toothGeom);
    this.headMats.push(toothMat);

    return g;
  }

  /**
   * 아귀 머리 — 주둥이 덩어리 + 눈 두 개뿐이다(턱·이빨은 곰치만의 특징으로 남긴다).
   * 유인등(lure)이 이미 앞쪽에 떠 있어 '이게 머리 방향이다'는 알려주지만, 몸통이
   * 시작부터 끝까지 굵기만 다른 튜브라 몸통과 머리가 안 갈리던 문제(물고기가 아니라
   * 관에 매달린 구슬처럼 보임)를 이 두 부품으로 고친다.
   */
  private buildAnglerHead(): THREE.Group {
    const g = new THREE.Group();

    const snoutGeom = new THREE.SphereGeometry(ANGLER_SNOUT_RADIUS, 6, 4);
    const snout = new THREE.Mesh(snoutGeom, this.mat);
    snout.position.set(0, 0, ANGLER_SNOUT_FORWARD);
    g.add(snout);
    this.headGeoms.push(snoutGeom);

    const eyeGeom = new THREE.SphereGeometry(ANGLER_EYE_RADIUS, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.copy(ANGLER_EYE_OFFSET);
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-ANGLER_EYE_OFFSET.x, ANGLER_EYE_OFFSET.y, ANGLER_EYE_OFFSET.z);
    g.add(eyeR, eyeL);
    this.headGeoms.push(eyeGeom);
    this.headMats.push(eyeMat);

    return g;
  }

  /**
   * 접근 곡선의 제어점.
   *
   * y 는 전부 양수다 — 보드는 화면 아래쪽(8번 과제로 바닥 정렬)에 있고 3D 는 보드를
   * 침범하면 안 된다. z 는 danger 가 커질수록 카메라 쪽(양수)으로 다가온다 —
   * depthProjection.ts 의 depthScale() 때문에 카메라에 가까운 점일수록 화면에는 y 가
   * 원점에서 더 멀리(위로) 찍힌다. 즉 이 곡선은 다가올수록 실제로도 화면에서 더
   * 위쪽(빈 띠 안쪽)으로 밀린다 — predators.test.ts 가 이 값들을 그대로 옮겨 적어
   * depthProjection.ts 의 projectPebble() 로 danger=1 에서도 보드 사각형을 침범하지
   * 않는지 검증한다(diver.test.ts 가 diver.ts 의 상수를 옮겨 적는 것과 같은 이유 —
   * 이 클래스도 parameter property 를 써서 npm test 의 Node 내장 strip-only 로더로
   * 못 읽는다).
   *
   * @param k 접근도 0..1
   */
  private controlPoints(k: number): THREE.Vector3[] {
    const reach = k;
    switch (this.kind) {
      case 'eel':
        return [
          new THREE.Vector3(4.2, 2.2, -1.5),
          new THREE.Vector3(4.2 - 1.6 * reach, 2.1, -1.0),
          new THREE.Vector3(4.2 - 3.2 * reach, 1.8, -0.2 + 1.4 * reach),
          new THREE.Vector3(4.2 - 4.6 * reach, 1.6, 0.2 + 1.6 * reach),
        ];
      case 'angler':
        return [
          new THREE.Vector3(-4.5, 3.0, -3.0),
          new THREE.Vector3(-3.0 + 1.2 * reach, 2.8, -2.2 + 0.8 * reach),
          new THREE.Vector3(-1.6 + 1.4 * reach, 2.4, -1.0 + 1.4 * reach),
          new THREE.Vector3(-0.4 + 0.6 * reach, 2.0, 0.2 + 1.4 * reach),
        ];
      case 'tentacle':
      default:
        return [
          new THREE.Vector3(1.4, 5.8, -2.0),
          new THREE.Vector3(1.2, 4.8 - 0.9 * reach, -1.2),
          new THREE.Vector3(0.7, 3.8 - 1.2 * reach, -0.2 + 1.0 * reach),
          new THREE.Vector3(0.2, 2.8 - 1.0 * reach, 0.4 + 1.4 * reach),
        ];
    }
  }

  setDanger(d: number): void {
    this.danger = Math.max(0, Math.min(1, d));
  }

  setMood(mood: DepthMood): void {
    const k = 1 - mood.gloom * 0.5;
    this.mat.color.setRGB(0.17 * k, 0.27 * k, 0.31 * k);
    if (this.lureMat) {
      this.lureMat.color.setRGB(
        mood.glowColor[0] / 255,
        mood.glowColor[1] / 255,
        mood.glowColor[2] / 255,
      );
    }
  }

  /**
   * 곡선을 갱신하고 정점만 다시 계산한다.
   *
   * TubeGeometry 를 매 프레임 새로 만들면 안 된다 — 초당 60개씩 지오메트리를 할당하고
   * GPU 버퍼를 통째로 다시 올리게 된다. 세그먼트 수가 고정이라 정점 개수는 안 변하므로,
   * 같은 규격으로 한 번 만들어 두고 position 속성만 덮어쓴다.
   */
  private rebuild(): void {
    // 뻗어 나온 길이가 남은 시간이다. 흔들림은 주기가 어긋난 사인이 만든다.
    const wobble = Math.sin(this.t * 1.3) * 0.12 * (0.3 + this.danger);
    const pts = this.controlPoints(this.danger);
    for (let i = 1; i < pts.length; i++) pts[i].x += wobble * i * 0.3;
    this.curve.points = pts;

    const radius = 0.28 + this.danger * 0.1;
    const next = new THREE.TubeGeometry(this.curve, TUBE_SEG, radius, TUBE_RADIAL, false);
    const src = next.getAttribute('position') as THREE.BufferAttribute;
    const dst = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    (dst.array as Float32Array).set(src.array as Float32Array);
    dst.needsUpdate = true;
    const sn = next.getAttribute('normal') as THREE.BufferAttribute;
    const dn = this.body.geometry.getAttribute('normal') as THREE.BufferAttribute;
    (dn.array as Float32Array).set(sn.array as Float32Array);
    dn.needsUpdate = true;
    this.body.geometry.computeBoundingSphere();
    next.dispose();

    if (this.lure) this.lure.position.copy(this.curve.getPoint(1));

    // 머리는 튜브 끝 제어점(t=1)에 붙어 같이 뻗어 나온다 — 곰치는 뻗을수록,
    // 아귀는 헤엄쳐 올수록 머리가 몸통 끝을 그대로 따라간다. 접선 방향으로
    // 돌려야 주둥이가 진행 방향을 보므로, lookAt 의 기본 규약(로컬 -z 가 목표를
    // 본다)에 맞춰 목표점을 tip - tangent 로 잡는다(그래야 로컬 +z, 즉 머리
    // 부품들이 쓰는 '앞' 축이 tangent 방향을 향한다).
    if (this.head) {
      const tip = this.curve.getPoint(1);
      const tangent = this.curve.getTangent(1);
      this.head.position.copy(tip);
      this.head.lookAt(tangent.multiplyScalar(-1).add(tip));
    }
  }

  step(dt: number): void {
    this.t += dt;
    this.rebuild();
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.body.geometry.dispose();
    this.mat.dispose();
    this.lure?.geometry.dispose();
    this.lureMat?.dispose();
    // 머리 부품 중 주둥이는 this.mat(몸통 재질)을 그대로 쓰므로 위에서 이미
    // 해제됐다 — headGeoms/headMats 는 머리 전용으로 새로 만든 것들만 담는다.
    for (const geom of this.headGeoms) geom.dispose();
    for (const mat of this.headMats) mat.dispose();
  }
}
