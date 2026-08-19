// 잠수부.
//
// 대기 중에는 완전히 정지한다 — 몸 전체를 사인파로 오르내리던 예전 방식(둥둥
// 뜨는 연출)은 없앴다. 발은 접지선(보드 윗변)에 고정, 몸통도 그 자리에 그대로
// 선다. 그 위에 diver.glb 에 구워 넣은 Idle 스켈레탈 애니메이션(가슴 호흡, 팔
// 흔들림 등 진짜 관절 움직임)만 정점 단위로 얹는다 — 발끝은 사실상 안 움직이고
// (아래 IDLE_ANIM_LOOP_SECONDS 주석·diver.test.ts 의 실측 참고) 몸통·팔만
// 살아있는 느낌을 준다. 런타임은 스키닝을 하지 않는다 — glb 에 이미 몇 프레임의
// 정점 위치가 미리 스킨되어 들어 있고(tools/bake-diver-glb.mjs), 여기서는 두
// 프레임 사이를 선형보간해 매 프레임 position 버퍼를 다시 쓸 뿐이다.
//
// 탈출(보드를 가로질러 빠져나감) 중에는 같은 방식으로 Walk 클립을 튼다 — 걷는
// 속도는 원본 그대로(Idle 처럼 늘리지 않는다), 이동 방향(화면 좌우)을 보고 몸을
// 그쪽으로 돌린다. Idle<->Walk 전환은 짧게 크로스페이드한다 — stepAnim() 참고.
//
// 잠수부는 z=0 이 아니라 카메라 쪽(z>0)에 뜬다 — 3D 캔버스가 보드보다 앞이므로
// 탈출 중에도 타일에 가리려면 카메라와 더 가까워야 한다. screenToPlane() 은 z=0
// 평면 기준이라 그 결과를 그대로 이 깊이에 심으면 자리도 크기도 어긋난다.
// depthScale() 로 되짚어 곱해야 같은 화면 위치·크기가 나온다 — seafloor.ts 가
// 바닥판 구멍에 쓰는 것과 같은 수학이다(depthProjection.ts 상단 주석 참고).

import * as THREE from 'three';

import { sampleAnimFrame, unpackAnimFrames } from './bakedAnim.ts';
import { depthScale } from './depthProjection.ts';
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
 * Idle 루프 한 바퀴를 재생하는 데 걸리는 시간(초). 원본 클립은 1.667초(30fps
 * 50프레임)로 실제 사람이 서 있는 속도다 — 그대로 틀면 "관절이 움직이는 애니메이션"
 * 으로 읽혀 부유감이 안 산다. 느리게 튼다: 4배 이상 늘려 숨쉬듯 잔잔하게 움직이게
 * 한다. this.t 로 위상을 잡으므로(아래 step()) danger 가 커지면(this.t 자체가
 * 빨리 흐른다) 이 루프도 같이 빨라진다 — "위급하면 속도가 커진다"는 기존 규칙과
 * 일관된다.
 *
 * 발은 이 클립으로도 사실상 안 움직인다 — 구운 프레임을 실측하면 frame0(y=0)
 * 근처 정점들이 루프 전체에서 최대 0.0029(정규화 모델 좌표, 전신 높이=1) 만
 * 움직인다. 전신 높이 82px 기준 약 0.2px — 화면에서 안 보이는 잔류 움직임이다
 * (diver.test.ts 가 이 실측치를 그대로 회귀 검증한다).
 */
const IDLE_ANIM_LOOP_SECONDS = 7;

/**
 * anim.loopSeconds 가 없을 때(정상적으로는 없을 일이 없다 — bake-diver-glb.mjs 가
 * 항상 Walk 클립 원본 길이를 채운다 — 방어용) 쓰는 루프 길이(초). predators.ts 의
 * FALLBACK_LOOP_SECONDS 와 같은 패턴.
 */
const WALK_FALLBACK_LOOP_SECONDS = 1.333;

/**
 * "위급하면 속도가 커진다"는 규칙 — this.t(애니메이션 위상 시계) 가 실제 시간보다
 * 빨리 흐르게 한다. Idle 의 호흡·팔 흔들림뿐 아니라 탈출 중 Walk 보폭에도 그대로
 * 적용된다(같은 this.t 를 공유하므로) — 위급할수록 종종걸음으로 읽힌다.
 */
const DANGER_TIME_SCALE = 1.6;

