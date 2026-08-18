// 자갈 해저 — 보드는 이 더미에 파인 구멍이다.
//
// 레퍼런스의 핵심은 보드 자체가 아니라 '자갈에 파인 불규칙한 구멍이 보드'라는 점이다.
// 2D 때는 칸마다 자갈 34알을 그려 이걸 만들었다. 3D 에서는 알 하나를 InstancedMesh 로
// 수백 개 뿌린다 — 드로우콜 하나로 끝나고, 조명이 알알이 입체감을 만들어 준다.
//
// 알만으로는 화면을 다 못 덮는다(무작위 뿌리기라 알 사이에 틈이 남는다). 그래서
// 알들 뒤에 구멍만 뚫린 바닥판(backing)을 깔아 틈으로 배경이 비치지 않게 막는다.
// 구멍 자리에는 알도 바닥판도 배치하지 않는다 — 거기가 2D 보드다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import { type PlaneView, pxToWorld } from './projection.ts';

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

/**
 * z=0 평면 기준 좌표(화면 px 와 상수배로 대응)를 z=planeZ 평면에서 같은 화면
 * 위치·크기로 옮기는 배율.
 *
 * 원근 카메라는 screen ∝ world / (camZ - z) 로 투영한다. z=0 에서는 분모가
 * camZ, z=planeZ 에서는 camZ - planeZ 이므로, 같은 screen 값을 내려면
 * world 좌표를 (camZ - planeZ) / camZ 배 해야 한다. 크기뿐 아니라 원점으로부터의
 * 오프셋(중심 좌표)도 같은 배율을 먹는다 — 좌표 자체가 이 식의 입력이기 때문이다.
 */
function depthScale(camZ: number, planeZ: number): number {
  return (camZ - planeZ) / camZ;
}

export interface HoleBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export class Seafloor {
  private mesh: THREE.InstancedMesh;
  private geom: THREE.IcosahedronGeometry;
  private mat: THREE.MeshLambertMaterial;
  private backingMesh: THREE.Mesh;
  private backingGeom: THREE.ShapeGeometry | null = null;
  private backingMat: THREE.MeshLambertMaterial;
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

