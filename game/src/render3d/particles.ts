// 마린 스노우와 기포 -- Points 하나, 드로우콜 하나.
//
// 위치 갱신을 CPU 에서 하면 매 프레임 버퍼를 다시 올려야 한다. 대신 입자마다 '위상'만
// 주고 셰이더가 시간으로 위치를 만든다. 버퍼는 한 번만 올린다.
//
// 3D 오브젝트는 보드 사각형의 화면 영역을 침범하면 안 된다는 규칙은 이 입자에도 그대로
// 적용된다 -- 눈발이 보드 위로 흘러 지나가면 타일을 가린다. 자갈밭은 인스턴스를 구멍
// 안이면 아예 안 뿌리는 식으로 이 규칙을 지키지만, 입자는 위치를 셰이더가 매 프레임
// 새로 만들기 때문에 CPU 쪽에서 미리 걸러낼 수 없다. 그래서 보드 사각형을 uHole
// 유니폼(화면 NDC 기준)으로 넘기고, 프래그먼트 셰이더에서 그 안에 들어간 조각을
// discard 한다.
//
// 입자는 z=-0.5~-3.5 사이 여러 깊이에 떠 있으므로 화면에 찍히는 자리는 입자의
// 월드 x, y 가 아니다(depthProjection.ts 의 depthScale() 이 설명하는 것과 같은 문제).
// world x, y 를 그대로 구멍과 비교하면 깊이가 다른 입자마다 침범 판정이 어긋난다.
// 다행히 이 값을 다시 셰이더에서 계산할 필요는 없다 -- gl_Position 은 이미
// projectionMatrix * modelViewMatrix 로 입자의 실제 깊이를 반영해 만들어지고,
// 그 xy 를 w 로 나누면(perspective divide) 바로 "이 입자가 화면 어디에 찍히는가"인
// NDC 좌표가 나온다. depthScale() 이 seafloor.ts/waterVolume.ts 에서 손으로 하는
// 보정과 수학적으로 같은 나눗셈을, 카메라가 이미 갖고 있는 투영 행렬로 그대로
// 얻는 셈이다. 그래서 vNdc = clip.xy / clip.w 를 varying 으로 넘겨 프래그먼트에서
// uHole 과 비교한다.
//
// vNdc 는 입자 '중심'의 화면 위치일 뿐이다 -- Points 는 gl_PointSize 만큼 중심 주위로
// 퍼지므로, 중심이 구멍 밖이어도 반지름만큼은 보드 쪽으로 걸칠 수 있다. 처음에는 이
// 여유를 고정 상수(0.03 NDC)로 어림했는데, 리뷰에서 "화면 CSS 폭이 ~287px 아래로
// 좁아지면 그 상수로는 반지름을 다 못 덮는다"는 지적을 받았다 -- seafloor.ts 가 알의
// 반지름을 어림했다가 세 번 깨진 것과 같은 종류의 실패다. gl_PointSize 는 정점마다
// 이미 정확히 계산돼 있으므로, 그 값을 그대로 varying 으로 넘기고 프래그먼트에서
// (CSS px 캔버스 크기, dpr) 로부터 유도한 정확한 px->NDC 배율을 곱해 이 입자만의
// 여유를 만든다(pxToNdc.ts). 화면 폭에 상관없이 항상 정확하다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import { clampDpr, cssSizeFromView, pxToNdc } from './pxToNdc.ts';
import type { PlaneView } from './projection.ts';

const MAX = 900;

/**
 * 이 무대의 dpr 상한(stage.ts 의 MAX_DPR 과 같은 값이다).
 *
 * Drift 는 렌더러를 안 들고 있어(생성자는 scene 하나만 받는다) 실제 dpr 을 stage.ts 로부터
 * 전달받지 못한다. 대신 stage.ts 와 똑같이 window.devicePixelRatio 를 이 상한으로 직접
 * 잘라 쓴다 -- 두 값이 어긋나면 gl_PointSize 가 실제로 그려지는 디바이스 px 단위와
 * 여기서 구하는 px->NDC 배율의 단위가 안 맞게 된다. 프로젝트 전역 상수(전역 제약의
 * "3D 캔버스 dpr 상한 1.5")이므로 값 자체를 새로 정하는 게 아니라 그대로 복제한다.
 */
const MAX_DPR = 1.5;

export class Drift {
  private points: THREE.Points;
  private geom = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private uTime = { value: 0 };
  private uSpan = { value: new THREE.Vector2(10, 20) };
  private uSize = { value: 6 };
  private uOpacity = { value: 0.5 };
  // 보드 사각형(화면 NDC, -1..1) -- x0=x1=0, y0=y1=0 이면 어떤 vNdc 도 안에 못 들어가
  // 아무것도 안 걸러진다. setBoardRectNdc() 가 처음 불리기 전(첫 setBoardRect 도착
  // 전)의 기본값이다 -- Stage3D 생성자의 resize() 는 보드를 모르는 채로 한 번 불리지만
  // 그 프레임은 렌더되지 않고(BoardView 생성자가 곧이어 setBoardRect 를 동기로 넘긴
  // 뒤에야 rAF 루프가 시작된다), 그 다음부터는 항상 실제 구멍 값이 들어온다.
  private uHole = { value: new THREE.Vector4(0, 0, 0, 0) };
  // px(디바이스) 하나가 NDC 몇 폭인지 -- setMood() 가 매 리사이즈마다 다시 잰다.
  // 기본값 0 은 uHole 과 같은 이유로 안전하다: 첫 setMood() 가 항상 첫 렌더보다
  // 먼저 온다(Stage3D 생성자가 resize() 끝에서 부른다).
  private uPxToNdc = { value: new THREE.Vector2(0, 0) };
  private quality = 1;
  private want = MAX;

