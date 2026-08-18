// three.js 무대 — renderer·scene·camera·리사이즈·품질 티어·해제.
//
// 렌더 루프를 여기서 돌리지 않는다. BoardView 의 RAF 가 step() 과 render() 를 부른다.
// 루프가 둘이면 보드와 3D 가 서로 다른 프레임을 보게 되어 흔들림이 어긋난다.
//
// 3D 캔버스는 보드보다 '앞'에 있다 (설계 문서 참고). 그래서 이 무대의 오브젝트는
// 보드 사각형의 화면 영역을 침범하면 안 된다. 잠수부만 탈출 중에 예외로 들어온다.

import * as THREE from 'three';

import { depthMood } from '../render/depth.ts';
import { Drift } from './particles.ts';
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
  private seafloor = new Seafloor(this.scene);
  private waterVolume = new WaterVolume(this.scene);
  private drift = new Drift(this.scene);
  private lights: THREE.Light[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private depth: number,
  ) {
    this.mood = depthMood(this.depth);
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

    this.resize();
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
   * 보드 사각형 밖에서 가장 넓은 빈 띠 -- 광선은 여기에만 세운다.
   *
   * 보드가 화면 위쪽에 있으면 아래가, 아래쪽에 있으면 위가 넓다. 8번 과제가 보드를
   * 아래로 내리면 이 계산은 저절로 반대로 나온다 -- 위/아래를 여기서 하드코딩하지
   * 않는다. 보드 사각형을 아직 모르면(첫 프레임 한정) 화면 전체를 빈 띠로 본다.
   */
  private clearBand(): HoleBox {
    if (!this.board) {
      const c = screenToPlane(this.w / 2, this.h / 2, this.w, this.h, this.view);
      return { cx: c.x, cy: c.y, w: this.view.worldW, h: this.view.worldH };
    }
    const boardTop = this.board.y - this.top;
    const boardBottom = boardTop + this.board.h;
    const aboveH = Math.max(0, boardTop);
    const belowH = Math.max(0, this.h - boardBottom);
    const bandTop = aboveH >= belowH ? 0 : boardBottom;
    const bandH = Math.max(aboveH, belowH);
    const c = screenToPlane(this.w / 2, bandTop + bandH / 2, this.w, this.h, this.view);
    return { cx: c.x, cy: c.y, w: this.view.worldW, h: pxToWorld(bandH, this.view) };
  }

  setBoardRect(r: BoardRect): void {
    this.board = r;
    // r 은 뷰포트 좌표다. 이 캔버스의 원점을 빼서 캔버스 로컬로 옮긴다.
    const cx = r.x + r.w / 2 - this.left;
    const cy = r.y + r.h / 2 - this.top;
    const c = screenToPlane(cx, cy, this.w, this.h, this.view);
    this.seafloor.layout(
      { cx: c.x, cy: c.y, w: pxToWorld(r.w, this.view), h: pxToWorld(r.h, this.view) },
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
  }

  setView(_v: SceneView): void {}
  setDescent(_p: DescentPoint | null): void {}

  diverAnchorScreen(): { x: number; y: number } {
    return { x: this.w / 2, y: this.h * 0.22 };
  }

  shake(): number {
    return 0;
  }

  cheer(): void {}
  rescued(): void {}

  step(dt: number): void {
    this.seafloor.step(dt);
    this.waterVolume.step(dt);
    this.drift.step(dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.seafloor.dispose();
    this.waterVolume.dispose();
    this.drift.dispose();
    for (const l of this.lights) this.scene.remove(l);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
