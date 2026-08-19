// 물의 부피 -- 수면에서 내리꽂히는 빛기둥.
//
// 2D 때는 그라디언트 사다리꼴로 그렸다. 3D 에서는 가산합성 판을 몇 장 세워 두고 카메라가
// 그 사이를 보게 한다. 판이 겹치는 곳이 밝아지므로 빛이 물에 퍼진 것처럼 보인다.
// 포스트프로세싱 없이 이만한 게 없다.
//
// 판을 세울 자리는 화면 위쪽으로 고정하지 않는다. 지금은 보드가 화면 위쪽에 있고
// 자갈밭이 아래를 채우지만(8번 과제가 보드를 아래로 내리면 반대가 된다), 3D 가
// 보드 앞 레이어라 광선이 보드 위로 내려오면 타일을 덮는다. 그래서 Stage3D 가
// 보드 사각형 밖에서 가장 넓은 빈 띠를 매번 새로 골라 넘겨주고, 여기서는 그 띠
// 안에만 판을 세운다 -- 오늘은 그 띠가 아래, 8번 과제 뒤에는 위가 된다.
//
// 판은 z=0 이 아니라 그보다 뒤(-0.4~-1.4)에 떠 있다. 원근 카메라에서는 뒤에 있을수록
// 화면 중심으로 끌려 보이므로(seafloor.ts 의 depthScale() 참고), 빈 띠를 z=0 기준으로
// 골라 그대로 배치하면 화면에서는 안쪽으로 밀려 찍힌다. 같은 보정을 여기서도 그대로 쓴다
// -- seafloor.ts 가 바닥판 구멍을 지을 때 쓴 것과 같은 함수, 같은 방향(곱하기)이다.
// (여러 깊이에 걸치는 건 순전히 5장 사이 크기·시차를 살짝 다르게 주기 위해서다 --
// 아래 depthTest: false 때문에 서로, 그리고 자갈밭과의 앞뒤 관계는 더는 문제되지 않는다.)
//
// depthTest 를 끈다. 광선판은 물리적으로 뭔가에 가려질 대상이 아니라 가산합성으로
// 화면에 덧입히는 빛이다 -- depthWrite 만 끄고 depthTest 는 켜 둔 채로 두면(첫 시도가
// 그랬다), seafloor.ts 의 바닥판(z=-1.8, 화면 전체를 덮는 불투명 판)보다 뒤에 놓인
// 광선은 깊이 판정에서 가려 안 보였다. 그때는 광선 z 를 바닥판보다 앞으로 두는 수동
// 여유값(0.4)으로 고쳤는데, 그 여유는 seafloor.ts 의 BACKING_Z 와 주석으로만 이어져
// 있었다 -- BACKING_Z 가 나중에(8번 과제가 보드를 옮기며 자갈 레이어를 건드릴 수
// 있다) 바뀌면 아무 것도 안 깨진 채 광선만 다시 조용히 사라진다. depthTest: false 로
// 그 결합을 아예 없앤다 -- 광선은 이제 seafloor.ts 의 어떤 z 상수와도 무관하게 항상
// 보인다. 대신 draw 순서를 renderOrder 로 못박아 둔다(아래).
//
// 판 전체를 한 불투명도로 칠하면 빛이 아니라 네모난 막대로 보인다(사용자가 실제로
// 그렇게 봤다). MeshBasicMaterial 은 판 전체가 균일하므로, patchShaft() 가 프래그먼트
// 셰이더에 알파를 셰이핑하는 패치를 얹는다 -- 수면(판 위쪽)에서 넓고 밝고, 깊이
// (판 아래쪽)로 갈수록 좁아지며 옅어지는 쐐기 모양과, 가장자리는 딱 끊기지 않고
// 번지도록. 지오메트리는 그대로(판 하나, 재사용) -- seafloor.ts 의 코스틱 패치와
// 같은 onBeforeCompile 방식이라 드로우콜·삼각형 수에 영향이 없다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import { depthScale, type HoleBox } from './seafloor.ts';

const MAX_SHAFTS = 5;

/** 시드 기반 0..1 난수 -- seafloor.ts 의 hash01() 과 같은 식이다. 판마다(리사이즈가
 *  아니라 생성 시 한 번) 폭·길이·쐐기 정도를 갈라 다섯 판이 똑같아 보이지 않게
 *  쓰는 용도라, 그 파일의 hash01 을 그대로 가져다 쓰기보다 이 파일 안에 작게
 *  둔다 -- 광선판과 자갈은 서로 몰라도 되는 레이어다. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 투명 오브젝트 사이 draw 순서 -- depthTest 를 꺼서 깊이 버퍼로는 순서를 안 정하므로,
 * three 의 자동 거리 정렬에 기대지 않고 명시적으로 못박는다. Drift(마린 스노우, 기본
 * renderOrder 0)보다 뒤에 그려 광선이 눈발 위에 얹히게 하고, 7·8번 과제가 추가할
 * 잠수부·포식자의 반투명 효과보다도 확실히 나중에 그려지도록 넉넉히 크게 잡는다 --
 * 광선은 "장면 맨 위에 덧입는 빛" 이라 다른 반투명 오브젝트에 가려지면 안 된다.
 */