  constructor(private scene: THREE.Scene) {
    // position 을 좌표가 아니라 '위상 셋'으로 쓴다. 셰이더가 이걸로 위치를 만든다.
    const seed = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
    }
    this.geom.setAttribute('position', new THREE.BufferAttribute(seed, 3));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uTime,
        uSpan: this.uSpan,
        uSize: this.uSize,
        uOpacity: this.uOpacity,
        uHole: this.uHole,
        uPxToNdc: this.uPxToNdc,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        uniform vec2 uSpan;
        uniform float uSize;
        varying float vFade;
        varying vec2 vNdc;
        varying float vPointPx;
        void main() {
          float sx = position.x;
          float sy = position.y;
          float sv = position.z;
          // 아래로 천천히 가라앉으면서 좌우로 흔들린다
          float fall = fract(sy + uTime * (0.012 + sv * 0.02));
          float x = (sx - 0.5) * uSpan.x + sin(uTime * 0.4 + sy * 20.0) * 0.25;
          float y = (0.5 - fall) * uSpan.y;
          float z = -0.5 - sv * 3.0;
          vFade = 0.4 + sv * 0.6;
          vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
          gl_PointSize = uSize * (0.5 + sv) * (10.0 / -mv.z);
          // 이 입자의 실제 화면 지름(디바이스 px) -- 프래그먼트에서 이 입자만의
          // 구멍 여유를 정확히 만드는 데 쓴다(고정 상수로 어림하지 않는다).
          vPointPx = gl_PointSize;
          vec4 clip = projectionMatrix * mv;
          gl_Position = clip;
          // 화면 NDC -- 보드 구멍 판정을 여기서 만든 좌표로 한다(perspective divide 가
          // 이 입자의 실제 깊이를 이미 반영했다).
          vNdc = clip.xy / clip.w;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform vec4 uHole;
        uniform vec2 uPxToNdc;
        varying float vFade;
        varying vec2 vNdc;
        varying float vPointPx;
        void main() {
          // 이 입자 반지름(px)을 NDC 로 바꿔 구멍 경계에 더한다 -- vNdc 는 점의
          // 중심일 뿐이라, 중심이 구멍 밖이어도 반지름만큼은 걸칠 수 있어서다.
          vec2 margin = vec2(vPointPx * 0.5) * uPxToNdc;
          // 보드 사각형(여유 포함) 안이면 그린다 -- 이 3D 장면은 보드 앞 레이어라
          // 여기 그리면 타일을 덮는다.
          if (
            vNdc.x > uHole.x - margin.x && vNdc.x < uHole.z + margin.x &&
            vNdc.y > uHole.y - margin.y && vNdc.y < uHole.w + margin.y
          ) {
            discard;
          }
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d));
          gl_FragColor = vec4(vec3(0.78, 0.92, 1.0), a * vFade * uOpacity);
        }
      `,
    });

    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setMood(mood: DepthMood, view: PlaneView): void {
    this.uSpan.value.set(view.worldW * 1.2, view.worldH * 1.2);
    this.uOpacity.value = 0.22 + mood.snow * 0.42;
    this.want = Math.round(120 + mood.snow * (MAX - 120));
    this.applyCount();

    // px->NDC 배율도 view 가 바뀔 때(=리사이즈마다) 다시 잰다. CSS 캔버스 크기는
    // view 안에 이미 있는 값을 되짚고(cssSizeFromView), 실제 dpr 은 stage.ts 와 같은
    // 방식으로 window 에서 직접 읽어 상한을 자른다.
    const css = cssSizeFromView(view);
    const dpr = clampDpr(window.devicePixelRatio, MAX_DPR);
    const ndc = pxToNdc(css.w, css.h, dpr);
    this.uPxToNdc.value.set(ndc.x, ndc.y);
  }

  /**
   * 보드 사각형 -- 화면 NDC(-1..1, y 위쪽) 기준, 이미 이 캔버스의 원점을 뺀 좌표에서
   * 호출부(Stage3D)가 변환해 넘긴다. 리사이즈·보드 이동마다 다시 불러 이 값을 갱신한다
   * -- 캡처해 둔 상수가 아니라 매번 최신 사각형을 따라간다. 점 반지름만큼의 여유는
   * 여기서 더하지 않는다 -- 입자마다 크기가 달라 프래그먼트 셰이더가 vPointPx 로 직접
   * 계산한다(위 셰이더 참고).
   */
  setBoardRectNdc(x0: number, y0: number, x1: number, y1: number): void {
    this.uHole.value.set(x0, y0, x1, y1);
  }

  /** 품질 티어 -- 1 = 그대로, 0.5 = 절반 */
  setQuality(k: number): void {
    this.quality = k;
    this.applyCount();
  }

  private applyCount(): void {
    this.geom.setDrawRange(0, Math.max(40, Math.round(this.want * this.quality)));
  }

  step(dt: number): void {
    this.uTime.value += dt;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geom.dispose();
    this.mat.dispose();
  }
}