    // 알 사이 틈을 메우는 바닥판 — 구멍(보드) 자리만 뚫려 있다.
    // 무작위로 뿌린 알만으로는 화면을 다 못 덮어 틈으로 뒤 배경(CSS 그라디언트)이
    // 비친다. 알보다 한 켜 더 뒤에 깔아 자갈 알들이 그 위에 놓인 것처럼 보이게 한다.
    // geometry 는 구멍 위치가 바뀔 때마다 layout() 에서 새로 짓는다(아래 참고).
    this.backingMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.patchCaustics(this.backingMat, false);
    this.backingMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.backingMat);
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
   */
  private patchCaustics(mat: THREE.MeshLambertMaterial, instanced: boolean): void {
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
    };
  }

  /**
   * 구멍을 피해 자갈을 뿌리고, 바닥판을 구멍 모양대로 다시 짓는다.
   * @param hole 보드 사각형 (z=0 월드 좌표, 가운데 원점)
   * @param camZ 카메라와 z=0 평면 사이 거리(stage.ts 의 CAM_Z). 바닥판이 z=0 이
   *   아닌 깊이에 있어 원근 보정에 필요하다 — 하드코딩하지 않고 호출부(stage.ts)가
   *   실제로 카메라를 세운 값을 그대로 받아, 그 값이 바뀌어도 저절로 따라가게 한다.
   */
  layout(hole: HoleBox, view: PlaneView, seed: number, camZ: number): void {
    this.layoutBacking(hole, view, camZ);

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

      // 구멍 안이면 버린다. 구멍 = 보드 = 2D 가 그리는 자리다.
      //
      // x, y, r 은 z=0 기준인데 알은 실제로 z(< 0, 카메라에서 더 멀다)에 놓인다.
      // 원근 때문에 그 알은 화면에 x, y 가 아니라 depthScale(camZ, z) 로 나눈
      // 자리에 찍힌다(바닥판 구멍을 지을 때와 같은 배율, 방향만 반대 — 여기서는
      // z=0 좌표를 실제 깊이의 화면 위치로 "투영"하는 것이므로 곱하지 않고 나눈다).
      // 중심만 투영하고 그 위에 z=0 기준 반지름 r 을 얹으면 안 된다 — 반지름도
      // 같은 원근을 받으므로 얕은 알과 깊은 알의 실제 화면 크기가 다르다.
      // 두 값 다 투영한 뒤에 구멍과 비교해야 "화면에 실제로 찍히는 자리"가
      // 구멍을 침범하는지 알 수 있다. 이걸 안 하면 알마다 깊이가 달라 침범량이
      // 들쭉날쭉해진다 — 실측에서 본 것과 같은 들쭉날쭉한 침범이 바로 이 증상이다.
      const depthK = depthScale(camZ, z);
      const screenX = x / depthK;
      const screenY = y / depthK;
      const screenR = r / depthK;
      if (
        Math.abs(screenX - hole.cx) < hole.w / 2 + screenR &&
        Math.abs(screenY - hole.cy) < hole.h / 2 + screenR
      ) {
        continue;
      }

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
   * 화면 전체(과대 크기 포함)를 덮는 사각형에서 구멍 자리만 뚫어 바닥판을 다시 짓는다.
   * 구멍 위치는 보드 리사이즈마다 바뀌므로 지오메트리를 매번 새로 짓고 이전 것은 버린다.
   *
   * hole·view 는 z=0 평면 기준 좌표다. 바닥판은 z=0 이 아니라 BACKING_Z 에 있으므로
   * 그 좌표를 그대로 쓰면 화면에서 어긋난다 — 원근 카메라에서 카메라로부터 먼
   * 평면일수록 같은 화면 위치가 원점에서 더 먼 월드 좌표에 대응하기 때문이다
   * (카메라~평면 거리에 정비례). z=0 기준 좌표를 이 평면에서 같은 화면 위치·크기로
   * 옮기려면 거리 비율 k = (camZ - BACKING_Z) / camZ 를 곱해야 한다 — 크기뿐 아니라
   * 원점으로부터의 오프셋(중심 좌표)도 함께 곱해야 한다. 크기만 키우고 중심을
   * 그대로 두면 구멍은 맞는 크기로 엉뚱한 자리에 뚫린다.
   */
  private layoutBacking(hole: HoleBox, view: PlaneView, camZ: number): void {
    const k = depthScale(camZ, BACKING_Z);

    const halfW = (view.worldW * BACKING_OVERSCAN * k) / 2;
    const halfH = (view.worldH * BACKING_OVERSCAN * k) / 2;

    const shape = new THREE.Shape();
    shape.moveTo(-halfW, -halfH);
    shape.lineTo(halfW, -halfH);
    shape.lineTo(halfW, halfH);
    shape.lineTo(-halfW, halfH);
    shape.closePath();

    // 구멍 폭/높이가 아직 0 이하면(레이아웃 확정 전) 구멍 없이 통짜로 둔다 —
    // 0 크기 Path 는 삼각분할이 퇴화해 에러가 난다.
    if (hole.w > 0 && hole.h > 0) {
      const hx0 = (hole.cx - hole.w / 2) * k;
      const hx1 = (hole.cx + hole.w / 2) * k;
      const hy0 = (hole.cy - hole.h / 2) * k;
      const hy1 = (hole.cy + hole.h / 2) * k;
      const path = new THREE.Path();
      path.moveTo(hx0, hy0);
      path.lineTo(hx1, hy0);
      path.lineTo(hx1, hy1);
      path.lineTo(hx0, hy1);
      path.closePath();
      shape.holes.push(path);
    }

    const geom = new THREE.ShapeGeometry(shape);
    this.backingMesh.geometry = geom;
    this.backingGeom?.dispose();
    this.backingGeom = geom;
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
    this.backingMesh.geometry.dispose();
    this.backingMat.dispose();
  }
}