/** Idle<->Walk 전환에 쓰는 크로스페이드 길이(초). 82px 크기에서는 하드컷도
 * 무난하지만, 두 클립 다 이미 매 프레임 계산해 둔 버퍼라 블렌드가 거의 공짜라서
 * 짧게라도 섞는다 — "갑자기 다른 포즈로 튐" 없이 자세가 이어진다. */
const ANIM_BLEND_SECONDS = 0.2;

/** 이동 방향으로 도는 요(yaw) 의 초당 최대 회전각 — 90도 돌아서는 데 약 0.19초. */
const YAW_TURN_RATE = Math.PI * 2.4;
const HALF_PI = Math.PI / 2;

/**
 * 탈출 중 프레임 간 수평 이동(dx, world 단위)에 거는 저역통과 계수 — 매 프레임
 * (setDescent() 호출마다, 렌더 루프 한 번에 한 번) 이 비율만큼만 새 값 쪽으로
 * 옮긴다. 경로가 칸 경계를 넘는 순간 dx 부호가 잠깐 흔들려도 몸이 파르르 안 돌게
 * 완만히 다듬는다. setDescent() 는 dt 를 안 받으므로(DescentPoint 자체가 이미
 * boardView 의 트윈 진행도라 프레임마다 한 번 불린다는 전제로) 시간 상수가 아니라
 * 호출당 고정 비율을 쓴다.
 */
const FACING_SMOOTH_PER_CALL = 0.25;

