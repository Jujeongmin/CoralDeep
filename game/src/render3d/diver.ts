// 잠수부.
//
// 몸 전체 움직임(오르내림·기울기·요)은 관절이 아니라 사인파로 만든다. 물에 뜬
// 사람은 팔다리를 휘젓는 게 아니라 천천히 오르내리며 좌우로 기운다. 주기가
// 어긋나는 사인 둘을 겹친다 — 하나만 쓰면 시계추처럼 규칙적이라 기계로 보인다.
// 위급하면 속도와 폭만 커진다.
// (2D 의 diverRig.ts 가 쓰던 규칙 그대로다. 저폴리 모델을 관절로 꺾으면 이음매가
//  벌어져 종이인형이 되므로 그때도 몸 전체로 움직였다.)
//
// 그 위에 diver.glb 에 구워 넣은 Idle 스켈레탈 애니메이션(가슴 호흡, 팔 흔들림 등
// 진짜 관절 움직임)을 정점 단위로 얹는다. 런타임은 스키닝을 하지 않는다 — glb 에
// 이미 몇 프레임의 정점 위치가 미리 스킨되어 들어 있고(tools/bake-diver-glb.mjs),
// 여기서는 두 프레임 사이를 선형보간해 매 프레임 position 버퍼를 다시 쓸 뿐이다.
// 원본 Idle 클립(1.667초)보다 훨씬 느리게 돌린다 — 관절 애니메이션이라기보다
// 물속에서 부유하며 숨쉬는 정도로 읽혀야 한다.
//
// 잠수부는 z=0 이 아니라 카메라 쪽(z>0)에 뜬다 — 3D 캔버스가 보드보다 앞이므로
// 탈출 중에도 타일에 가리려면 카메라와 더 가까워야 한다. screenToPlane() 은 z=0
// 평면 기준이라 그 결과를 그대로 이 깊이에 심으면 자리도 크기도 어긋난다.
// depthScale() 로 되짚어 곱해야 같은 화면 위치·크기가 나온다 — seafloor.ts 가
// 바닥판 구멍에 쓰는 것과 같은 수학이다(depthProjection.ts 상단 주석 참고).

import * as THREE from 'three';

import { sampleAnimFrame, unpackAnimFrames } from './bakedAnim.ts';
import { depthScale, maxIdleBobWorld } from './depthProjection.ts';
import { type GlbAnim, parseGlb } from './glb.ts';
import { type PlaneView, pxToWorld, screenToPlane } from './projection.ts';
import type { DescentPoint } from './types.ts';

import diverUrl from '../assets/sprites3d/diver.glb?url';

/** 잠수부 전신이 칸 몇 개 높이인가 — 수로 폭이 한 칸이라 두 칸 가까이가 맞다 */
export const CELLS_TALL = 1.9;

/**
 * 잠수부 전용 조명·2차 렌더 패스가 쓰는 레이어 번호(0 은 장면 전체가 쓰는 기본
 * 레이어라 손대지 않는다). stage.ts 가 카메라를 매 프레임 이 레이어로 한 번 더
 * 바꿔 잠수부만 다시 그린다 — 이유는 이 파일 아래 keyLight/fillLight 선언부 주석과
 * stage.ts render() 주석에 있다.
 */
export const DIVER_LIGHT_LAYER = 1;

/** 제자리(대기) z — 카메라 쪽으로 당겨 자갈보다 앞에 뜬 것처럼 보이게 한다 */
const HOME_Z = 1.2;
/** 탈출 경로 z — 3D 레이어가 보드 앞이므로 z 만 양수면 타일에 안 가려진다 */
const DESCENT_Z = 1.0;

/**
 * diver.glb 버텍스 바운딩 박스 실측(X extent / Y extent ≈ 0.336, 살짝 올려 잡았다).
 * 대기 중 흔들림이 빈 띠를 넘는지 계산할 때(maxIdleBobWorld) 몸이 기울어도(tilt)
 * 실루엣이 세운 키의 절반을 얼마나 넘길 수 있는지 잡는 데 쓴다.
 */
const MODEL_WIDTH_RATIO = 0.34;

/**
 * Idle 루프 한 바퀴를 재생하는 데 걸리는 시간(초). 원본 클립은 1.667초(30fps
 * 50프레임)로 실제 사람이 서 있는 속도다 — 그대로 틀면 "관절이 움직이는 애니메이션"
 * 으로 읽혀 부유감이 안 산다. 사용자 요청대로 느리게 튼다: 4배 이상 늘려 숨쉬듯
 * 잔잔하게 움직이게 한다. this.t 로 위상을 잡으므로(아래 step()) danger 가 커지면
 * (this.t 자체가 빨리 흐른다) 이 루프도 같이 빨라진다 — "위급하면 속도가 커진다"
 * 는 기존 규칙과 일관된다.
 */