const RENDER_ORDER = 10;

export class WaterVolume {
  private group = new THREE.Group();
  private shafts: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[] = [];
  private geom = new THREE.PlaneGeometry(1, 1);
  private t = 0;
  private cap = 1;
  /** 판마다 다른 폭·길이 배율 -- 다섯 판이 똑같은 크기로 안 보이게 한다. */
  private widthMul: number[] = [];
  private lenMul: number[] = [];
  /** 셰이더에 넘기는 시간 -- 자갈밭의 uTime 과 같은 역할, 여기서는 쐐기 알파의
   *  미세한 깜빡임(flicker)에만 쓴다. */
  private uTime = { value: 0 };

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbfeaff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      // 폭은 0.7~1.3배, 길이는 0.82~1.15배 -- 판마다 살짝 달라야 다섯 줄기가
      // 한 틀로 찍어낸 막대처럼 안 보인다.
      this.widthMul.push(0.7 + hash01(i * 17.3) * 0.6);
      this.lenMul.push(0.82 + hash01(i * 29.9) * 0.33);
      this.patchShaft(mat, i);
      const mesh = new THREE.Mesh(this.geom, mat);
      mesh.visible = false;
      mesh.renderOrder = RENDER_ORDER;
      this.mats.push(mat);
      this.shafts.push(mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  /**
   * 판 전체를 한 알파로 칠하는 대신, 프래그먼트 알파를 자리에 따라 셰이핑해
   * 쐐기(위는 넓고 밝고, 아래는 좁고 옅은) 모양을 만든다.
   *
   * vLocal 은 스케일 적용 전 로컬 정점 좌표(-0.5..0.5) 를 그대로 넘긴 varying 이다 --
   * three 의 vUv 를 안 쓰는 이유는 MeshBasicMaterial 이 map 계열 텍스처가 하나도
   * 없으면 USE_UV 가 꺼져 vUv 자체가 셰이더에 선언되지 않기 때문이다(position
   * attribute 는 그런 조건 없이 항상 있다). seafloor.ts 의 patchCaustics() 가
   * vWPos 를 직접 만든 것과 같은 이유, 같은 방식이다.
   *
   * PlaneGeometry 는 로컬 +y 가 위쪽이고, setMood() 는 이 판을 빈 띠 한가운데
   * 놓고 세로로 꽉 채운다 -- 그래서 로컬 y=+0.5(v=1) 가 화면 위쪽(수면), y=-0.5
   * (v=0) 가 화면 아래쪽(깊이)에 대응한다. 쐐기의 폭이 v=1 에서 가장 넓고 v=0
   * 으로 갈수록 uTaper 까지 좁아지는 것도, 밝기가 v=1 근처에서 가장 세고 v=0
   * 으로 갈수록 옅어지는 것도 이 대응 때문이다.
   */
  private patchShaft(mat: THREE.MeshBasicMaterial, i: number): void {
    // 하단 쐐기 폭(전체 폭 대비 비율) -- 판마다 달라야 쐐기 정도도 균일하지 않다.
    const uTaper = { value: 0.08 + hash01(i * 41.1) * 0.14 };
    const uSeed = { value: i * 7 + 1 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uTaper = uTaper;
      shader.uniforms.uSeed = uSeed;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position.xy;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec2 vLocal;
           uniform float uTime;
           uniform float uTaper;
           uniform float uSeed;`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           // v: 0(판 아래=깊이) .. 1(판 위=수면). u: 0(왼쪽) .. 1(오른쪽), 0.5 가 중심.
           float v = clamp(vLocal.y + 0.5, 0.0, 1.0);
           float u = vLocal.x + 0.5;
           // 쐐기 -- 수면(v=1)에서는 판 폭 전체(0.5)까지, 깊이(v=0)로 갈수록
           // uTaper 까지 좁아진다. pow(v, 0.55) 로 상단 근처에서 빨리 벌어지게 해
           // "넓은 머리 + 가는 꼬리" 모양을 낸다.
           float halfW = mix(uTaper, 0.5, pow(v, 0.55));
           float edge = max(halfW * 0.6, 0.02);
           float alphaH = 1.0 - smoothstep(halfW - edge, halfW, abs(u - 0.5));
           // 세로 방향 -- 아래로 갈수록 옅어지고(빛이 안 닿는 데로 사라진다), 맨
           // 위 가장자리도 살짝 죽여 판의 상단 경계가 딱 끊긴 선으로 안 보이게 한다.
           float alphaV = smoothstep(0.0, 0.26, v) * (1.0 - 0.3 * smoothstep(0.88, 1.0, v));
           // 잔물결 깜빡임 -- 정지한 그림이 아니라 흔들리는 물속 빛으로 읽히게 한다.
           float flick = 0.85 + 0.15 * sin(uTime * 0.8 + uSeed * 1.7 + v * 3.0);
           gl_FragColor.a *= clamp(alphaH, 0.0, 1.0) * alphaV * flick;`,
        );
    };
  }

