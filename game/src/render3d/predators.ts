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
// (주둥이·눈·이빨은 각각 계산해도 이보다 작다 — 주둥이 0.40, 눈 0.334, 이빨 0.382.
//  아래 눈동자·눈두덩도 마찬가지로 작다 — 눈동자 ≈0.330, 눈두덩 ≈0.330.)

// 곰치 색 — 실패 모달(modals.ts 의 eelArt())이 그리는 곰치 그림과 같은 정체성으로
// 맞춘다. 그 그림은 `assets/sprites/eel-head.svg`·`eel-jaw.svg` 의 SVG 그라디언트다
// (몸통 ehSkin #8fb44e~#2d4a1d, 눈 ehEye #ffe9a1~#9a6206, 입안 ehMouth #54121c~#8c2f3a,
// 이빨 #f4f7f2). "쫓아오던 그 곰치에게 잡혔다"가 읽히려면 장면과 패널이 같은 색이어야
// 하지만, 이쪽은 저폴리 플랫 셰이딩이라 그림자·하이라이트까지 그대로 옮기지 않고
// 대표색만 뽑는다 — 초록 몸통 · 호박색 눈(진한 세로 동공 + 짙은 눈두덩) · 흰 이빨 ·
// 붉은 입안, 넷이면 정체성은 충분하다.
const EEL_GREEN = new THREE.Color(0x5c8433); // ehSkin 그라디언트 중간톤
/** 몸통 정점 색의 꼬리 쪽 끝 — 다른 포식자가 여전히 쓰는 기존 어두운 물빛 톤과 같다.
 * 곰치도 꼬리 쪽은 이 색에 잠기고, 머리로 갈수록 EEL_GREEN 으로 바뀐다(buildEelBodyColors 참고). */