const IDLE_ANIM_LOOP_SECONDS = 7;

export class Diver {
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private mat: THREE.MeshLambertMaterial;
  /** glb 에 구운 Idle 프레임 — 없으면(구버전 등) 정지 포즈로만 그린다. */
  private anim: GlbAnim | null = null;
  /** anim.deltas 를 축마다 Float32 로 미리 풀어 둔 정점 위치들 — framePositions[0] 은 position 그대로. */
  private animFrames: Float32Array[] | null = null;
  /** step() 이 매 프레임 덮어쓰는, geometry 에 붙인 실제 출력 버퍼. */
  private animOut: Float32Array | null = null;
  private t = 0;
  private danger = 0;
  private home = new THREE.Vector3();
  private homeScreen = { x: 0, y: 0 };
  private homeScale = 1;
  /** 대기 중 흔들림이 넘으면 안 되는 world 진폭 상한 — place() 가 빈 띠 크기로 잡는다 */
  private maxBobWorld = 0;
  private descent: DescentPoint | null = null;
  /** load() 가 아직 fetch 중일 때 dispose() 가 불리면 죽은 scene 에 메시를 넣지 않는다 */
  private disposed = false;
  /**
   * 잠수부 전용 조명 둘. stage.ts 의 key(0xdff4ff, 차가운 청백색)·fill(수심 물빛,
   * 이 수심 top≈rgb(46,163,201) 처럼 상당히 청록으로 쏠린다)은 자갈·포식자·광선판
   * 전부가 같이 받는 "장면 조명"이라 여기서 값을 못 바꾼다(과제 요구사항 — 장면
   * 조명은 그대로 둔다). 그래서 잠수부만 따로 밝힐 조명을 새로 만든다.
   *
   * 방향은 장면 key 조명과 같은 벡터(-0.6,1,0.8) — 몸의 음영이 나머지 장면과 다른
   * 방향에서 지는 걸 보면 바로 "따로 논다"는 게 티가 나므로, 색만 데우고 각도는
   * 맞춘다. 세기(1.05)도 장면 key(1.15)와 비슷한 자릿수로 잡아, 잠수부만 유난히
   * 밝거나 어둡게 튀지 않게 한다.
   */
  private keyLight = new THREE.DirectionalLight(0xfff1dc, 1.05);
  /** 그림자 쪽이 완전히 까매지지 않게 받쳐 주는 균일한 데운 채움광. */
  private fillLight = new THREE.AmbientLight(0xffe8cc, 0.42);
  /** dispose() 에서 한 번에 씬에서 지우기 위한 묶음 — stage.ts 의 this.lights 와 같은 패턴. */
  private lights = [this.keyLight, this.fillLight];

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mat.fog = false; // 카메라 코앞(z=1.2)에 떠 있어 깊이 안개를 받으면 오히려 부자연스럽다.

