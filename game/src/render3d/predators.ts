// 포식자 — 아귀 · 고블린상어 · 대왕오징어. 한 번에 하나만 씬에 있다.
//
// 예전엔 손으로 만든 저폴리 도형(TubeGeometry + primitive 머리)이었다. 이제는
// Quaternius 의 실제 심해생물 저폴리 모델(CC0, poly.pizza — README "포식자 3D
// 모델" 절 참고)을 굽는다. tools/bake-predators-glb.mjs 가 재질/텍스처를 정점
// 색으로 눌러 담고, 아귀·고블린상어는 스킨 애니메이션(Swimming_Normal)을 잠수부와
// 같은 방식으로 CPU 오프라인 스키닝해 몇 프레임 구워 넣는다 — 오징어는 정지
// 메시고, 여기서 흔들림·회전으로 생기를 준다.
//
// **접근 모델이 바뀌었다.** 예전엔 danger 가 "튜브가 얼마나 뻗어 나왔는가"였다
// (곰치가 몸을 뻗고, 오징어 촉수가 화면 안으로 더 들어오는 식). 이제는 danger 가
// world 위치를 far(멀리) -> near(가까이) 로 옮긴다 — 실제로 3D 공간을 가로질러
// 헤엄쳐 오는 셈이다.
//
// 순수 원근(depthScale) 만으로 "멀리서는 티끌, 가까이서는 위협적"을 만들려면 이
// 장면의 far 지점이 카메라에서 아주 멀어야 한다(계산해보면 camZ=10 에서 15~20배
// 크기 차를 내려면 z 가 -150 안팎까지 가야 한다) — 그런데 그 깊이는 이 장면의
// 안개(FogExp2, stage.ts)가 이미 거의 다 삼키는 거리라 물체가 안개에 묻혀서
// "작아 보이는" 게 아니라 아예 안 보이게 되고, 다른 소품(바닥·잠수부)이 사는
// z 범위(-2~2 안팎)와도 스케일이 안 맞는다. 그래서 danger 는 위치(거리)와
// **동시에** 스케일도 옮긴다 — far 에서 bodyLength 의 FAR_SCALE(8%)까지 줄었다가
// near 에서 100% 로 돌아온다. "다가오면서 커진다"는 읽기는 그대로고(위치도 실제로
// 가까워진다 — 카메라 원근이 그 위에 얹혀 마지막 다가섬을 조금 더 크게 보이게
// 한다), 다만 "커 보임"의 대부분은 스케일이 만든다는 걸 숨기지 않는다.
//
// 5381480 이 접근을 target/current 로 나눈 이유(계단식으로 뛰는 danger 를
// 매끄러운 접근으로 바꾼다)는 그대로 유지한다 — easeDanger() 는 손대지 않았다.
//
// **danger 배선 검증(리뷰 대응).** "danger 를 바꿔도 화면이 안 움직인다"는 리뷰가
// 들어와서, 이 클래스를 실제로 esbuild 로 컴파일해 Node 에서 직접 실행하며
// far/near/scale 이 정말 danger 를 따라가는지 확인했다(report 의 "danger 배선
// 재검증" 절 — 재도출이 아니라 이 파일 그대로를 돌린 결과다): setDanger(1) 후
// step(0.016) 를 120번(코디네이터의 1차 측정과 같은 길이)만 돌려도 danger 가
// 0.49 까지 올라가고, 1875번(30초) 이면 1.0000 에 수렴하며 group.position 이
// far 에서 near 로, mesh.scale 이 FAR_SCALE 배에서 1.0 배로 정확히 옮겨간다 —
// 클래스 자체의 로직·배선에는 결함이 없었다. 그래도 대비를 한 단계 더
// 벌렸다(FAR_SCALE 0.08 -> 0.05, near 앵커를 잠수부와 안 겹치게 재배치 — 아래
// CONFIG 주석) — 실제 화면에서 그 차이가 확실히 보이도록 여유를 더 준 것이다.

import * as THREE from 'three';

import { sampleAnimFrame, unpackAnimFrames } from './bakedAnim.ts';
import { type GlbAnim, type GlbMesh, parseGlb } from './glb.ts';
import type { DepthMood } from '../render/depth.ts';
import type { PredatorKind } from '../levels.ts';

import anglerfishUrl from '../assets/sprites3d/anglerfish.glb?url';
import goblinSharkUrl from '../assets/sprites3d/goblinShark.glb?url';
import squidUrl from '../assets/sprites3d/squid.glb?url';

