// 자갈 해저 — 보드는 이 더미에 파인 구멍이다.
//
// 레퍼런스의 핵심은 보드 자체가 아니라 '자갈에 파인 불규칙한 구멍이 보드'라는 점이다.
// 2D 때는 칸마다 자갈 34알을 그려 이걸 만들었다. 3D 에서는 알 하나를 InstancedMesh 로
// 수백 개 뿌린다 — 드로우콜 하나로 끝나고, 조명이 알알이 입체감을 만들어 준다.
//
// 알만으로는 화면을 다 못 덮는다(무작위 뿌리기라 알 사이에 틈이 남는다). 그래서
// 알들 뒤에 구멍만 뚫린 바닥판(backing)을 깔아 틈으로 배경이 비치지 않게 막는다.
// 구멍 자리에는 알도 바닥판도 배치하지 않는다 — 거기가 2D 보드다.
//
// 보드는 사각형이 아니다 — 계단·L자·十자·모래시계 같은 불규칙한 모양이고,
// BoardRect(x, y, w, h) 는 그 바운딩 박스일 뿐이다. 바운딩 박스 전체를 구멍으로
// 뚫으면 실제 보드 밖인데 바운딩 박스 안쪽인 칸까지 뚫려 배경이 비친다. 그래서
// 바닥판은 칸 단위 마스크(BoardMask)로 구멍을 낸다 — 지오메트리에 칸마다 Path 를
// 뚫는 대신(리사이즈마다 수십 개를 삼각분할해야 한다) 마스크를 텍스처 한 장에
// 담아 프래그먼트 셰이더에서 discard 한다. 알의 배치 판정도 사각형이 아니라
// 같은 마스크를 쓴다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
// depthScale/scaleHole/projectPebble 는 depthProjection.ts 의 순수 함수다 —
// Seafloor 클래스가 쓰는 TS parameter property 문법을 npm test 의 Node 내장
// strip-only 로더가 못 읽어서, 이 클래스를 안 거치고 그 수학만 테스트할 수 있게
// 별도 파일로 뺐다(depthProjection.ts 상단 주석 참고). 여기서는 그대로 쓰고
// 아래서 다시 내보내 seafloor.ts 의 기존 공개 표면(HoleBox 등)은 그대로 유지한다.
import { depthScale, type HoleBox, projectPebble, scaleHole } from './depthProjection.ts';
import { type PlaneView, pxToWorld } from './projection.ts';

export { depthScale, type HoleBox, projectPebble, scaleHole };

/**
 * 보드의 칸 점유 마스크. BoardRect(types.ts) 의 cols/rows/holes 를 그대로 옮긴
 * 형태다 — 단위 변환이 필요한 x/y/w/h/cell 과 달리 격자 구조라 그대로 넘긴다.
 */
export interface BoardMask {
  cols: number;
  rows: number;
  /** row-major(인덱스 = row * cols + col). true = 보드에 없는 칸(자갈로 채운다). */
  holes: boolean[];
}

/**
 * z=0 좌표 (x, y) 가 보드의 실제 칸(점유된 칸 = 구멍) 위에 있는가.
 *
 * hole 은 마스크가 화면 어디를 덮는지 알려주는 바운딩 박스(z=0 기준), mask 는
 * 그 안에서 칸별 점유 여부다. 좌상단(화면 위쪽 = 월드 y 가 큰 쪽)을 원점 삼아
 * 칸 인덱스를 구한다 — BoardView 의 idx(x, y) = y * cols + x 와 같은 행 순서다.
 */
function occupiesBoardCell(x: number, y: number, hole: HoleBox, mask: BoardMask): boolean {
  if (hole.w <= 0 || hole.h <= 0 || mask.cols <= 0 || mask.rows <= 0) return false;
  const localX = x - (hole.cx - hole.w / 2);
  const localY = hole.cy + hole.h / 2 - y;
  if (localX < 0 || localX >= hole.w || localY < 0 || localY >= hole.h) return false;
  const col = Math.min(mask.cols - 1, Math.floor((localX / hole.w) * mask.cols));
  const row = Math.min(mask.rows - 1, Math.floor((localY / hole.h) * mask.rows));
  return !mask.holes[row * mask.cols + col];
}

