// three.js 무대 — renderer·scene·camera·리사이즈·품질 티어·해제.
//
// 렌더 루프를 여기서 돌리지 않는다. BoardView 의 RAF 가 step() 과 render() 를 부른다.
// 루프가 둘이면 보드와 3D 가 서로 다른 프레임을 보게 되어 흔들림이 어긋난다.
//
// 3D 캔버스는 보드보다 '앞'에 있다 (설계 문서 참고). 그래서 이 무대의 오브젝트는
// 보드 사각형의 화면 영역을 침범하면 안 된다. 잠수부만 탈출 중에 예외로 들어온다.

import * as THREE from 'three';

import { predatorFor } from '../levels.ts';
import { depthMood } from '../render/depth.ts';
import { CELLS_TALL, DIVER_LIGHT_LAYER, Diver } from './diver.ts';
import { Drift } from './particles.ts';
import { Predators } from './predators.ts';
import { type PlaneView, planeView, pxToWorld, screenToPlane } from './projection.ts';
import { Seafloor, type HoleBox } from './seafloor.ts';
import type { BoardRect, DescentPoint, SceneView, Stage } from './types.ts';
import { WaterVolume } from './waterVolume.ts';

const FOV = 45;
const CAM_Z = 10;
const MAX_DPR = 1.5;