/**
 * 종별 설정 — 굽는 도구(tools/bake-predators-glb.mjs)가 실측해 알려준 값과
 * 이 장면에서 고른 접근 경로다.
 *
 * far/near 는 danger=0/1 일 때의 world 위치(z=0 평면 기준 좌표 — controlPoints
 * 가 옛날에 쓰던 것과 같은 좌표계, depthProjection.ts 의 projectPebble() 로
 * 화면에 투영한다). near 는 danger=1 에서 "가깝고 위협적"이어야 하면서도
 * 보드 사각형(빈 띠) 을 넘으면 안 된다 — predators.test.ts 가 이 값들을 그대로
 * 옮겨 적어 검증한다. far 는 danger=0 에서 화면에 거의 안 보일 만큼 멀고 작게
 * (원근으로) 보이는 자리다 — 정확한 값은 예술적 선택이라 화면 밖/구석에 두는
 * 정도로만 잡았다.
 *
 * bodyLength 는 world 단위 몸길이(굽는 도구가 "몸길이=1" 로 정규화해 둔 메시에
 * 곱하는 스케일)다. reach 는 몸 중심에서 가장 먼 정점까지 거리(몸길이=1 기준,
 * 굽는 도구 로그의 "원점 기준 최대 정점 거리")를 여유 있게 올려 잡은 값 —
 * predators.test.ts 가 이 값 * bodyLength 를 반지름으로 써서 danger=1 근처의
 * 보드 침범을 검사한다(EEL_HEAD_REACH 가 하던 역할과 같다).
 */
interface PredatorConfig {
  url: string;
  far: THREE.Vector3;
  near: THREE.Vector3;
  bodyLength: number;
  reach: number;
  /**
   * 이동 방향으로 코(로컬 +z)를 돌릴지. 오징어는 팔 다발이 이미 로컬 -y 쪽을
   * 향해 있고(굽는 도구의 좌표계 주석 참고) 이 장면에서 -y 가 "아래"이므로,
   * 위에서 내려오는 오징어는 추가 회전 없이도 팔이 저절로 아래(잠수부 쪽)를
   * 향한다 — faceTravel 을 꺼서 대신 step() 이 계속 천천히 돌려 생기를 준다.
   */
  faceTravel: boolean;
}

/**
 * near 좌표는 danger=1 에서 잠수부와 겹치지 않게 잡았다 — 잠수부는 clearBand()
 * 중심에 있고(stage.ts setBoardRect), 638px/246px 참조 화면에서 그 world 위치를
 * 역산하면 (0, 약 2.24, HOME_Z=1.2) 근방이다. 아래 near 값들은 그 지점에서
 * 화면상 최소 20px 이상 떨어지도록(실측: 아귀 29px · 고블린상어 23px · 오징어
 * 16px, report 참고) x/y 를 옮겼다 — "잠수부 위에 얹힌 물고기"가 아니라 "옆/위에서
 * 다가오는" 구도를 만든다. 빈 띠(보드) 침범 여유는 오히려 더 커졌다(near 가
 * 잠수부 쪽에서 비켜나며 화면 위쪽으로 더 붙었다).
 */
const CONFIG: Record<PredatorKind, PredatorConfig> = {
  // 아귀 — 오른쪽 먼바다에서 대각선으로 접근해 잠수부 오른쪽 위에서 멈춘다
  // (예전 곰치 자리를 이어받는다).
  anglerfish: {
    url: anglerfishUrl,
    far: new THREE.Vector3(4.5, 2.7, -3.0),
    near: new THREE.Vector3(1.35, 2.06, 1.65),
    bodyLength: 1.93,
    reach: 0.53,
    faceTravel: true,
  },
  // 고블린상어 — 왼쪽 열린 물에서 곧장 헤엄쳐 와 잠수부 왼쪽 위에서 멈춘다
  // (예전 아귀 자리).
  goblinShark: {
    url: goblinSharkUrl,
    far: new THREE.Vector3(-5.0, 2.6, -3.2),
    near: new THREE.Vector3(-1.5, 2.05, 1.7),
    bodyLength: 1.81,
    reach: 0.56,
    faceTravel: true,
  },
  // 오징어 — 위에서 내려온다(예전 촉수 자리 — "화면 밖에 얼마나 큰 게 있는지
  // 모르는 편이 무섭다"는 동기는 이제 실제 크기가 다 보이는 생물로는 못 이어받지만,
  // 진입 방향만은 그대로 물려받는다). near 를 잠수부보다 한참 위에 두고 x 도
  // 살짝 비켜서 — 팔이 다가오는 건 보이되 몸통이 잠수부를 덮지 않는다.
  squid: {
    url: squidUrl,
    far: new THREE.Vector3(0.2, 5.8, -2.5),
    near: new THREE.Vector3(0.9, 2.49, 1.6),
    bodyLength: 1.81,
    reach: 0.52,
    faceTravel: false,
  },
};