/**
 * 원 둘레를 8등분한 단위 벡터 + 중심(0,0) = 9 점. layout() 이 알의 구멍 침범을
 * 판정할 때 알의 화면 투영 원(projectPebble() 의 결과)을 이 점들로 근사해서 쓴다.
 *
 * 예전엔 중심 + 상하좌우 4점(5점)이었다 — 큰 바위가 없던 시절엔 알이 몇 px 짜리
 * 점이라 대각선 사이 빈틈(반지름의 약 29%, r*(1-cos45°))도 무시할 만한 오차였다.
 * 지금은 알 크기 상한이 68px 로 커져서(SMALL/BIG_DIAM_MAX 참고) 그 대각선 빈틈이
 * 수십 px 로 벌어질 수 있다 — 대각선 방향으로 큰 바위가 보드 칸에 삐져 들어가도
 * 5점 판정은 못 잡는다. 8방향(대각선 4개 추가)으로 그 빈틈을 닫는다. layout() 은
 * 리사이즈 때만 도는 저빈도 연산이라 후보당 4점을 더 검사해도 비용은 무시할 만하다.
 */
const CIRCLE_SAMPLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * 알(중심 proj.x, proj.y / 반지름 proj.r, 이미 projectPebble() 로 화면 투영된
 * 값)이 보드 칸을 하나라도 침범하는가 — CIRCLE_SAMPLE_OFFSETS 의 9점으로
 * 원판-폴리곤 교차를 근사한다.
 */
function pebbleOverlapsBoard(
  proj: { x: number; y: number; r: number },
  hole: HoleBox,
  mask: BoardMask,
): boolean {
  for (const [dx, dy] of CIRCLE_SAMPLE_OFFSETS) {
    if (occupiesBoardCell(proj.x + dx * proj.r, proj.y + dy * proj.r, hole, mask)) return true;
  }
  return false;
}

/**
 * 자갈 알 개수.
 *
 * 이전엔 알 하나의 화면 투영 지름이 10~26px 균등분포 하나뿐이었다 — 크기가 다
 * 고만고만해서 알알이 다 비슷해 보이고, 그중 아무것도 시선을 안 붙잡는다는
 * 피드백을 받았다. 지금은 두 갈래다: 대부분(1 - BIG_CHANCE)은 8~18px 잔자갈,
 * 일부(BIG_CHANCE ≈ 10%)는 32~68px 큰 바위 — 실루엣을 깨는 닻 역할이다(아래
 * layout() 참고). 큰 바위가 섞이며 알 하나의 평균 투영 넓이가 예전보다 커졌지만
 * (대략 1.4~1.5배), 그렇다고 밀도가 과해지는 게 문제는 아니다 — 알 사이 틈은
 * 바닥판(backing)이 항상 메우므로, 알의 밀도는 '틈이 안 보이는가'가 아니라
 * '바닥이 알갱이·바위로 덮인 것처럼 보이는가'만 결정한다. 예전 실측(보드 밖
 * 영역 약 95,000px^2 대비 알 520개)에서 이미 40~55% 커버리지가 나왔었고, 평균
 * 넓이가 커진 지금은 그보다 더 빽빽하게 덮인다 — 부족해질 방향이 아니다.
 *
 * COUNT 를 실제로 묶는 건 커버리지가 아니라 삼각형 예산이다: 800개 * 20 삼각형
 * (알 하나 = 저폴리 정이십면체 detail 0) = 16,000 삼각형, 40k 예산에 여유를
 * 남긴다. 크기 분포를 바꿔도 삼각형 수는 그대로다 — 인스턴스 크기는 스케일일
 * 뿐 지오메트리 복잡도가 아니다.
 */
const COUNT = 800;

