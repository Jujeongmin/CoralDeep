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
 * 자갈 알 개수.
 *
 * 알 하나의 화면 투영 지름은 10~26px (아래 layout() 참고), 평균 넓이는
 * pi * mean((d/2)^2), d ~ Uniform[10,26] 로 계산하면 약 271px^2 이다.
 * 실측 결과(보드 밖 영역 약 95,000px^2 대비 알 520개, 밀도 520*271/95000 ≈ 1.48)에서
 * 커버리지가 40~55% 로 나왔다 — 겹침을 허용하는 무작위 배치의 이론적 기대치
 * (Boolean 모델, coverage = 1 - e^-density ≈ 77%) 보다 상당히 낮다. 다각체(정이십면체)
 * 를 무작위로 굴려 투영하면 외접원보다 실루엣이 작기 때문으로 보인다.
 *
 * 이제 알 사이 틈은 바닥판(backing)이 메우므로 알만으로 100% 를 채울 필요는
 * 없다 — 알의 밀도는 '틈이 안 보이는가'가 아니라 '바닥이 알갱이로 덮인 것처럼
 * 보이는가'를 결정한다. Boolean 모델로 커버리지 90% 를 목표로 역산하면
 * density = -ln(0.1) ≈ 2.3, COUNT = 2.3 * 95000 / 271 ≈ 807 — 800으로 반올림한다.
 * (실측 효율이 이론보다 낮았던 만큼 실제 알만의 커버리지는 이보다 낮게 나올 수
 * 있지만, 바닥판이 있으므로 그래도 틈은 생기지 않는다.)
 * 800개 * 20 삼각형 = 16,000 삼각형 — 40k 예산에 여유를 남긴다.
 */
const COUNT = 800;

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
           gl_FragColor.rgb += vec3(0.30, 0.55, 0.62) * c * uCaustic;`,
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

    let n = 0;
    for (let i = 0; i < COUNT * ATTEMPT_MULT && n < COUNT; i++) {
      const x = (hash01(seed + i * 3.1) - 0.5) * spanX;
      const y = (hash01(seed + i * 7.7) - 0.5) * spanY;
      const r = pxToWorld(10 + hash01(seed + i * 1.3) * 16, view);
      const z = -0.2 - hash01(seed + i * 5.5) * 1.4;

      // 보드 칸 위면 버린다. 보드는 사각형이 아니므로(계단·L자 등) 바운딩 박스가
      // 아니라 칸 마스크로 판정한다.
      //
      // x, y, r 은 z=0 기준인데 알은 실제로 z(< 0, 카메라에서 더 멀다)에 놓인다.
      // projectPebble() 로 "이 알이 화면에 실제로 찍히는 자리·크기"를 구한 뒤
      // 그걸로 판정해야 한다 — z=0 기준 x, y, r 을 그대로 비교하면 알마다 깊이가
      // 달라 침범량이 들쭉날쭉해진다(round 3 에서 실측한 버그).
      //
      // 중심 하나만 보면 알의 몸통(반지름 proj.r)이 중심 바깥의 옆 칸으로 삐져
      // 나갈 수 있다 — 특히 보드 가장자리처럼 칸 경계가 알 반지름보다 촘촘한
      // 자리에서 그렇다. 중심과 상하좌우 네 끝점(반지름만큼 떨어진 자리)까지
      // 다섯 점을 봐서 그중 하나라도 보드 칸이면 버린다. 완벽한 원판-폴리곤
      // 교차 판정은 아니지만(대각선 모서리를 살짝 놓칠 수 있다), 알이 화면에서
      // 몇 px 짜리 점이고 저폴리 정이십면체라 실루엣도 원과 정확히 안 맞으므로
      // 이 정도면 충분하다 — 남은 오차는 픽셀 단위지 round 3 처럼 몇 px 씩
      // 체계적으로 삐져나오는 종류가 아니다.
      const proj = projectPebble(x, y, r, z, camZ);
      const onBoard =
        occupiesBoardCell(proj.x, proj.y, hole, mask) ||
        occupiesBoardCell(proj.x - proj.r, proj.y, hole, mask) ||
        occupiesBoardCell(proj.x + proj.r, proj.y, hole, mask) ||
        occupiesBoardCell(proj.x, proj.y - proj.r, hole, mask) ||
        occupiesBoardCell(proj.x, proj.y + proj.r, hole, mask);
      if (onBoard) continue;

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

      // 심해 암석 톤. 알마다 살짝 흔들어 한 덩어리로 안 보이게 한다.
      const v = 0.34 + hash01(seed + i * 9.9) * 0.2;
      color.setRGB(v * 0.62, v * 0.78, v);
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

  /** 깊어질수록 바닥을 어둡게 — 2D 의 gloom 과 같은 역할 */
  setMood(mood: DepthMood): void {
    const k = 1 - mood.gloom * 0.75;
    this.mat.color.setRGB(k, k, k);
    // 바닥판은 알보다 살짝 더 어둡게 — 알이 그 위에 얹힌 것처럼 도드라져 보인다.
    this.backingMat.color.setRGB(k * 0.8, k * 0.85, k * 0.9);
    // 깊으면 수면 빛이 안 닿으므로 코스틱도 사라진다
    this.uCaustic.value = mood.shafts * 0.55;
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