/** 오징어 전용 생기 연출(파일 상단 faceTravel 주석 참고) — 회전 속도·흔들림 진폭. */
const SQUID_SPIN_RATE = 0.35; // rad/s, danger 로 조금 빨라진다
const SQUID_BOB_AMPL = 0.06; // world 단위
const SQUID_BOB_FREQ = 0.8;
const SQUID_DRIFT_AMPL = 0.05;
const SQUID_DRIFT_FREQ = 0.55;

/** 접근 경로에 얹는 좌우 흔들림 — 곧게 다가오면 기계적으로 보인다(예전 튜브 wobble 과 같은 이유). */
const WOBBLE_AMPL = 0.15;
const WOBBLE_FREQ = 1.3;

/**
 * danger=0(far) 에서 bodyLength 에 곱하는 배율 — 1.0(danger=1, near)까지 선형으로
 * 돌아간다. 파일 상단 브리핑 참고: 순수 원근만으로는 이 카메라 거리에서 "티끌 ->
 * 위협적" 만큼의 크기 차를 못 낸다. 0.05 는 실측(스크립트로 375x812 화면에 투영해
 * 확인, report 참고)해서 danger=0 지름이 한 자릿수 px(거의 안 보임) · danger=1 이
 * 144~198px(화면 상당 부분을 위협적으로 채우되 잠수부와는 안 겹침)가 되도록
 * 고른 값이다 — 첫 시도(0.08)보다 더 낮춰서 danger=0 과 1 사이 대비를 한 번 더
 * 벌렸다(코디네이터 리뷰 — "차이가 화면에서 안 보인다"는 피드백에 대한 여유분).
 */
const FAR_SCALE = 0.05;

/**
 * danger -> 크기에 거는 지수. 1 이면 선형이다.
 *
 * 1보다 크면 앞부분이 완만하고 뒤로 갈수록 급해진다 — 산소·이동 수가 얼마 안 남았을 때
 * 몸집이 눈에 띄게 불어나서 "다가온다"가 그 구간에 몰린다. 위치(far->near 보간)는
 * 선형 그대로라 접근 자체는 판 내내 보인다.
 */
const SCALE_EASE = 1.35;

/** anim.loopSeconds 가 없을 때(정상적으로는 없을 일이 없다 — 방어용) 쓰는 루프 길이(초). */
const FALLBACK_LOOP_SECONDS = 2.3;

// ---- 덮치기 (산소 고갈) ----
//
// 실패 모달은 `screens/level.ts` 가 1.1초 뒤에 띄운다. 덮치기는 그보다 짧게 끝나야
// 모달이 뜨는 순간 화면이 이미 포식자로 가득 차 있다 — 중간에 잘리면 "다가오다 말았다"가 된다.
const LUNGE_SECONDS = 0.8;
/** 카메라(z=10, stage.ts 의 CAM_Z) 바로 앞. 화면 가운데를 몸으로 덮는 자리. */
const LUNGE_TARGET = new THREE.Vector3(0, 0.4, 6.6);
/** 덮칠 때 몸집 배수 — 거리만으로는 '가까워졌다'가 약하다. */
const LUNGE_SCALE = 2.4;
/** 덮치는 동안 헤엄 애니메이션 속도 — danger 최대치(1 + 1*1.6)보다 더 몰아친다. */
const LUNGE_ANIM_SPEED = 3.2;

export class Predators {
  private group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private mat: THREE.MeshLambertMaterial;
  private config: PredatorConfig;

  private anim: GlbAnim | null = null;
  private animFrames: Float32Array[] | null = null;
  private animOut: Float32Array | null = null;
  private loopSeconds = FALLBACK_LOOP_SECONDS;