const EEL_GREEN_TAIL = new THREE.Color(0.17, 0.27, 0.31);
const EEL_EYE_IRIS = 0xe8a81f; // ehEye 그라디언트 중간(호박색)
const EEL_EYE_PUPIL = 0x120c04; // ehEye 동공
const EEL_BROW = 0x1e3317; // 그림 속 눈두덩(눈 소켓) 톤
const EEL_MOUTH = new THREE.Color(0x6c2029); // ehMouth 그라디언트 중간(붉은 입안)
const EEL_TEETH = 0xf4f7f2; // 그림의 이빨색
/** 동공(눈알 표면에 얹는 얇은 상자) 반지름과, 눈 중심에서 접선 방향으로 얼마나 앞인가 */
const EEL_PUPIL_RADIUS = 0.022;
const EEL_PUPIL_FORWARD = 0.03;
/** 눈두덩 — 두 눈을 가로지르는 띠 하나로 겸한다(좌우 따로 만들면 드로우콜이 는다) */
const EEL_BROW_SIZE = new THREE.Vector3(0.24, 0.02, 0.05);
const EEL_BROW_OFFSET = new THREE.Vector3(0, EEL_EYE_OFFSET.y + 0.09, EEL_EYE_OFFSET.z - 0.02);

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
  /** 곰치 전용 — 주둥이·아래턱은 몸통과 색이 달라(초록/붉은 입안) 더는 this.mat 을
   * 공유하지 않는다. setMood() 가 밝기 스칼라만 따로 곱하려 참조를 들고 있는다. */
  private eelSnoutMat: THREE.MeshLambertMaterial | null = null;
  private eelJawMat: THREE.MeshLambertMaterial | null = null;
  private t = 0;
  /** 화면에 실제로 반영되는 접근도 -- step() 이 매 프레임 targetDanger 쪽으로 완만하게 옮긴다 */
  private danger = 0;
  /** setDanger() 가 받는 목표값. moves 기반 레벨은 이동마다 1/(총 이동 수)씩 계단으로 뛴다 —
   * 이 값을 곧바로 렌더링에 쓰면 포식자가 뚝뚝 끊겨 다가온다(사용자 지적). danger 는 이
   * 목표를 향해 매 프레임 지수적으로 따라가므로, 계단 하나하나가 부드러운 기울기로 이어진다. */
  private targetDanger = 0;

  constructor(
    private scene: THREE.Scene,
    private kind: PredatorKind,
  ) {
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints(0));
    this.mat = new THREE.MeshLambertMaterial({
      color: 0x2c4450,
      flatShading: true,
      // 곰치만 몸통에 꼬리->머리 정점 색 그라디언트를 쓴다(buildEelBodyColors 참고) —
      // 재질 자체는 그 색 위에 곱해지는 밝기 스칼라로만 쓰이므로 vertexColors 를 켠다.
      // 다른 두 종은 기존처럼 재질 색이 곧 몸 색이다.
      vertexColors: kind === 'eel',
    });
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
      this.buildEelBodyColors();
      this.head = this.buildEelHead();
      this.group.add(this.head);
    }
    // 촉수는 몸통을 끝내 안 보여주는 게 핵심이라(파일 상단 주석) 머리를 안 만든다.
    scene.add(this.group);
  }

  /**
   * 몸통 튜브에 꼬리(어두운 물빛) -> 머리(초록) 정점 색 그라디언트를 굽는다.
   *
   * TubeGeometry 는 항상 같은 순서로 정점을 낸다(node_modules/three/src/geometries/
   * TubeGeometry.js 의 generateBufferData — 바깥 루프가 i=0..tubularSegments, 안쪽
   * 루프가 j=0..radialSegments). i 가 곧 곡선을 따라간 위치(u=i/tubularSegments,
   * 0=꼬리 쪽 첫 제어점 · 1=머리 쪽 끝 제어점)다. TUBE_SEG·TUBE_RADIAL 이 상수라
   * 정점 개수·순서가 프레임마다 안 바뀌므로 — rebuild() 가 매 프레임 다시 쓰는 건
   * position/normal 뿐이다 — 색 attribute 는 여기서 딱 한 번만 굽는다.
   *
   * 머리 근처에 초록이 몰리도록(요청: "머리가 다른 동물에 이어붙인 것처럼 안 보이게")
   * t=sqrt(u) 로 앞쪽에서 빠르게 초록에 다다르게 한다 — u=0.25 지점에서 이미 t=0.5.
   */
  private buildEelBodyColors(): void {
    const radialCount = TUBE_RADIAL + 1;
    const segCount = TUBE_SEG + 1;
    const colors = new Float32Array(segCount * radialCount * 3);
    const c = new THREE.Color();
    for (let i = 0; i < segCount; i++) {
      const u = i / TUBE_SEG;
      const t = Math.sqrt(u);
      c.copy(EEL_GREEN_TAIL).lerp(EEL_GREEN, t);
      for (let j = 0; j < radialCount; j++) {
        const idx = (i * radialCount + j) * 3;
        colors[idx] = c.r;
        colors[idx + 1] = c.g;
        colors[idx + 2] = c.b;
      }
    }
    this.body.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /**
   * 곰치 머리 — 주둥이 + 눈(호박색 홍채 · 세로 동공 · 눈두덩) + 아래턱(붉은 입안) +
   * 이빨 두 개. 실패 모달의 곰치 그림(파일 상단 "곰치 색" 주석 참고)과 같은 팔레트를
   * 쓴다. 전부 저폴리 primitive라 드로우콜 9개(주둥이1 · 홍채2 · 동공2 · 눈두덩1 ·
   * 턱1 · 이빨2)뿐이다. 매 프레임 rebuild() 가 이 그룹 전체를 튜브 끝 제어점에
   * 옮기고 접선으로 돌리기만 한다 — 지오메트리는 여기서 한 번만 만든다.
   */
  private buildEelHead(): THREE.Group {
    const g = new THREE.Group();

    // 주둥이 — 더는 몸통 재질(this.mat)을 공유하지 않는다(몸통은 이제 정점 색
    // 그라디언트를 쓴다). 그라디언트의 머리 쪽 끝 색(EEL_GREEN)을 그대로 들고
    // setMood() 가 몸통과 같은 밝기 스칼라로 맞춰 낮춘다.
    const snoutGeom = new THREE.SphereGeometry(EEL_SNOUT_RADIUS, 8, 6);
    this.eelSnoutMat = new THREE.MeshLambertMaterial({ color: EEL_GREEN, flatShading: true });
    const snout = new THREE.Mesh(snoutGeom, this.eelSnoutMat);
    snout.position.set(0, 0, EEL_SNOUT_FORWARD);
    g.add(snout);
    this.headGeoms.push(snoutGeom);
    this.headMats.push(this.eelSnoutMat);

    // 눈 — 호박색 홍채는 항상 밝게, 물빛에 안 묻히게 MeshBasicMaterial(비조명)로 둔다.
    const eyeGeom = new THREE.SphereGeometry(EEL_EYE_RADIUS, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: EEL_EYE_IRIS });
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.copy(EEL_EYE_OFFSET);
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-EEL_EYE_OFFSET.x, EEL_EYE_OFFSET.y, EEL_EYE_OFFSET.z);
    g.add(eyeR, eyeL);
    this.headGeoms.push(eyeGeom);
    this.headMats.push(eyeMat);

    // 동공 — 홍채 표면에 살짝 앞서 얹는 진한 세로 슬릿. 구체보다 저폴리 예산이
    // 싼 얇은 상자로 대신한다.
    const pupilGeom = new THREE.BoxGeometry(
      EEL_PUPIL_RADIUS * 1.4,
      EEL_PUPIL_RADIUS * 2.6,
      EEL_PUPIL_RADIUS,
    );
    const pupilMat = new THREE.MeshBasicMaterial({ color: EEL_EYE_PUPIL });
    const pupilR = new THREE.Mesh(pupilGeom, pupilMat);
    pupilR.position.set(EEL_EYE_OFFSET.x, EEL_EYE_OFFSET.y, EEL_EYE_OFFSET.z + EEL_PUPIL_FORWARD);
    const pupilL = new THREE.Mesh(pupilGeom, pupilMat);
    pupilL.position.set(
      -EEL_EYE_OFFSET.x,
      EEL_EYE_OFFSET.y,
      EEL_EYE_OFFSET.z + EEL_PUPIL_FORWARD,
    );
    g.add(pupilR, pupilL);
    this.headGeoms.push(pupilGeom);
    this.headMats.push(pupilMat);

    // 눈두덩 — 두 눈을 가로지르는 짙은 띠 하나로 "다크 브로우"를 준다(좌우 따로
    // 만들면 드로우콜만 늘고 이 크기에서는 안 갈린다).
    const browGeom = new THREE.BoxGeometry(EEL_BROW_SIZE.x, EEL_BROW_SIZE.y, EEL_BROW_SIZE.z);
    const browMat = new THREE.MeshBasicMaterial({ color: EEL_BROW });
    const brow = new THREE.Mesh(browGeom, browMat);
    brow.position.copy(EEL_BROW_OFFSET);
    g.add(brow);
    this.headGeoms.push(browGeom);
    this.headMats.push(browMat);

    // 아래턱 — 벌어진 입 안쪽을 암시하는 붉은 톤(그림의 ehMouth 계열).
    const jawGeom = new THREE.BoxGeometry(EEL_JAW_SIZE.x, EEL_JAW_SIZE.y, EEL_JAW_SIZE.z);
    this.eelJawMat = new THREE.MeshLambertMaterial({ color: EEL_MOUTH, flatShading: true });
    const jaw = new THREE.Mesh(jawGeom, this.eelJawMat);
    jaw.position.copy(EEL_JAW_OFFSET);
    g.add(jaw);
    this.headGeoms.push(jawGeom);
    this.headMats.push(this.eelJawMat);

    // 이빨 — 아래턱 윗면에서 위로 돋은 작은 원뿔 두 개(벌어진 턱의 암시).
    const toothGeom = new THREE.ConeGeometry(EEL_TOOTH_RADIUS, EEL_TOOTH_HEIGHT, 3);
    const toothMat = new THREE.MeshBasicMaterial({ color: EEL_TEETH });
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

  /**
   * 목표 접근도만 갱신한다 -- 실제로 화면에 쓰이는 this.danger 는 step() 이 매 프레임
   * 이 목표를 향해 완만하게 옮긴다(easeDanger() 참고). renderScene() 은 플레이어가
   * 움직이거나 목표가 바뀔 때만 불리므로(파일 상단 브리핑), 여기서 즉시 반영해 버리면
   * 그 사이 프레임들은 아무 변화가 없다가 다음 호출에서 한 번에 뛴다 -- 그게 "뚝뚝
   * 끊김"의 정체다.
   */
  setDanger(d: number): void {
    this.targetDanger = Math.max(0, Math.min(1, d));
  }

  /**
   * targetDanger 를 향한 지수 접근 -- dt 에 무관하게 같은 "따라잡는 비율"을 유지한다
   * (프레임마다 고정 비율로 lerp 하면 기기 프레임레이트에 따라 체감 속도가 달라진다).
   * alpha = 1 - e^(-dt/tau) 는 dt->0 일 때 dt/tau 로 수렴해 저프레임레이트에서도
   * 끊기지 않고, dt 가 커도(탭 전환 등) 1을 넘지 않아 오버슈트하지 않는다.
   *
   * tau(시간상수)는 두 갈래다:
   *   - DANGER_TAU(0.5s) -- 평상시. 26수 레벨 기준 한 수당 danger 가 1/26≈3.8% 씩
   *     뛰는데, 그 계단 하나를 95% 따라잡는 데 3*tau=1.5s 걸린다 -- 다음 수가 그보다
   *     빨리 오면(대개 그렇다) 목표가 갱신될 뿐 접근은 끊기지 않고 이어진다. 그러면서도
   *     한 수 안에서는 눈에 보이게 "다가오는 중"으로 읽힐 만큼 빠르다.
   *   - DANGER_TAU_CAUGHT(0.1s) -- targetDanger 가 1(포획)에 닿았을 때. afterMove() 가
   *     danger=1 을 반영한 뒤 350ms 뒤에 실패 모달을 띄운다(level.ts) -- 그 전에 사실상
   *     다 따라잡아야 "모달 뜰 때 아직 반쯤 다가오는 중"이 안 생긴다. tau=0.1s 면
   *     350ms 후 커버리지 1-e^(-3.5)≈97% -- 여유 있게 안전하다.
   */
  private static readonly DANGER_TAU = 0.5;
  private static readonly DANGER_TAU_CAUGHT = 0.1;

  private easeDanger(dt: number): void {
    const tau =
      this.targetDanger >= 0.999 ? Predators.DANGER_TAU_CAUGHT : Predators.DANGER_TAU;
    const alpha = 1 - Math.exp(-dt / tau);
    this.danger += (this.targetDanger - this.danger) * alpha;
  }

  setMood(mood: DepthMood): void {
    const k = 1 - mood.gloom * 0.5;
    if (this.kind === 'eel') {
      // 색상 자체는 몸통 정점 색(buildEelBodyColors)과 머리 파츠 고유 색이 이미
      // 담당한다 — 재질 색은 무채색 밝기 스칼라로만 곱해야 그 아래 색상비가
      // 안 틀어진다(0.17/0.27/0.31 처럼 색이 있는 계수를 곱하면 정점 그라디언트가
      // 다시 청회색 쪽으로 밀린다).
      this.mat.color.setRGB(k, k, k);
      this.eelSnoutMat?.color.copy(EEL_GREEN).multiplyScalar(k);
      this.eelJawMat?.color.copy(EEL_MOUTH).multiplyScalar(k);
    } else {
      this.mat.color.setRGB(0.17 * k, 0.27 * k, 0.31 * k);
    }
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
    this.easeDanger(dt);
    this.rebuild();
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.body.geometry.dispose();
    this.mat.dispose();
    this.lure?.geometry.dispose();
    this.lureMat?.dispose();
    // 머리 부품 재질(주둥이·눈·동공·눈두덩·턱·이빨)은 전부 headMats 에 담겨 있다 —
    // 이제 몸통 재질(this.mat)을 공유하는 부품이 없다(주둥이도 초록 전용 재질을
    // 따로 쓴다). body.geometry.dispose() 가 위에서 이미 몸통에 새로 붙인 color
    // attribute 까지 함께 해제한다.
    for (const geom of this.headGeoms) geom.dispose();
    for (const mat of this.headMats) mat.dispose();
  }
}
