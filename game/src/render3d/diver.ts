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

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mat.fog = false;
    // 재질 색조(diffuse 곱)만 데운 1라운드 수정은 실측에서 그대로 실패했다
    // (헬멧 구리색 픽셀이 여전히 0에 가까웠다 — 30/44,550). 원인을 셋으로 좁혀
    // node_modules/three/src 를 직접 읽어 하나씩 지웠다:
    //  - fog: WebGLProgram 의 program cache key 가 `useFog = material.fog === true`
    //    로 정확히 갈리므로(WebGLPrograms.js) `mat.fog = false` 는 구조적으로
    //    맞다 — 이것만으로는 설명이 안 된다.
    //  - vColor 도달: color_vertex.glsl.js/color_fragment.glsl.js 를 읽으면
    //    `diffuseColor *= vColor` 는 감쇠 없는 순수 곱셈이고, diver.glb 를
    //    parseGlb() 로 직접 파싱해도(노드에서 재현) 헬멧 정점이 정확히
    //    RGB 186/148/86 로 나온다 — 데이터 자체는 살아있다.
    //  - 그런데 diffuse(재질색)*vColor 는 순수 곱셈이라, 둘 중 하나라도 라이팅
    //    체인 어딘가에서 사실상 0에 가깝게 눌리면 재질 색조를 아무리 틀어도
    //    (배율을 바꿔도) 결과는 그대로 어둡다 — 실측에서 색조 보정이 아무
    //    효과가 없었던 건 이 곱셈 체인 자체가 신뢰할 수 없다는 신호다.
    //  - 게다가 waterVolume.ts 의 광선판은 `depthTest:false` + `transparent`
    //    라(그 파일 주석에 이미 있듯 의도적이다) 항상 불투명 오브젝트 다음에,
    //    깊이 판정 없이 화면에 얹힌다 — 가운데 광선(5장 중 3번째, k=0.5)은
    //    clear.cx(빈 띠 중심)에 회전 없이 서고, 이 x 는 잠수부의 anchor.x 와
    //    같다(둘 다 clearBand() 중심). 즉 잠수부 바로 위에 청록색 가산광이
    //    거의 항상 얹힌다 — 라이팅 체인이 어떻든 그 위에 또 한 겹 물빛이 덮인다.
    // 결론: 곱셈(재질 색조·라이팅)에 기대는 방식은 그 체인 전체가 맞아야
    // 살아남는데, 실측이 두 번 다 이걸 배신했다. 그래서 이번엔 곱셈이 아니라
    // '무슨 일이 있어도 살아남는' 덧셈으로 바꾼다 — 자기 정점색을 재질 조명이
    // 끝난 뒤, fog·톤매핑·컬러스페이스 변환까지 다 지나간 마지막 지점(=
    // dithering_fragment, seafloor.ts 코스틱 패치와 같은 삽입점)에서 그대로
    // 한 번 더 더한다. 이러면 라이팅 체인이 그를 얼마나 눌렀든, 광선판이 위에
    // 얼마나 덮이든(가산 0.05~0.15 opacity 수준은 이 덧셈 앞에서 무시할
    // 수준이다) 그의 진짜 색이 화면에 남는다 — 곱셈에만 기대지 않는다.
    this.mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         // vColor 는 color_pars_fragment 가 이미 선언해 둔 varying 이다(USE_COLOR
         // 가 vertexColors:true 로 항상 켜져 있으므로 여기서 참조해도 안전하다).
         // 0.9 배로 그대로 더한다 — 헬멧처럼 색이 강한 정점은 크게(구리 RGB
         // 186/148/86 근처가 거의 그대로 얹힌다), 어두운 네오프렌 정점(값이
         // 작다)은 조금만 밝아져 구리/네오프렌 대비는 유지된다. 조명에 따른
         // 음영(NdotL)은 이 아래 라이팅 결과에 이미 들어있으므로 그 위에
         // 얹히는 식이라 '조명받는 채로 색이 진하다'로 보이지, 스티커처럼
         // 평평해지지 않는다.
         gl_FragColor.rgb += vColor.rgb * 0.9;`,
      );
    };
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
    this.geom?.dispose();
    this.mat.dispose();
  }
}