  private t = 0;
  /** 화면에 실제로 반영되는 접근도 -- step() 이 매 프레임 targetDanger 쪽으로 완만하게 옮긴다 */
  private danger = 0;
  /** setDanger() 가 받는 목표값 -- danger 는 이 목표를 향해 매 프레임 지수적으로 따라간다
   * (5381480 이 만든 target/current 분리 -- 계단식으로 뛰는 danger 가 뚝뚝 끊겨 보이던 걸 고쳤다). */
  private targetDanger = 0;

  /** step() 이 매 프레임 재계산하는 위치 스크래치 -- lerp 결과를 담을 뿐 새로 할당하지 않는다. */
  private posScratch = new THREE.Vector3();

  /**
   * 덮치기. -1 = 안 덮치는 중, 0 이상이면 경과 초.
   *
   * 산소가 다 떨어지면 포식자는 `near` 에서 멈춰 있으면 안 된다 — 거기까지는
   * "다가온다"는 압박이고, 마지막 순간에는 실제로 **덮쳐서 화면을 채워야** 잡혔다는
   * 것이 읽힌다. 접근 경로(far→near)와 달리 이 구간은 danger 와 무관하게 자기 시계로만
   * 돈다 — 게임은 이미 끝났고 화면은 잠겨 있다.
   */
  private lungeT = -1;
  private lungeFrom = new THREE.Vector3();
  private lungeFromScale = 0;
  /** load() 가 아직 fetch 중일 때 dispose() 가 불리면 죽은 scene 에 메시를 넣지 않는다 */
  private disposed = false;