export class Stage3D implements Stage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private view: PlaneView;
  private w = 1;
  private h = 1;
  /** 이 캔버스의 뷰포트 원점 — BoardRect 가 뷰포트 좌표로 오므로 빼는 데 쓴다 */
  private left = 0;
  private top = 0;
  private dpr = 1;
  private board: BoardRect | null = null;
  private mood = depthMood(0);
  /** shake() 가 참고하는 마지막 SceneView — setView() 가 매 프레임 갱신한다 */
  private viewState: SceneView = { danger: 0, progress: 0 };
  private seafloor = new Seafloor(this.scene);
  private waterVolume = new WaterVolume(this.scene);
  private drift = new Drift(this.scene);
  private diver = new Diver(this.scene);
  /**
   * this.depth 는 parameter property 라 필드 초기화식보다 뒤에 대입된다
   * (useDefineForClassFields — mood 와 같은 이유로 여기서는 초기화식이 아니라
   * 생성자 본문에서 만든다).
   */
  private predators: Predators;
  private clock = 0;
  private lights: THREE.Light[] = [];
  /** 프레임 시간(ms) 지수평활 -- observe() 가 매 프레임 갱신한다 */
  private frameMs = 16;
  /** 현재 품질 티어: 0(최고)..3(최저) */
  private tier = 0;
  /**
   * 마지막으로 티어를 바꾼 시각(this.clock 기준, 초). 최소 체류 시간(TIER_DWELL_SEC)을
   * 재는 기준점이다. 0 으로 시작하면 clock 도 0 에서 시작하므로, 무대가 막 뜬 직후
   * (에셋 로드·JIT 워밍업으로 프레임이 튀기 쉬운 구간)에는 자동으로 유예 기간이 생긴다
   * -- 그 자체가 노림수다.
   */
  private tierChangedAt = 0;
  /**
   * 티어를 바꾼 뒤 이 시간(초) 동안은 다시 안 바꾼다.
   *
   * frameMs 자체가 지수평활(0.05)로 이미 완만하지만, 경계값(22ms/15ms) 바로 위아래를
   * 오가는 구간에서는 평활만으로 매 프레임 티어가 뒤집히는 걸 막지 못한다. 1.5초는
   * frameMs 평활의 시상수(20프레임 안팎, 60fps 기준 0.3~0.4초)보다 넉넉히 길어서
   * 한두 번의 튐으로는 못 넘고, 그러면서도 실제로 느려진 기기에서는 몇 초 안에
   * 체감 가능한 속도로 낮춰준다.
   */
  private static readonly TIER_DWELL_SEC = 1.5;
  /**
   * 잠수부·포식자 glb 로드가 끝났는가 -- ready() 가 이 둘을 합쳐서 준다.
   * 두 로더 다 자기 실패를 안에서 삼키므로(diver.ts/predators.ts 의 load() 호출부
   * 참고) 이 프로미스들은 거부하지 않는다 -- 실패해도 "그림 없이 끝났다"로
   * resolve 된다. ready() 가 절대 안 걸리는 이유가 여기서 이미 보장된다.
   */
  private diverReady: Promise<void>;
  private predatorsReady: Promise<void>;

  constructor(
    private canvas: HTMLCanvasElement,
    private depth: number,
  ) {
    this.mood = depthMood(this.depth);
    this.predators = new Predators(this.scene, predatorFor(this.depth));
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearAlpha(0);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camera.position.set(0, 0, CAM_Z);
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(
        this.mood.bottomRgb[0] / 255,
        this.mood.bottomRgb[1] / 255,
        this.mood.bottomRgb[2] / 255,
      ),
      0.02,
    );
    this.view = planeView(1, 1, FOV, CAM_Z);

    // 조명 둘. 방향광이 자갈 알의 면을 갈라 입체를 만들고, 반구광이 물빛으로 받쳐 준다.
    // 방향은 왼쪽 위 — 2D 타일을 굽던 조명 방향과 같아야 한 화면으로 읽힌다.
    const key = new THREE.DirectionalLight(0xdff4ff, 1.15);
    key.position.set(-0.6, 1, 0.8);
    const fill = new THREE.HemisphereLight(
      new THREE.Color(this.mood.top),
      new THREE.Color(this.mood.bottom),
      0.75,
    );
    this.lights = [key, fill];
    this.scene.add(key, fill);
    this.seafloor.setMood(this.mood);
    this.predators.setMood(this.mood);

    this.resize();
    this.diverReady = this.diver.load().catch((e) => console.warn('잠수부 로드 실패', e));
    this.predatorsReady = this.predators.load().catch((e) => console.warn('포식자 로드 실패', e));
  }

  /** Stage 인터페이스 참고 -- 잠수부·포식자 glb 가 다 붙을 때까지. */
  ready(): Promise<void> {
    return Promise.all([this.diverReady, this.predatorsReady]).then(() => undefined);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.left = rect.left;
    this.top = rect.top;
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.view = planeView(this.w, this.h, FOV, CAM_Z);
    if (this.board) this.setBoardRect(this.board);
    this.waterVolume.setMood(this.mood, this.clearBand(), CAM_Z);
    this.drift.setMood(this.mood, this.view);
  }

  /**
   * 빈 띠와 보드 사각형의 px 배치 -- clearBand() 와 잠수부 접지점 계산
   * (standAnchorY()) 이 같이 쓴다. 보드를 아직 모르면(첫 프레임 한정) null.
   */
  private bandLayoutPx(): {
    bandTop: number;
    bandH: number;
    /** 빈 띠가 보드 위쪽에 있는가 -- 그래야 "판자 위에 선다"는 방향이 중력과 맞다 */
    aboveBoard: boolean;
    boardTop: number;
  } | null {
    if (!this.board) return null;
    const boardTop = this.board.y - this.top;
    const boardBottom = boardTop + this.board.h;
    const aboveH = Math.max(0, boardTop);
    const belowH = Math.max(0, this.h - boardBottom);
    const aboveBoard = aboveH >= belowH;
    const bandTop = aboveBoard ? 0 : boardBottom;
    const bandH = Math.max(aboveH, belowH);
    return { bandTop, bandH, aboveBoard, boardTop };
  }

  /**
   * 보드 사각형 밖에서 가장 넓은 빈 띠 -- 광선은 여기에만 세운다.
   *
   * 보드가 화면 위쪽에 있으면 아래가, 아래쪽에 있으면 위가 넓다. 8번 과제가 보드를
   * 아래로 내리면 이 계산은 저절로 반대로 나온다 -- 위/아래를 여기서 하드코딩하지
   * 않는다. 보드 사각형을 아직 모르면(첫 프레임 한정) 화면 전체를 빈 띠로 본다.
   */
  private clearBand(): HoleBox {
    const layout = this.bandLayoutPx();
    if (!layout) {
      const c = screenToPlane(this.w / 2, this.h / 2, this.w, this.h, this.view);
      return { cx: c.x, cy: c.y, w: this.view.worldW, h: this.view.worldH };
    }
    const c = screenToPlane(this.w / 2, layout.bandTop + layout.bandH / 2, this.w, this.h, this.view);
    return { cx: c.x, cy: c.y, w: this.view.worldW, h: pxToWorld(layout.bandH, this.view) };
  }

  /**
   * 잠수부가 접지할 화면 y(캔버스 로컬 px) -- 빈 띠가 보드 위쪽에 있을 때만 뜻이
   * 통한다("판자 위에 선다"는 게 중력 방향과 맞아야 자연스럽다). 보드를 아직
   * 모르거나(첫 프레임), 빈 띠가 보드 아래쪽에 있으면(미래에 보드가 위로 옮겨가는
   * 경우) 보드 접지는 "천장에 붙어 선다"가 되어 부자연스러우므로, 그때는 예전처럼
   * 빈 띠 가운데에 띄운다. 두 번째 반환값(grounded)이 접지 여부다 -- diver.ts
   * place() 가 이 값으로 흔들림을 접지선 위로만 움직일지, 예전처럼 위아래로 고르게
   * 움직일지 가른다.
   */
  private standAnchorY(): { y: number; grounded: boolean } {
    const layout = this.bandLayoutPx();
    if (layout?.aboveBoard) return { y: layout.boardTop, grounded: true };
    const band = this.clearBand();
    return { y: (0.5 - band.cy / this.view.worldH) * this.h, grounded: false };
  }

  setBoardRect(r: BoardRect): void {
    this.board = r;
    // r 은 뷰포트 좌표다. 이 캔버스의 원점을 빼서 캔버스 로컬로 옮긴다.
    const cx = r.x + r.w / 2 - this.left;
    const cy = r.y + r.h / 2 - this.top;
    const c = screenToPlane(cx, cy, this.w, this.h, this.view);
    this.seafloor.layout(
      { cx: c.x, cy: c.y, w: pxToWorld(r.w, this.view), h: pxToWorld(r.h, this.view) },
      // 보드는 사각형이 아니다 -- cols/rows/holes 는 BoardRect 가 그대로 들고 온
      // 칸 점유 마스크다(단위 변환이 필요 없어 그대로 넘긴다). seafloor.ts 참고.
      { cols: r.cols, rows: r.rows, holes: r.holes },
      this.view,
      Math.round(this.depth * 1000) + 7,
      CAM_Z,
    );
    // 입자 셰이더가 쓰는 구멍 경계는 화면 NDC(-1..1) 다 -- 캔버스 로컬 px 사각형을
    // 그대로 비율 변환한다(y 는 화면 아래쪽이 0 이므로 뒤집는다). 입자는 z=0 평면이
    // 아닌 여러 깊이에 떠 있어 world 좌표로는 못 비교하므로(particles.ts 주석 참고),
    // 여기서는 world 로 가지 않고 바로 NDC 로 넘긴다.
    const left = cx - r.w / 2;
    const top = cy - r.h / 2;
    const right = cx + r.w / 2;
    const bottom = cy + r.h / 2;
    this.drift.setBoardRectNdc(
      (left / this.w) * 2 - 1,
      1 - (bottom / this.h) * 2,
      (right / this.w) * 2 - 1,
      1 - (top / this.h) * 2,
    );

    // 잠수부 제자리 -- 발을 보드 윗변(접지선)에 세운다. 가로는 그대로 빈 띠
    // 가운데다. standAnchorY() 가 세로 접지점을 정한다 -- 오늘은 보드가 아래쪽에
    // 있어 빈 띠가 위라 접지가 뜻이 통하지만, 8번 과제 이전처럼 보드가 위로
    // 옮겨가 빈 띠가 아래가 되면(standAnchorY() 참고) 접지 대신 예전처럼 빈 띠
    // 가운데로 저절로 되돌아간다 -- 여기서 위/아래를 가정하지 않는다.
    const band = this.clearBand();
    const stand = this.standAnchorY();
    const anchor = {
      x: (band.cx / this.view.worldW + 0.5) * this.w,
      y: stand.y,
    };
    // 대기 크기가 빈 띠보다 크면 가만히 있어도 보드를 침범한다 -- 띠 높이(10% 여유)에
    // 맞춰 잠수부 기준 칸 크기를 줄인다. 대부분의 레이아웃에서는 r.cell 그대로 쓴다.
    // 접지 상태에서도 이 90% 상한은 여전히 안전하다 -- 최악(클램프가 걸려
    // cellPx*CELLS_TALL 이 정확히 bandHeightPx*0.9)에도, 몸 높이 + 접지 안전
    // 여유(대략 몸 높이의 6.5%, diver.ts 의 standingTiltReachPx 호출부 참고)를
    // 더한 값이 bandHeightPx*0.9*1.065 ≈ bandHeightPx*0.96 로 여전히 1 미만이라
    // 흔들림에 쓸 여유가 항상 양수로 남는다(diver.ts 의 maxStandingBobWorld 가
    // 이 여유를 Math.max(0, ...) 로 한 번 더 지키므로 음수가 되어도 0 으로 죈다).
    // bandHeightPx 는 place() 에 그대로 넘긴다 -- 흔들림(bob) 상한도 같은 빈 띠
    // 안에서 계산해야 하기 때문이다(diver.ts 참고).
    const bandHeightPx = band.h * this.view.pxPerWorld;
    const cellPx = Math.min(r.cell, (bandHeightPx * 0.9) / CELLS_TALL);
    this.diver.place(anchor, this.view, this.w, this.h, cellPx, CAM_Z, bandHeightPx, stand.grounded);
  }

  setView(v: SceneView): void {
    // progress 는 아직 아무도 안 쓴다 — 지금은 danger 만 잠수부와 포식자에게 넘긴다.
    this.viewState = v;
    this.diver.setDanger(v.danger);
    this.predators.setDanger(v.danger);
  }

  setDescent(p: DescentPoint | null): void {
    // p 는 BoardRect 와 같은 기준(뷰포트 좌표) -- 이 캔버스 로컬로 옮겨서 넘긴다.
    const local = p ? { ...p, x: p.x - this.left, y: p.y - this.top } : null;
    this.diver.setDescent(local, this.view, this.w, this.h, CAM_Z);
  }

  diverAnchorScreen(): { x: number; y: number } {
    const a = this.diver.anchorScreen();
    return { x: a.x + this.left, y: a.y + this.top };
  }

  shake(): number {
    // 코앞까지 왔을 때만 흔든다. 늘 흔들면 압박이 아니라 노이즈가 된다.
    if (this.viewState.danger < 0.82) return 0;
    const k = (this.viewState.danger - 0.82) / 0.18;
    return Math.sin(this.clock * 34) * 3.2 * k;
  }

  cheer(): void {}
  rescued(): void {}

  step(dt: number): void {
    this.observe(dt);
    this.clock += dt;
    this.seafloor.step(dt);
    this.waterVolume.step(dt);
    this.drift.step(dt);
    this.diver.step(dt);
    this.predators.step(dt);
  }

  /**
   * 프레임이 밀리면 스스로 깎는다. 순서는 눈에 덜 띄는 것부터다:
   * 부유물 수 -> 광선 수 -> 해상도.
   */
  private observe(dt: number): void {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    // 최소 체류 시간 -- 경계값 근처에서 매 프레임 뒤집히는 걸 막는다.
    if (this.clock - this.tierChangedAt < Stage3D.TIER_DWELL_SEC) return;
    if (this.frameMs > 22 && this.tier < 3) this.setTier(this.tier + 1);
    else if (this.frameMs < 15 && this.tier > 0) this.setTier(this.tier - 1);
  }

  /**
   * 티어 t 를 절대값으로 적용한다 -- 이전 티어에서 얼마나 깎여 있었는지와 무관하게
   * 항상 같은 결과가 나온다. drift/waterVolume 의 setQuality(k) 는 매번 "기준값의
   * k 배"로 다시 계산하지 (이미 깎인 값에 또 곱하지) 않으므로, 2 -> 1 -> 2 처럼
   * 오르내려도 갈수록 더 깎이는 일이 없다.
   */
  private setTier(t: number): void {
    this.tier = t;
    this.tierChangedAt = this.clock;
    this.drift.setQuality(t >= 1 ? 0.5 : 1);
    this.waterVolume.setQuality(t >= 2 ? 0.4 : 1);
    this.waterVolume.setMood(this.mood, this.clearBand(), CAM_Z);
    this.renderer.setPixelRatio(t >= 3 ? 1.25 : this.dpr);
  }

  render(): void {
    // 1차 패스 -- 기본 레이어(0). 자갈·포식자·부유물·광선판과 장면 key/fill 조명이
    // 전부 여기 있다. 잠수부는 diver.ts 의 load() 가 DIVER_LIGHT_LAYER 로 옮겨
    // 둔 터라 카메라 기본 레이어(0)엔 안 걸린다 -- 이 패스의 결과는 잠수부 관련
    // 변경과 무관하게 지금까지와 완전히 같다(자갈 밝기·광선판 모양 보존 요구사항이
    // 여기서 지켜진다).
    this.renderer.render(this.scene, this.camera);

    // 2차 패스 -- 카메라를 잠깐 잠수부 전용 레이어로 바꿔 그 위에 잠수부만 다시
    // 그린다. three 는 조명이 이번 프레임에 반영될지를 camera.layers 로만 가른다
    // (오브젝트별로 어떤 조명이 어떤 메시에 닿는지 따로 거르지 않는다 --
    // node_modules/three/src/renderers/WebGLRenderer.js 의 projectObject() 와
    // webgl/WebGLLights.js 의 setup() 참고, diver.ts 생성자 주석에 근거를 적어 뒀다).
    // 그래서 "조명과 메시가 레이어만 공유"하는 정도로는 장면 key/fill 과 안 섞이게
    // 못 막는다 -- 카메라가 이번 패스에서 무슨 레이어를 보는지 자체를 바꿔야
    // 장면 조명(레이어 0)이 아예 안 잡히고, 잠수부 전용 조명(레이어
    // DIVER_LIGHT_LAYER)만 반영된다. autoClear 를 꺼서 1차 패스 결과 위에 그대로
    // 덧그린다 -- 잠수부는 카메라와 가장 가까운(z=1.2) 오브젝트라 깊이 판정도
    // 그대로 통과한다. 부수 효과로 광선판(가산·깊이 무시, waterVolume.ts)이 이제
    // 잠수부보다 먼저 그려져 있어 더는 그 위에 덮이지 않는다 -- 잠수부 색이 안
    // 살아나던 원인 중 하나였던 그 겹침이 자연히 없어진다.
    this.camera.layers.set(DIVER_LIGHT_LAYER);
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = true;
    this.camera.layers.set(0);
  }

  dispose(): void {
    this.seafloor.dispose();
    this.waterVolume.dispose();
    this.drift.dispose();
    this.diver.dispose();
    this.predators.dispose();
    for (const l of this.lights) this.scene.remove(l);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