export class Diver {
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private mat: THREE.MeshLambertMaterial;
  /** glb 에 구운 Idle 프레임 — 없으면(구버전 등) 정지 포즈로만 그린다. Idle 은 항상
   * IDLE_ANIM_LOOP_SECONDS 로 트므로(walkAnim 과 달리) GlbAnim 자체는 안 들고 있는다. */
  private idleFrames: Float32Array[] | null = null;
  /** glb 에 구운 Walk 프레임 — 탈출 중에만 쓴다. */
  private walkAnim: GlbAnim | null = null;
  private walkFrames: Float32Array[] | null = null;
  /** step() 이 매 프레임 덮어쓰는, geometry 에 붙인 실제 출력 버퍼. */
  private animOut: Float32Array | null = null;
  /** Idle<->Walk 크로스페이드용 임시 버퍼 — load() 에서 한 번만 만든다(매 프레임 할당 금지). */
  private animScratch: Float32Array | null = null;
  /** 지난 프레임에 탈출 중이었는가 — Idle<->Walk 전환 순간을 잡는다. */
  private wasDescending = false;
  /** 크로스페이드 진행도 0..1(1 이면 전환 끝, animOut 클립만 그대로 쓴다). */
  private blendT = 1;
  /** 전환 시작 시점에 몸이 있던 클립 — blendT<1 인 동안 이 클립도 같이 샘플링해 섞는다. */
  private blendFrom: 'idle' | 'walk' = 'idle';
  private t = 0;
  private danger = 0;
  private home = new THREE.Vector3();
  private homeScreen = { x: 0, y: 0 };
  private homeScale = 1;
  private descent: DescentPoint | null = null;
  /** setDescent() 가 프레임마다 관측하는 world x — 이동 방향(facing) 을 재는 데 쓴다.
   * hasPrevDescentWorld 가 false 면 아직 값이 없다(다음 탈출 때 이전 방향이 안
   * 이어지게 매 탈출 시작 때 false 로 되돌린다). 객체 대신 스칼라 두 개로 두는
   * 이유는 setDescent() 가 탈출 내내 매 프레임 불려서다 — per-frame 할당을 피한다.*/
  private prevDescentWorldX = 0;
  private hasPrevDescentWorld = false;
  /** dx 저역통과 결과 — facingTargetYaw 를 정하는 신호. */
  private facingSmoothDx = 0;
  /** 몸이 향해야 할 목표 요(라디안) — step() 이 매 프레임 이 값 쪽으로 완만히 돈다. */
  private facingTargetYaw = 0;
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
    const hasAnim = !!mesh.anims && mesh.anims.length > 0;
    // position 은 애니메이션이 있으면 매 프레임 덮어쓸 별도 버퍼를 쓴다 — mesh.position
    // 자체(프레임 0, 언퀀타이즈된 기준 자세)는 idleFrames[0]/walkFrames[0] 으로 그대로
    // 보존해 둔다.
    this.animOut = hasAnim ? mesh.position.slice() : mesh.position;
    g.setAttribute('position', new THREE.BufferAttribute(this.animOut, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.color, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    this.geom = g;

    const idle = mesh.anims?.find((a) => a.name === 'Idle') ?? null;
    const walk = mesh.anims?.find((a) => a.name === 'Walk') ?? null;
    this.idleFrames = idle ? unpackAnimFrames(mesh.position, idle) : null;
    this.walkAnim = walk;
    this.walkFrames = walk ? unpackAnimFrames(mesh.position, walk) : null;
    // 크로스페이드는 두 클립이 다 있을 때만 뜻이 있다 — 스크래치 버퍼도 그때만 만든다.
    this.animScratch = idle && walk ? mesh.position.slice() : null;

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
   * 장면 안 제자리 (탈출 전). 발(또는 빈 띠 중심)을 anchor 에 그대로 심는다 —
   * 흔들림이 없으므로 여유를 미리 계산해 둘 필요가 없다(예전에는 여기서 접지 안전
   * 여유·흔들림 상한을 함께 잡았다 — e182f33/이번 변경 전 이력 참고).
   * @param anchor 화면 px (호출부의 캔버스 로컬 기준 — Stage3D 가 자기 캔버스 기준으로 준다).
   *   접지 상태면 발이 닿는 접지선(보드 윗변) 그 자체다 — 발이 모델 원점
   *   (y=0, tools/bake-diver-glb.mjs 의 정규화 참고)이라 anchor 를 그대로 심으면
   *   발이 거기 선다. 비접지(빈 띠 중심에 뜬 대체 배치)면 anchor 가 빈 띠 중심이다.
   * @param cellPx 대기 크기 기준 칸 px — 이미 빈 띠 높이에 맞춰 줄어 있을 수 있다
   *   (stage.ts 의 클램프 참고).
   * @param camZ 카메라와 z=0 평면 사이 거리(stage.ts 의 CAM_Z). 잠수부가 z=0 이 아닌
   *   HOME_Z 에 있어 원근 보정에 필요하다 — seafloor.ts/waterVolume.ts 와 같은 이유로
   *   하드코딩하지 않고 호출부가 실제 카메라 값을 넘긴다.
   *
   * 접지 여부(grounded)는 더 이상 인자로 안 받는다 — 흔들림이 있던 시절엔 접지
   * 상태(발이 고정축)와 비접지 상태가 서로 다른 여유 계산식을 썼지만, 흔들림
   * 자체가 없어진 지금은 두 경로가 완전히 같은 식(anchor 를 그대로 심는다)이라
   * 분기가 죽은 코드였다 — 호출부(stage.ts)가 anchor 를 이미 두 경우에 맞게 골라
   * 넘긴다(standAnchorY() 참고).
   */
  place(
    anchor: { x: number; y: number },
    view: PlaneView,
    screenW: number,
    screenH: number,
    cellPx: number,
    camZ: number,
  ): void {
    this.homeScreen = anchor;
    const k = depthScale(camZ, HOME_Z);
    const p = screenToPlane(anchor.x, anchor.y, screenW, screenH, view);
    this.home.set(p.x * k, p.y * k, HOME_Z);

    this.homeScale = pxToWorld(cellPx * CELLS_TALL, view) * k;
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
    if (!this.mesh || !p) {
      this.hasPrevDescentWorld = false; // 다음 탈출 때 방향 이력이 안 이어지게 새로 잰다
      return;
    }
    const k = depthScale(camZ, DESCENT_Z);
    const w = screenToPlane(p.x, p.y, screenW, screenH, view);
    const worldX = w.x * k;
    const worldY = w.y * k;
    // 3D 레이어가 보드 앞이므로 z 만 양수면 타일에 안 가려진다.
    this.mesh.position.set(worldX, worldY, DESCENT_Z);
    this.mesh.scale.setScalar(pxToWorld(p.cell * CELLS_TALL, view) * k);

    // 이동 방향으로 몸을 돌린다 — 화면 좌우(world x)만 본다. 모델은 세로축(Y)
    // 회전만 하므로 화면 위아래로 걷는 방향은 원래 표현할 수 없다(피치가 필요한데
    // 요만 있다) — 그런 구간에서는 마지막으로 알던 좌우 방향을 그대로 유지한다.
    // dx 는 저역통과로 다듬는다 — 경로가 칸 경계를 넘는 순간 부호가 잠깐 흔들려도
    // 몸이 파르르 돌지 않게(FACING_SMOOTH_PER_CALL 주석 참고).
    if (this.hasPrevDescentWorld) {
      const dx = worldX - this.prevDescentWorldX;
      this.facingSmoothDx += (dx - this.facingSmoothDx) * FACING_SMOOTH_PER_CALL;
      if (this.facingSmoothDx > 0) this.facingTargetYaw = HALF_PI;
      else if (this.facingSmoothDx < 0) this.facingTargetYaw = -HALF_PI;
      // 정확히 0(움직임 없음)이면 방금 정한 목표를 그대로 유지한다.
    }
    this.prevDescentWorldX = worldX;
    this.hasPrevDescentWorld = true;
  }

  setDanger(d: number): void {
    this.danger = Math.max(0, Math.min(1, d));
  }

  anchorScreen(): { x: number; y: number } {
    return this.homeScreen;
  }

  step(dt: number): void {
    if (!this.mesh) return;
    this.t += dt * (1 + this.danger * DANGER_TIME_SCALE);
    this.stepAnim(dt);

    if (this.descent) {
      // 탈출 중: 위치·크기는 setDescent() 가 쥔다(이 경로는 보드 rect 를 legitimate
      // 하게 가로지르는 유일한 경우라 침범 불변식 대상이 아니다). 여기서는 이동
      // 방향을 향해 부드럽게 도는 것만 담당한다.
      this.mesh.rotation.y = turnToward(this.mesh.rotation.y, this.facingTargetYaw, dt);
      return;
    }

    // 대기 중: 완전히 정지한다 — 흔들림·기울기·요 전부 없앤다(사용자 요청). 발은
    // place() 가 심어 둔 home 그대로, 몸은 정면(카메라 쪽)을 본다. diver.glb 에
    // 구운 Idle 스켈레탈 애니메이션(stepAnim())만 살아있는 느낌을 준다.
    this.mesh.position.copy(this.home);
    this.mesh.rotation.set(0, 0, 0);
  }

  /**
   * 대기 중엔 Idle, 탈출 중엔 Walk 클립의 구운 프레임을 선형보간해 position 버퍼를
   * 다시 쓴다. 상태가 막 바뀐 직후(blendT<1)에는 두 클립을 같이 샘플링해 짧게
   * 섞는다(ANIM_BLEND_SECONDS) — 이미 매 프레임 클립 하나는 어차피 샘플링해야
   * 하므로, 전환 중 몇 프레임만 하나 더(animScratch) 샘플링해 섞는 비용은 작다.
   */
  private stepAnim(dt: number): void {
    if (!this.animOut || !this.geom) return;

    const descending = this.descent !== null;
    if (descending !== this.wasDescending) {
      this.blendFrom = this.wasDescending ? 'walk' : 'idle';
      this.blendT = 0;
      this.wasDescending = descending;
    }

    this.sampleClip(descending ? 'walk' : 'idle', this.animOut);

    if (this.blendT < 1 && this.animScratch) {
      this.sampleClip(this.blendFrom, this.animScratch);
      this.blendT = Math.min(1, this.blendT + dt / ANIM_BLEND_SECONDS);
      const w = this.blendT; // animOut(목표 클립) 쪽 가중치 — 0 에서 시작해 1 로 자란다
      const out = this.animOut;
      const from = this.animScratch;
      for (let i = 0; i < out.length; i++) out[i] = from[i] * (1 - w) + out[i] * w;
    }

    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** which 클립의 현재 위상을 out 에 샘플링한다. 클립이 없으면(구버전 glb 등) 아무 것도 안 쓴다 —
   * out 은 이전 프레임 내용을 그대로 유지한다(정지 포즈로 남는, 기존과 같은 대체 동작). */
  private sampleClip(which: 'idle' | 'walk', out: Float32Array): void {
    const frames = which === 'idle' ? this.idleFrames : this.walkFrames;
    if (!frames) return;
    const loopSeconds =
      which === 'idle'
        ? IDLE_ANIM_LOOP_SECONDS
        : (this.walkAnim?.loopSeconds ?? WALK_FALLBACK_LOOP_SECONDS);
    // this.t 는 절대 감소하지 않으므로(step() 에서 매번 더하기만 한다) % 결과가
    // 항상 [0,1) 안에 든다 — 음수 보정이 필요 없다.
    const phase = (this.t / loopSeconds) % 1;
    sampleAnimFrame(frames, phase, out);
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

/** current 를 target 쪽으로 초당 YAW_TURN_RATE 라디안까지 돌린다 — 순간 스냅 없이 자연스럽게 튼다. */
function turnToward(current: number, target: number, dt: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const maxStep = YAW_TURN_RATE * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}