    // --- 잠수부만 따로 조명을 준다: 왜 곱셈 보정도, 덧셈 트릭도 아니고 '자기 조명' 인가 ---
    //
    // 예전엔 두 가지를 다 해봤다.
    //  1) 재질 색조(diffuse 곱)만 데우기 — 실측에서 헬멧 구리색 픽셀이 그대로 0에
    //     가까웠다. diffuse*vColor 는 감쇠 없는 순수 곱셈이라(color_fragment.glsl.js),
    //     라이팅 체인 어딘가가 이미 죽어 있으면 색조를 아무리 틀어도 소용없었다.
    //  2) 그래서 곱셈 체인을 아예 우회해, 정점색을 라이팅·안개·톤매핑·색공간 변환이
    //     다 끝난 마지막 지점(dithering_fragment)에서 그대로 덧셈으로 얹었다(0.9배).
    //     "체인이 뭘 하든 살아남는다"는 게 노림수였는데, 이게 오히려 새 문제다 —
    //     헬멧 바이저(Grey, rgb 63,63,63 — 어둡다)에도 오렌지 액센트(rgb 163,94,49)와
    //     똑같은 절대량을 더하니 원래 있던 밝기 차(대비)가 줄어든다. 이번 과제가
    //     요구하는 "헬멧이 머리와 구분돼야 한다"와 정반대 방향으로 민다.
    //
    // 근본 원인은 재질 쪽이 아니라 잠수부가 장면의 key/fill 조명을 자갈·포식자와
    // 통째로 나눠 쓴다는 것 자체다 — 그 조명은 차가운 청백색(key 0xdff4ff)과 이
    // 수심의 청록 물빛(fill, depthMood 참고)으로 자갈이 "가라앉은 느낌"이 나게
    // 맞춰져 있다. 같은 조명 아래서는 잠수부의 오렌지도 그 색조를 나눠 받는다.
    // 게다가 waterVolume.ts 의 광선판은 depthTest:false + 가산 블렌딩으로, 깊이와
    // 무관하게 항상 불투명 오브젝트 다음에 그려진다(그 파일 주석 참고) — 가운데
    // 광선은 clearBand() 중심(=잠수부 anchor.x)에 서므로 잠수부는 그 청록 가산광도
    // 늘 뒤집어쓴다.
    //
    // "장면 조명은 그대로 두고, 잠수부만 다르게 밝힌다"가 이번 요구사항이므로,
    // 재질 트릭이 아니라 진짜로 조명 자체를 분리한다. three 는 조명 하나가 프레임
    // 전체에서 어떤 오브젝트를 비출지 오브젝트별로 걸러주지 않는다 — 조명이 이번
    // 프레임에 반영될지는 camera.layers 하고만 비교한다(그 조명이 어떤 오브젝트에
    // 실제로 닿을지가 아니다. node_modules/three/src/renderers/webgl/WebGLLights.js
    // 의 setup() 이 렌더당 딱 한 번 불려 장면 전체가 같이 쓰는 uniform 배열을
    // 만든다 — 오브젝트별 필터가 없다. WebGLRenderer.js 의 projectObject() 도
    // object.layers.test(camera.layers) 로만 가른다). 그래서 레이어를 공유하는 것
    // "만으로는" 장면 조명과 뒤섞이지 않게 분리할 수 없고, stage.ts 가 카메라
    // 레이어를 바꿔가며 2차 패스로 잠수부만 다시 그려야 진짜로 분리된다 —
    // stage.ts render() 주석 참고. 여기서는 그 2차 패스가 쓸 잠수부 전용 조명만
    // 만들어 둔다(keyLight/fillLight, 위 필드 선언).
    //
    // 이 조명들도 DIVER_LIGHT_LAYER 에만 놓아, 장면 기본 패스(레이어 0)에서는 아예
    // 안 잡힌다 — 자갈·포식자·광선판·부유물 쪽 밝기는 이 조명과 무관하게 그대로다.
    this.keyLight.position.set(-0.6, 1, 0.8);
    this.keyLight.layers.set(DIVER_LIGHT_LAYER);
    this.fillLight.layers.set(DIVER_LIGHT_LAYER);
    this.scene.add(this.keyLight, this.fillLight);
  }

  async load(): Promise<void> {
    const res = await fetch(diverUrl);
    const mesh = parseGlb(await res.arrayBuffer());
    if (this.disposed) return;
    const g = new THREE.BufferGeometry();
    // position 은 애니메이션이 있으면 매 프레임 덮어쓸 별도 버퍼를 쓴다 — mesh.position
    // 자체(프레임 0, 언퀀타이즈된 기준 자세)는 animFrames[0] 으로 그대로 보존해 둔다.
    this.animOut = mesh.anim ? mesh.position.slice() : mesh.position;
    g.setAttribute('position', new THREE.BufferAttribute(this.animOut, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.color, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    this.geom = g;
    this.anim = mesh.anim;
    this.animFrames = mesh.anim ? unpackAnimFrames(mesh.position, mesh.anim) : null;
    this.mesh = new THREE.Mesh(g, this.mat);
    // 기본 레이어(0)에서 뺀다 — 장면 기본 패스의 카메라는 계속 레이어 0만 보므로
    // 거기서는 안 그려지고, stage.ts 가 2차 패스에서 카메라를 이 레이어로 바꿀
    // 때만(그 프레임엔 keyLight/fillLight 만 활성화된다) 그려진다.
    this.mesh.layers.set(DIVER_LIGHT_LAYER);
    this.mesh.scale.setScalar(this.homeScale);
    this.mesh.position.copy(this.home);
    this.scene.add(this.mesh);
  }

  /**
   * 장면 안 제자리 (탈출 전).
   * @param anchor 화면 px (호출부의 캔버스 로컬 기준 — Stage3D 가 자기 캔버스 기준으로 준다)
   * @param cellPx 대기 크기 기준 칸 px — 이미 빈 띠 높이에 맞춰 줄어 있을 수 있다
   *   (stage.ts 의 클램프 참고).
   * @param camZ 카메라와 z=0 평면 사이 거리(stage.ts 의 CAM_Z). 잠수부가 z=0 이 아닌
   *   HOME_Z 에 있어 원근 보정에 필요하다 — seafloor.ts/waterVolume.ts 와 같은 이유로
   *   하드코딩하지 않고 호출부가 실제 카메라 값을 넘긴다.
   * @param bandHeightPx 잠수부가 들어앉은 빈 띠의 화면 px 높이. 대기 크기가 이 안에
   *   들어오게 이미 잡혀 있어도, 그 위에 얹는 흔들림(step() 의 bob)까지 빈 띠를
   *   넘지 않게 여기서 안전 진폭을 미리 계산해 둔다(maxBobWorld).
   */
  place(
    anchor: { x: number; y: number },
    view: PlaneView,
    screenW: number,
    screenH: number,
    cellPx: number,
    camZ: number,
    bandHeightPx: number,
  ): void {
    this.homeScreen = anchor;
    const k = depthScale(camZ, HOME_Z);
    const p = screenToPlane(anchor.x, anchor.y, screenW, screenH, view);
    this.home.set(p.x * k, p.y * k, HOME_Z);
    this.homeScale = pxToWorld(cellPx * CELLS_TALL, view) * k;
    this.maxBobWorld = maxIdleBobWorld(
      cellPx * CELLS_TALL,
      bandHeightPx,
      MODEL_WIDTH_RATIO,
      camZ,
      HOME_Z,
      view.pxPerWorld,
    );
    if (this.mesh && !this.descent) this.mesh.scale.setScalar(this.homeScale);
  }

  setDescent(
    p: DescentPoint | null,
    view: PlaneView,
    screenW: number,
    screenH: number,
    camZ: number,
  ): void {
    this.descent = p;
    if (!this.mesh || !p) return;
    const k = depthScale(camZ, DESCENT_Z);
    const w = screenToPlane(p.x, p.y, screenW, screenH, view);
    // 3D 레이어가 보드 앞이므로 z 만 양수면 타일에 안 가려진다.
    this.mesh.position.set(w.x * k, w.y * k, DESCENT_Z);
    this.mesh.scale.setScalar(pxToWorld(p.cell * CELLS_TALL, view) * k);
  }

  setDanger(d: number): void {
    this.danger = Math.max(0, Math.min(1, d));
  }

  anchorScreen(): { x: number; y: number } {
    return this.homeScreen;
  }

  step(dt: number): void {
    if (!this.mesh) return;
    this.t += dt * (1 + this.danger * 1.6);
    this.stepAnim();
    if (this.descent) return; // 탈출 중에는 경로가 위치를 쥔다

    const amp = 1 + this.danger * 1.8;
    const bobRaw = Math.sin(this.t * 0.9) * 0.06 + Math.sin(this.t * 0.37) * 0.035;
    // 빈 띠가 좁으면(보드가 화면 대부분을 차지하는 레이아웃) 위급 시 흔들림 폭이
    // 보드를 침범할 수 있다 -- place() 가 잡아둔 상한으로 누른다.
    const bob = Math.max(-this.maxBobWorld, Math.min(this.maxBobWorld, bobRaw * amp));
    const tilt = Math.sin(this.t * 0.6) * 0.09 + Math.sin(this.t * 0.23) * 0.05;
    this.mesh.position.set(this.home.x, this.home.y + bob, this.home.z);
    // 요(y 축 회전)는 세로축을 그대로 두므로 보드 침범과 무관하다 — amp 를 곱해
    // "위급하면 속도·폭만 커진다" 는 규칙만 맞춘다.
    this.mesh.rotation.set(0, Math.sin(this.t * 0.21) * 0.25 * amp, tilt * amp);
  }

  /**
   * 구운 Idle 프레임 중 두 개를 골라 선형보간해 position 버퍼를 다시 쓴다.
   * 탈출 중(descent)에도 계속 돈다 — 몸 전체 위치는 경로가 쥐지만, 숨쉬는 정도의
   * 미세한 움직임까지 멈출 이유는 없다(탈출 중에도 "살아있는" 잠수부로 보인다).
   */
  private stepAnim(): void {
    if (!this.anim || !this.animFrames || !this.animOut || !this.geom) return;
    // this.t 는 절대 감소하지 않으므로(step() 에서 매번 더하기만 한다) % 결과가
    // 항상 [0,1) 안에 든다 — 음수 보정이 필요 없다.
    const phase = (this.t / IDLE_ANIM_LOOP_SECONDS) % 1;
    sampleAnimFrame(this.animFrames, phase, this.animOut);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    if (this.mesh) this.scene.remove(this.mesh);
    // 생성자에서 scene 에 직접 넣은 잠수부 전용 조명 — 여기서 안 지우면 레벨을
    // 재입장할 때마다 씬에 조명이 쌓인다(이 프로젝트가 이미 겪은 종류의 누수).
    for (const l of this.lights) this.scene.remove(l);
    this.geom?.dispose();
    this.mat.dispose();
  }
}