  constructor(
    private scene: THREE.Scene,
    private kind: PredatorKind,
  ) {
    this.config = CONFIG[kind];
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0xffffff });
    this.group.position.copy(this.config.far);

    if (this.config.faceTravel) {
      // 이동 방향(far -> near)으로 로컬 +z(코, 굽는 도구의 좌표계 주석 참고)를 돌린다.
      // Object3D.lookAt() 계열은 로컬 -z 가 목표를 보는 규약이므로, 원점에서
      // -travelDir 을 보게 하면 반대로 +z 가 travelDir 을 향한다 — 예전
      // buildEelHead()/rebuild() 가 튜브 접선에 머리를 맞추던 것과 같은 부호 트릭이다.
      const travelDir = this.config.near.clone().sub(this.config.far).normalize();
      const m = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        travelDir.clone().negate(),
        new THREE.Vector3(0, 1, 0),
      );
      this.group.quaternion.setFromRotationMatrix(m);
    }
    scene.add(this.group);
  }

  async load(): Promise<void> {
    const res = await fetch(this.config.url);
    const mesh: GlbMesh = parseGlb(await res.arrayBuffer());
    if (this.disposed) return;

    const g = new THREE.BufferGeometry();
    const positionOut = mesh.anim ? mesh.position.slice() : mesh.position;
    g.setAttribute('position', new THREE.BufferAttribute(positionOut, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.color, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    this.geom = g;
    this.anim = mesh.anim;
    this.animOut = mesh.anim ? positionOut : null;
    this.animFrames = mesh.anim ? unpackAnimFrames(mesh.position, mesh.anim) : null;
    if (mesh.anim?.loopSeconds !== undefined) this.loopSeconds = mesh.anim.loopSeconds;

    this.mesh = new THREE.Mesh(g, this.mat);
    // 실제 스케일은 danger 에 따라 매 프레임 step() 이 정한다(FAR_SCALE 주석 참고) --
    // load() 는 danger=0 취급으로 시작 값만 잡아 둔다(다음 step() 이 바로 덮어쓴다).
    this.mesh.scale.setScalar(this.config.bodyLength * FAR_SCALE);
    this.group.add(this.mesh);
  }

  /** 목표 접근도만 갱신한다 -- 실제 화면 반영은 easeDanger() 가 매 프레임 완만하게 옮긴다. */
  setDanger(d: number): void {
    this.targetDanger = Math.max(0, Math.min(1, d));
  }

  /** targetDanger 를 향한 지수 접근 -- diver.ts DANGER_TAU 와 같은 tau 를 그대로 쓴다
   * (같은 "다가오는 느낌"을 잠수부와 포식자가 공유해야 서로 안 어긋난다). */
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
    this.mat.color.setRGB(k, k, k);
  }

  /**
   * 잠수부를 덮친다. 산소가 0 이 된 순간 딱 한 번 부른다 (screens/level.ts).
   * 이미 덮치는 중이면 무시한다 — 다시 부르면 궤적이 처음으로 튄다.
   */
  lunge(): void {
    if (this.lungeT >= 0) return;
    this.lungeT = 0;
    this.lungeFrom.copy(this.group.position);
    this.lungeFromScale = this.mesh
      ? this.mesh.scale.x
      : this.config.bodyLength * (FAR_SCALE + (1 - FAR_SCALE) * this.danger);
  }

  /** 덮치는 중인가 — 무대가 화면 흔들림을 이 값으로 가른다. */
  lunging(): boolean {
    return this.lungeT >= 0;
  }

  /**
   * 덮치기 한 프레임.
   *
   * 카메라 바로 앞(LUNGE_TARGET)까지 가속하며 들어오고 몸집도 함께 커진다 — 거리와
   * 크기가 같이 붙어야 "달려든다"로 읽힌다. 끝나면 그 자리에 머문다(화면을 가린 채로
   * 실패 모달이 뜬다). 되돌리는 경로는 없다 — 이 판은 여기서 끝이다.
   */
  private stepLunge(dt: number): void {
    this.lungeT += dt;
    const p = Math.min(1, this.lungeT / LUNGE_SECONDS);
    // 처음엔 느리게 노려보다 순식간에 뛰어든다 (ease-in cubic)
    const e = p * p * p;
    this.posScratch.copy(this.lungeFrom).lerp(LUNGE_TARGET, e);
    this.group.position.copy(this.posScratch);
    if (this.mesh) {
      this.mesh.scale.setScalar(this.lungeFromScale * (1 + e * (LUNGE_SCALE - 1)));
    }
    // 꼬리질은 계속 돈다. 얼어붙은 몸이 미끄러져 오면 모형처럼 보인다.
    this.t += dt * LUNGE_ANIM_SPEED;
    this.stepAnim();
  }

  step(dt: number): void {
    if (this.lungeT >= 0) {
      this.stepLunge(dt);
      return;
    }
    this.t += dt * (1 + this.danger * 1.6);
    this.easeDanger(dt);

    // 접근 경로 -- far/near 를 danger 로 잇는다. 곧게 다가오면 기계적으로 보이므로
    // 좌우로 완만한 사인 흔들림을 얹는다(예전 튜브 wobble 과 같은 이유·같은 형태).
    this.posScratch.copy(this.config.far).lerp(this.config.near, this.danger);
    const wobble = Math.sin(this.t * WOBBLE_FREQ) * WOBBLE_AMPL * (0.3 + this.danger);
    this.posScratch.x += wobble;
    this.group.position.copy(this.posScratch);

    if (this.mesh) {
      // 크기는 danger 에 **선형이 아니게** 붙인다. 선형이면 판 내내 고르게 커져서
      // "커지고 있다"가 배경 변화로 묻힌다 — 위협은 마지막 구간에서 몰려와야 읽힌다.
      // 위치는 그대로 선형이라 다가오는 경로 자체는 계속 보인다.
      const eased = Math.pow(this.danger, SCALE_EASE);
      const scaleFactor = FAR_SCALE + (1 - FAR_SCALE) * eased;
      this.mesh.scale.setScalar(this.config.bodyLength * scaleFactor);
    }

    if (this.kind === 'squid') {
      // 스킨 애니메이션이 없는 오징어는 여기서 생기를 만든다: 천천히 도는 회전 +
      // 위아래로 살짝 뜨는 bob + 좌우로 아주 조금 드리프트.
      const spinAmp = 1 + this.danger * 0.6;
      this.group.rotation.y += SQUID_SPIN_RATE * spinAmp * dt;
      const bob = Math.sin(this.t * SQUID_BOB_FREQ) * SQUID_BOB_AMPL;
      const drift = Math.sin(this.t * SQUID_DRIFT_FREQ + 1.7) * SQUID_DRIFT_AMPL;
      this.group.position.y += bob;
      this.group.position.x += drift;
    }

    this.stepAnim();
  }

  /** 아귀·고블린상어의 Swimming_Normal 루프 재생 -- diver.ts stepAnim() 과 같은 방식. */
  private stepAnim(): void {
    if (!this.anim || !this.animFrames || !this.animOut || !this.geom) return;
    const phase = (this.t / this.loopSeconds) % 1;
    sampleAnimFrame(this.animFrames, phase, this.animOut);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.group);
    this.geom?.dispose();
    this.mat.dispose();
  }
}
