// 자갈 해저 — 보드는 이 더미에 파인 구멍이다.
//
// 레퍼런스의 핵심은 보드 자체가 아니라 '자갈에 파인 불규칙한 구멍이 보드'라는 점이다.
// 2D 때는 칸마다 자갈 34알을 그려 이걸 만들었다. 3D 에서는 알 하나를 InstancedMesh 로
// 수백 개 뿌린다 — 드로우콜 하나로 끝나고, 조명이 알알이 입체감을 만들어 준다.
//
// 구멍 자리에는 인스턴스를 아예 배치하지 않는다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import { type PlaneView, pxToWorld } from './projection.ts';

const COUNT = 520;

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

/** 시드 기반 0..1 난수. 프레임마다 같은 배치가 나와야 하므로 Math.random 을 안 쓴다. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
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
  private uTime = { value: 0 };
  private uCaustic = { value: 0.5 };

  constructor(private scene: THREE.Scene) {
    // 저폴리 자갈 한 알. detail 0 = 20 삼각형. 520 알이면 10,400 삼각형.
    this.geom = new THREE.IcosahedronGeometry(0.5, 0);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.patchCaustics();
    this.mesh = new THREE.InstancedMesh(this.geom, this.mat, COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /**
   * 코스틱 — 수면이 굴절시킨 빛이 바닥에 그리는 그물무늬.
   * 텍스처 대신 노이즈 두 겹을 겹쳐 만든다. 에셋 0개.
   * onBeforeCompile 은 three 가 내주는 정식 셰이더 개조 지점이다.
   */
  private patchCaustics(): void {
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uCaustic = this.uCaustic;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
        );
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
   * 구멍을 피해 자갈을 뿌린다.
   * @param hole 보드 사각형 (z=0 월드 좌표, 가운데 원점)
   */
  layout(hole: HoleBox, view: PlaneView, seed: number): void {
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

      // 구멍 안이면 버린다. 구멍 = 보드 = 2D 가 그리는 자리다.
      //
      // 여유는 알의 실제 반지름 r 로 잡는다 — 알마다 크기가 다른데 고정폭 여유를
      // 쓰면 큰 알은 중심이 여유 밖이어도 몸통이 구멍으로 삐져나온다(보드 위 타일을
      // 가리게 된다). r 을 여유로 쓰면 어떤 알도 구멍을 침범하지 않으면서, 동시에
      // 작은 알은 구멍 바로 앞까지 빈틈없이 채워져 자갈을 파낸 단면처럼 보인다.
      if (Math.abs(x - hole.cx) < hole.w / 2 + r && Math.abs(y - hole.cy) < hole.h / 2 + r) {
        continue;
      }

      const z = -0.2 - hash01(seed + i * 5.5) * 1.4;
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

  /** 깊어질수록 바닥을 어둡게 — 2D 의 gloom 과 같은 역할 */
  setMood(mood: DepthMood): void {
    const k = 1 - mood.gloom * 0.75;
    this.mat.color.setRGB(k, k, k);
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
  }
}