/**
 * 자갈 크기 분포 (화면 투영 지름, px 기준 — pxToWorld() 로 월드 단위로 바꿔 쓴다).
 * BIG_CHANCE 확률로 큰 바위를, 나머지는 잔자갈을 굴린다 — 균일분포 하나로는
 * 다 고만고만해 보인다는 게 문제였으므로 두 구간을 확실히 떨어뜨려 둔다.
 */
const SMALL_DIAM_MIN = 8;
const SMALL_DIAM_MAX = 18;
const BIG_DIAM_MIN = 32;
const BIG_DIAM_MAX = 68;
const BIG_CHANCE = 0.1;

/**
 * 클러스터 — 완전히 고른 무작위 산포는 '깔린 밭'이 아니라 '흩뿌린 점'으로
 * 읽힌다는 게 두 번째 피드백이었다. 리사이즈마다 중심 몇 개를 미리 뽑아 두고,
 * 알의 CLUSTER_BIAS 만큼을 그 중심 근처(CLUSTER_SPREAD 반경)에 몰아준다 —
 * 나머지는 여전히 화면 전체에 고르게 뿌려 큰 빈틈은 안 남게 한다. 클러스터
 * 중심이 우연히 보드 칸 안에 떨어져도 손해가 아니다 — 그 중심을 쓰려던 시도들만
 * 버려지고(ATTEMPT_MULT 의 20배 여유가 이 정도는 가볍게 흡수한다), 나머지
 * 클러스터·균일 풀이 COUNT 를 채운다.
 */
const CLUSTER_COUNT = 6;
const CLUSTER_BIAS = 0.55;
const CLUSTER_SPREAD = 0.22;

/**
 * 구멍 판정 여유 대비 최대 시도 배수.
 *
 * layout() 은 리사이즈 때만 호출되는 저빈도 연산이라(프레임마다가 아니다) 시도 횟수를
 * 넉넉히 잡아도 비용이 거의 없다. 반면 보드가 화면 대부분을 차지하는 레이아웃에서는
 * 구멍이 뿌릴 영역의 상당 부분을 잡아먹어 3배로는 COUNT 를 다 못 채우고 성기게
 * 끝날 수 있다 — 자갈이 '깔린 밭'이 아니라 '드문드문 뿌린 점'으로 보이는 문제다.
 * 20배면 구멍이 영역의 90% 이상을 덮는 극단적인 경우에도 여유 있게 COUNT 를 채운다.
 */
const ATTEMPT_MULT = 20;

/** 바닥판 z. 알(z -0.2~-1.6)보다 더 뒤에 둬 알에 가려지게 한다. */
const BACKING_Z = -1.8;

/**
 * 바닥판 여유 배율 — depthScale() 로 정확히 보정한 뒤에 얹는 안전 여유분.
 *
 * 반올림·부동소수점 오차로 가장자리에 1px 틈이 남는 걸 막는 정도의 작은 여유다.
 * (이전 버전은 이 값 하나로 원근 축소분까지 떠안으려 했는데 — z=-1.8 이 필요로
 * 하는 약 18% 보정을 30% 여유로 뭉뚱그렸다 — 그러면 여기 없는 배율만큼은
 * 맞아도 구멍의 중심 오프셋은 안 맞는다. 구멍처럼 화면 특정 위치에 정확히
 * 물려야 하는 경계는 크기와 중심을 함께 보정해야 하므로 depthScale() 로 뺐다.)
 */
const BACKING_OVERSCAN = 1.05;

