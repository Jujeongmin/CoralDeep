// three.js 무대 — renderer·scene·camera·리사이즈·품질 티어·해제.
//
// 렌더 루프를 여기서 돌리지 않는다. BoardView 의 RAF 가 step() 과 render() 를 부른다.
// 루프가 둘이면 보드와 3D 가 서로 다른 프레임을 보게 되어 흔들림이 어긋난다.
//
// 3D 캔버스는 보드보다 '앞'에 있다 (설계 문서 참고). 그래서 이 무대의 오브젝트는
// 보드 사각형의 화면 영역을 침범하면 안 된다. 잠수부만 탈출 중에 예외로 들어온다.

import * as THREE from 'three';

import { depthMood } from '../render/depth.ts';
import { type PlaneView, planeView, pxToWorld, screenToPlane } from './projection.ts';
import type { BoardRect, DescentPoint, SceneView, Stage } from './types.ts';

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
  private dpr = 1;
  private board: BoardRect | null = null;
  private mood = depthMood(0);
  private probe: THREE.Mesh;

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

    // 정합 확인용 임시 사각형. Task 3 에서 자갈 해저가 대체한다.
    this.probe = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x33ff88, wireframe: true }),
    );
    this.scene.add(this.probe);

    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.view = planeView(this.w, this.h, FOV, CAM_Z);
    if (this.board) this.setBoardRect(this.board);
  }

  setBoardRect(r: BoardRect): void {
    this.board = r;
    const c = screenToPlane(r.x + r.w / 2, r.y + r.h / 2, this.w, this.h, this.view);
    this.probe.position.set(c.x, c.y, 0);
    this.probe.scale.set(pxToWorld(r.w, this.view), pxToWorld(r.h, this.view), 1);
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
  step(_dt: number): void {}

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.probe.geometry.dispose();
    (this.probe.material as THREE.Material).dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