  /**
   * @param clear 보드 밖 빈 띠 -- z=0 평면 기준 좌표(HoleBox 와 같은 형식, Stage3D 가
   *   보드 사각형을 보고 리사이즈마다 다시 골라 준다).
   * @param camZ 카메라~z=0 거리(stage.ts 의 CAM_Z). 광선판이 z=0 이 아닌 깊이에
   *   있어 원근 보정에 필요하다 -- 하드코딩하지 않고 호출부가 실제로 카메라를 세운
   *   값을 그대로 받는다(seafloor.ts 의 layout() 과 같은 이유).
   */
  setMood(mood: DepthMood, clear: HoleBox, camZ: number): void {
    const n = Math.round(mood.shafts * MAX_SHAFTS * this.cap);
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const on = i < n;
      this.shafts[i].visible = on;
      if (!on) continue;
      const k = (i + 0.5) / MAX_SHAFTS;
      const z = -0.4 - i * 0.25;
      // 빈 띠 안에서 z=0 기준 자리를 고른 뒤, depthScale() 을 곱해 실제 깊이(z)에서도
      // 같은 화면 위치·크기로 보이도록 옮긴다 (seafloor.ts layoutBacking() 참고 -- 거기는
      // 바닥판이 뒤에 있어 같은 방향으로 곱했다).
      const dk = depthScale(camZ, z);
      const x0 = clear.cx + (k - 0.5) * clear.w * 1.1;
      // 판의 세로 길이는 alphaV 셰이핑으로 v=1(판 위쪽=수면)이 가장 밝다고 정했으니,
      // 그 위쪽 끝이 실제로 밴드 위쪽 가장자리(수면)에 맞물려야 한다 -- 중앙 고정
      // 이전 방식(y0 = clear.cy)은 판이 짧아질(lenMul < 1) 때 위아래 끝이 같이
      // 안으로 줄어들어 광선이 수면에서 안 뻗어나오고 공중에 떠 보였다. 대신 위쪽
      // 끝을 고정하고 길이만 lenMul 로 줄인다 -- 짧은 광선일수록 얕은 데서 끝난다.
      const scaleY = clear.h * 0.9 * this.lenMul[i];
      const topY0 = clear.cy + (clear.h * 0.9) / 2;
      const y0 = topY0 - scaleY / 2;
      this.shafts[i].position.set(x0 * dk, y0 * dk, z);
      this.shafts[i].rotation.z = (k - 0.5) * 0.5;
      this.shafts[i].scale.set(clear.w * 0.16 * this.widthMul[i] * dk, scaleY * dk, 1);
      // 쐐기 셰이핑(patchShaft) 은 중심을 가장 밝게, 가장자리를 옅게 그리므로 이전
      // (판 전체 균일 알파) 대비 평균 밝기가 낮다 -- 같은 무게감을 유지하려 피크를
      // 올린다(0.05~0.15 -> 0.08~0.28). 개수(n)로 이미 깊이별로 켜고 끄는 게
      // 전부/전무를 담당하므로, 여기 배율은 "얼마나 밝게 보이는가"만 조정한다.
      this.mats[i].opacity = 0.08 + mood.shafts * 0.2;
      this.mats[i].color.setRGB(
        mood.glowColor[0] / 255,
        mood.glowColor[1] / 255,
        mood.glowColor[2] / 255,
      );
    }
  }

  /** 품질 티어 -- 1 = 그대로, 0.4 = 개수를 깎는다 */
  setQuality(k: number): void {
    this.cap = k;
  }

  step(dt: number): void {
    this.t += dt;
    this.uTime.value += dt;
    // 광선은 흔들려야 물처럼 보인다. 주기가 어긋난 사인 둘 -- 하나면 시계추로 읽힌다.
    for (let i = 0; i < this.shafts.length; i++) {
      if (!this.shafts[i].visible) continue;
      const s = Math.sin(this.t * 0.35 + i) * 0.03 + Math.sin(this.t * 0.13 + i * 2.1) * 0.02;
      this.shafts[i].rotation.z += s * dt;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.geom.dispose();
    for (const m of this.mats) m.dispose();
  }
}