/** 시드 기반 0..1 난수. 프레임마다 같은 배치가 나와야 하므로 Math.random 을 안 쓴다. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export class Seafloor {
  private mesh: THREE.InstancedMesh;
  private geom: THREE.IcosahedronGeometry;
  private mat: THREE.MeshLambertMaterial;
  private backingMesh: THREE.Mesh;
  private backingGeom: THREE.PlaneGeometry;
  private backingMat: THREE.MeshLambertMaterial;
  private maskTex: THREE.DataTexture | null = null;
  private uMask = { value: null as THREE.Texture | null };
  private uMaskOrigin = { value: new THREE.Vector2() };
  private uMaskSize = { value: new THREE.Vector2(1, 1) };
  private uDepthK = { value: 1 };
  private uTime = { value: 0 };
  private uCaustic = { value: 0.5 };

  constructor(private scene: THREE.Scene) {
    // 저폴리 자갈 한 알. detail 0 = 20 삼각형. 800 알이면 16,000 삼각형.
    this.geom = new THREE.IcosahedronGeometry(0.5, 0);
    // vertexColors 는 안 켠다 — 이 지오메트리엔 geometry.attributes.color 가 없다.
    // vertexColors:true 를 켜면 material 셰이더가 존재하지 않는 그 attribute 를
    // 참조하게 되고, WebGL 은 바인딩 안 된 attribute 를 (0,0,0,1) 로 채운다.
    // color_vertex 청크가 vColor *= color 를 하므로 알이 전부 새까맣게 죽는다.
    // 인스턴스 색은 vertexColors 없이도 setColorAt() 만으로 충분하다 — three 가
    // InstancedMesh.instanceColor 유무만 보고 USE_INSTANCING_COLOR 를 따로 켠다.
    this.mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.patchCaustics(this.mat, true);
    this.mesh = new THREE.InstancedMesh(this.geom, this.mat, COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 알 사이 틈을 메우는 바닥판 — 보드 칸 자리만 마스크로 뚫려 있다(아래
    // patchBoardMask 참고). 무작위로 뿌린 알만으로는 화면을 다 못 덮어 틈으로
    // 뒤 배경(CSS 그라디언트)이 비친다. 알보다 한 켜 더 뒤에 깔아 자갈 알들이
    // 그 위에 놓인 것처럼 보이게 한다.
    //
    // 지오메트리는 사각 평면 하나로 고정이다 — 칸마다 구멍을 뚫는 일은 지오메트리가
    // 아니라 마스크 텍스처가 한다(layoutBacking/updateBoardMask 참고). 그래서
    // 이전 버전과 달리 리사이즈(layout() 호출)마다 다시 지을 필요가 없다.
    this.backingMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.patchCaustics(this.backingMat, false, (shader) => this.patchBoardMask(shader));
    this.backingGeom = new THREE.PlaneGeometry(1, 1);
    this.backingMesh = new THREE.Mesh(this.backingGeom, this.backingMat);
    this.backingMesh.position.z = BACKING_Z;
    this.backingMesh.frustumCulled = false;
    scene.add(this.backingMesh);
  }

  /**
   * 코스틱 — 수면이 굴절시킨 빛이 바닥에 그리는 그물무늬.
   * 텍스처 대신 노이즈 두 겹을 겹쳐 만든다. 에셋 0개.
   * onBeforeCompile 은 three 가 내주는 정식 셰이더 개조 지점이다.
   *
   * @param instanced true 면 InstancedMesh 용(월드 좌표에 instanceMatrix 를 곱한다),
   *   false 면 일반 Mesh 용(바닥판 — instanceMatrix 가 없다).
   * @param extra 이 셰이더에 덧붙일 추가 패치(바닥판의 칸 마스크 discard 등).
   *   caustics 패치가 끝난 뒤, 같은 onBeforeCompile 안에서 이어서 돈다 — 두 패치가
   *   같은 `#include` 토큰을 이어 붙여 쓸 수 있다(토큰 자체는 자기 대체문 안에
   *   그대로 남겨두므로 다음 패치도 찾을 수 있다).
   */
  private patchCaustics(
    mat: THREE.MeshLambertMaterial,
    instanced: boolean,
    extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
  ): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uCaustic = this.uCaustic;
      const worldPosLine = instanced
        ? 'vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;'
        : 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${worldPosLine}`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWPos;
           uniform float uTime;
           uniform float uCaustic;
           float wave(vec2 p, float t) {
             return sin(p.x * 3.1 + t) * sin(p.y * 2.7 - t * 0.8);
           }`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           float c = wave(vWPos.xy, uTime * 0.6) + wave(vWPos.xy * 1.9 + 4.0, uTime * 0.37);
           c = smoothstep(0.7, 1.6, c);
           // 색 자체도 낮췄다(0.30/0.55/0.62 -> 0.16/0.30/0.34) — 어두워진 바닥
           // 위에서 코스틱만 예전 세기 그대로면 흰 줄무늬가 배경보다 튀어 다시
           // '밝은 배경'으로 되돌아간다. uCaustic 계수 인하(setMood 참고)와
           // 합쳐서 코스틱은 이제 은은한 그물무늬로만 보인다.
           gl_FragColor.rgb += vec3(0.16, 0.30, 0.34) * c * uCaustic;`,
        );
      extra?.(shader);
    };
  }

  /**
   * 바닥판에 칸 단위로 구멍을 낸다 — 보드가 사각형이 아니라 불규칙한 모양이라
   * (계단·L자·十자 등) 사각 경계만 뚫어서는 안 된다(파일 상단 주석 참고).
   *
   * 칸마다 THREE.Path 를 뚫는 지오메트리 방식도 있지만, 리사이즈(=layout() 호출)
   * 마다 레벨당 수십 개 Path 를 삼각분할해야 해서 비용이 붙는다. 대신 칸 점유
   * 여부를 1 칸 = 1 텍셀짜리 DataTexture(updateBoardMask() 가 굽는다)에 담아
   * 여기서 discard 한다 — 지오메트리는 사각 평면 하나로 고정, 비용은 칸 수와
   * 무관하게 텍스처 조회 한 번이다.
   *
   * uMask 는 z=0 평면 기준 마스크인데 이 프래그먼트는 z=BACKING_Z 에서 그려진다.
   * vWPos 는 이미 BACKING_Z 의 실제 월드 좌표(=z=0 기준의 uDepthK 배)이므로,
   * uDepthK 로 나눠 z=0 기준으로 되돌린 뒤 마스크 UV 를 구한다(layoutBacking() 의
   * depthScale() 보정과 같은 배율, 방향만 반대 — 거기는 z=0 좌표를 심으려고
   * 곱했고 여기는 이미 심어진 좌표를 z=0 기준으로 읽으려고 나눈다).
   */
  private patchBoardMask(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.uMask = this.uMask;
    shader.uniforms.uMaskOrigin = this.uMaskOrigin;
    shader.uniforms.uMaskSize = this.uMaskSize;
    shader.uniforms.uDepthK = this.uDepthK;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uMask;
         uniform vec2 uMaskOrigin;
         uniform vec2 uMaskSize;
         uniform float uDepthK;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `vec2 boardZ0 = vWPos.xy / uDepthK;
         vec2 boardUv = vec2(
           (boardZ0.x - uMaskOrigin.x) / uMaskSize.x,
           (uMaskOrigin.y - boardZ0.y) / uMaskSize.y
         );
         if (boardUv.x >= 0.0 && boardUv.x <= 1.0 && boardUv.y >= 0.0 && boardUv.y <= 1.0) {
           if (texture2D(uMask, boardUv).r > 0.5) discard;
         }
         #include <dithering_fragment>`,
      );
  }

  /**
   * 구멍을 피해 자갈을 뿌리고, 바닥판의 칸 마스크를 새로 굽는다.
   * @param hole 보드의 바운딩 박스 (z=0 월드 좌표, 가운데 원점) — 실제 모양은
   *   사각형이 아니므로 mask 가 그 안에서 어느 칸이 진짜 보드 칸인지 알려준다.
   * @param mask 칸 점유 마스크. BoardRect(types.ts) 의 cols/rows/holes 를 그대로 옮긴다.
   * @param camZ 카메라와 z=0 평면 사이 거리(stage.ts 의 CAM_Z). 바닥판이 z=0 이
   *   아닌 깊이에 있어 원근 보정에 필요하다 — 하드코딩하지 않고 호출부(stage.ts)가
   *   실제로 카메라를 세운 값을 그대로 받아, 그 값이 바뀌어도 저절로 따라가게 한다.
   */
  layout(hole: HoleBox, mask: BoardMask, view: PlaneView, seed: number, camZ: number): void {
    this.layoutBacking(hole, mask, view, camZ);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const color = new THREE.Color();

    // 화면 밖으로 넘치게 깔아 가장자리가 잘린 느낌이 안 나게 한다
    const spanX = view.worldW * 1.15;
    const spanY = view.worldH * 1.15;

    // 클러스터 중심 — 리사이즈(=이 함수 호출)마다 seed 로 새로 뽑는다. 화면 전체
    // span 안에서 고르게 뽑되(클러스터끼리도 뭉치지 않게), 실제로 몇 개가
    // 쓰이는지는 CLUSTER_BIAS 확률로 알마다 갈린다.
    const clusterX: number[] = [];
    const clusterY: number[] = [];
    for (let c = 0; c < CLUSTER_COUNT; c++) {
      clusterX.push((hash01(seed + c * 31.7) - 0.5) * spanX);
      clusterY.push((hash01(seed + c * 53.3) - 0.5) * spanY);
    }

    let n = 0;
    for (let i = 0; i < COUNT * ATTEMPT_MULT && n < COUNT; i++) {
      // 자리 — CLUSTER_BIAS 확률로 클러스터 중심 근처에, 나머지는 화면 전체에
      // 고르게. 완전 균일 산포는 '깔린 밭'이 아니라 '흩뿌린 점'으로 보인다는
      // 피드백이라, 뭉침을 만들되(시선이 갈 자리) 큰 빈틈은 안 남기려 균일 풀도
      // 남겨 둔다.
      let x: number;
      let y: number;
      if (hash01(seed + i * 15.1) < CLUSTER_BIAS) {
        const c = Math.floor(hash01(seed + i * 17.9) * CLUSTER_COUNT) % CLUSTER_COUNT;
        x = clusterX[c] + (hash01(seed + i * 19.3) - 0.5) * spanX * CLUSTER_SPREAD;
        y = clusterY[c] + (hash01(seed + i * 21.7) - 0.5) * spanY * CLUSTER_SPREAD;
      } else {
        x = (hash01(seed + i * 3.1) - 0.5) * spanX;
        y = (hash01(seed + i * 7.7) - 0.5) * spanY;
      }

      // 크기 — BIG_CHANCE 확률로 큰 바위, 나머지는 잔자갈(SMALL/BIG_DIAM_* 참고).
      // 균일분포 하나로는 알알이 다 고만고만해 시선을 못 붙잡는다는 게 피드백이라
      // 두 구간으로 확실히 갈랐다.
      const big = hash01(seed + i * 11.3) < BIG_CHANCE;
      const diamPx = big
        ? BIG_DIAM_MIN + hash01(seed + i * 13.7) * (BIG_DIAM_MAX - BIG_DIAM_MIN)
        : SMALL_DIAM_MIN + hash01(seed + i * 1.3) * (SMALL_DIAM_MAX - SMALL_DIAM_MIN);
      const r = pxToWorld(diamPx, view);
      const z = -0.2 - hash01(seed + i * 5.5) * 1.4;

      // 보드 칸 위면 버린다. 보드는 사각형이 아니므로(계단·L자 등) 바운딩 박스가
      // 아니라 칸 마스크로 판정한다.
      //
      // x, y, r 은 z=0 기준인데 알은 실제로 z(< 0, 카메라에서 더 멀다)에 놓인다.
      // projectPebble() 로 "이 알이 화면에 실제로 찍히는 자리·크기"를 구한 뒤
      // 그걸로 판정해야 한다 — z=0 기준 x, y, r 을 그대로 비교하면 알마다 깊이가
      // 달라 침범량이 들쭉날쭉해진다(round 3 에서 실측한 버그). proj.r 은 이
      // 알(큰 바위 포함)의 실제 화면 반지름이므로, 아래 pebbleOverlapsBoard() 의
      // 9점 판정도 알마다 자기 크기에 맞춰 침범 여부를 본다 — 큰 바위라고 별도
      // 취급하지 않는다.
      const proj = projectPebble(x, y, r, z, camZ);
      if (pebbleOverlapsBoard(proj, hole, mask)) continue;

      pos.set(x, y, z);
      e.set(
        hash01(seed + i * 2.2) * 6.28,
        hash01(seed + i * 4.4) * 6.28,
        hash01(seed + i * 6.6) * 6.28,
      );
      q.setFromEuler(e);
      scl.set(r, r * (0.7 + hash01(seed + i * 8.8) * 0.5), r);
      m.compose(pos, q, scl);
      this.mesh.setMatrixAt(n, m);

      // 심해 암석 톤. 알마다 살짝 흔들어 한 덩어리로 안 보이게 한다 — 다만 폭을
      // 좁게 잡는다(0.2 -> 0.12). 배경이 타일과 겨루면 안 되는데, 알마다 밝기
      // 편차가 크면(원래 0.34~0.54) 밝은 알이 타일만큼 눈에 띄어 버린다. setMood()
      // 의 k 가 depthMood(t) 로 전체 밝기를 낮추는 동안, 이 폭은 그 위에 얹히는
      // '알 사이 내부 대비'만 줄인다 -- 자갈 질감 자체는 남기고 산개비만 죽인다.
      //
      // v(밝기) 범위는 이전과 그대로다 — 어둡게 한 걸 되돌리지 않는다. 대신
      // R/G 채널 비율(hue)을 알마다 살짝 흔든다(고정 0.62/0.78 을 축으로
      // ±0.05 안팎) — '한 가지 색'으로 보인다는 피드백에 대한 답이다. rMul 이
      // 오르면 gMul 은 내리도록 반대로 묶어서(hue, 1-hue) 밝기(v) 자체는 거의
      // 안 흔들리게 했다 — 색조만 바뀌고 전체 밝기 예산은 그대로 지킨다.
      const v = 0.34 + hash01(seed + i * 9.9) * 0.12;
      const hue = hash01(seed + i * 23.1);
      const rMul = 0.58 + hue * 0.1;
      const gMul = 0.74 + (1 - hue) * 0.08;
      color.setRGB(v * rMul, v * gMul, v);
      this.mesh.setColorAt(n, color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * 화면 전체(과대 크기 포함)를 덮는 사각 평면으로 바닥판 크기를 맞추고, 칸
   * 마스크를 다시 굽는다. 지오메트리 자체는 안 바뀐다(생성자에서 한 번만 짓는다) —
   * 바뀌는 건 이 평면의 스케일과 마스크 텍스처 내용뿐이다.
   *
   * hole·view 는 z=0 평면 기준 좌표다. 바닥판은 z=0 이 아니라 BACKING_Z 에 있으므로
   * 그 좌표를 그대로 쓰면 화면에서 어긋난다 — 원근 카메라에서 카메라로부터 먼
   * 평면일수록 같은 화면 위치가 원점에서 더 먼 월드 좌표에 대응하기 때문이다
   * (카메라~평면 거리에 정비례). z=0 기준 좌표를 이 평면에서 같은 화면 위치·크기로
   * 옮기려면 거리 비율 k = (camZ - BACKING_Z) / camZ 를 곱해야 한다.
   */
  private layoutBacking(hole: HoleBox, mask: BoardMask, view: PlaneView, camZ: number): void {
    const k = depthScale(camZ, BACKING_Z);
    this.uDepthK.value = k;

    const halfW = (view.worldW * BACKING_OVERSCAN * k) / 2;
    const halfH = (view.worldH * BACKING_OVERSCAN * k) / 2;
    // PlaneGeometry(1, 1) 은 -0.5..0.5 범위다 — 스케일로 원하는 전체 크기를 낸다.
    this.backingMesh.scale.set(halfW * 2, halfH * 2, 1);

    this.updateBoardMask(hole, mask);
  }

  /**
   * 칸 점유 마스크를 텍스처로 굽는다. 텍셀 하나 = 보드 칸 하나, row-major로
   * BoardRect.holes 와 같은 순서다. 칸 정보가 아직 없으면(레이아웃 확정 전)
   * 전부 0(구멍 없음, 통짜 자갈판)으로 채운다 — 이전의 "구멍 없이 통짜로 둔다"
   * 폴백과 같은 동작이다.
   */
  private updateBoardMask(hole: HoleBox, mask: BoardMask): void {
    // 좌상단(화면 위쪽 = 월드 y 가 큰 쪽)을 원점으로 잡는다 — occupiesBoardCell()
    // 과 같은 규약이라야 알의 판정과 바닥판의 discard 가 같은 칸을 가리킨다.
    this.uMaskOrigin.value.set(hole.cx - hole.w / 2, hole.cy + hole.h / 2);
    this.uMaskSize.value.set(Math.max(hole.w, 1e-6), Math.max(hole.h, 1e-6));

    const ready = hole.w > 0 && hole.h > 0 && mask.cols > 0 && mask.rows > 0;
    const cols = ready ? mask.cols : 1;
    const rows = ready ? mask.rows : 1;
    const data = new Uint8Array(cols * rows);
    if (ready) {
      for (let row = 0; row < mask.rows; row++) {
        for (let col = 0; col < mask.cols; col++) {
          const i = row * mask.cols + col;
          // holes[i] === true 면 보드에 없는 칸(자갈로 채운다) -> 마스크 0(구멍 아님).
          // false 면 보드 칸(구멍) -> 마스크 255(discard).
          data[i] = mask.holes[i] ? 0 : 255;
        }
      }
    }

    this.maskTex?.dispose();
    const tex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
    // 칸 경계가 또렷해야 한다 — 보간(선형 필터)하면 칸 사이 경계가 흐려져
    // 실제로는 없는 부분 침범/부분 구멍이 생긴다.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.maskTex = tex;
    this.uMask.value = tex;
  }

  /**
   * 깊어질수록 바닥을 어둡게 — 2D 의 gloom 과 같은 역할.
   *
   * 실측(라이브 WebGL 픽셀) 기준 얕은 레벨의 평균 밝기가 104, 피크가 192~214 로
   * 나왔다 — 배경이 타일과 밝기를 겨루는 수준이다. 예전 식(1 - gloom*0.75)은
   * gloom 최댓값(STOPS 의 0.9)에서도 k 가 0.325 까지밖에 안 떨어져, 가장 깊은
   * 레벨도 '거의 검다'와는 거리가 멀었다. 새 식은 두 계수(절편·기울기)를 다시
   * 잡아 얕은 레벨(gloom≈0.12)은 k≈0.5, 가장 깊은 레벨(gloom≈0.9)은 k≈0.07 이
   * 되게 한다 — depthMood(t) 가 이미 연속으로 주는 gloom 을 그대로 타므로 30단계
   * 전체에서 계속 매끄럽다. 자갈 자체를 새까맣게 죽이지 않도록(질감은 남아야
   * 한다) 0 근처에서 한 번 더 clamp 한다.
   */
  setMood(mood: DepthMood): void {
    const k = Math.max(0.05, 0.56 - mood.gloom * 0.54);
    this.mat.color.setRGB(k, k, k);
    // 바닥판은 알보다 살짝 더 어둡게 — 알이 그 위에 얹힌 것처럼 도드라져 보인다.
    this.backingMat.color.setRGB(k * 0.8, k * 0.85, k * 0.9);
    // 깊으면 수면 빛이 안 닿으므로 코스틱도 사라진다. 계수 자체도 낮췄다(0.55 ->
    // 0.32) — 어두워진 바닥 위에서도 코스틱 파도(shader 의 uCaustic 곱)가 예전
    // 계수 그대로면 다시 흰 피크를 만들어 어둡게 한 의미가 없어진다.
    this.uCaustic.value = mood.shafts * 0.32;
  }

  step(dt: number): void {
    this.uTime.value += dt;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geom.dispose();
    this.mat.dispose();

    this.scene.remove(this.backingMesh);
    this.backingGeom.dispose();
    this.backingMat.dispose();
    this.maskTex?.dispose();
  }
}
