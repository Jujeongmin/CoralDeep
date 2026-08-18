// 포식자 — 곰치 · 아귀 · 대왕오징어 촉수. 한 번에 하나만 씬에 있다.
//
// 셋의 생김새와 등장 방향은 다르지만 '얼마나 가까워졌는가'는 하나의 값(danger)이다.
//   * 곰치 — 오른쪽 바위굴에서 몸을 뻗는다. 뻗어 나온 길이가 남은 시간이다.
//   * 아귀 — 열린 물에서 헤엄쳐 온다. 유인등이 먼저 보이고 몸은 물빛에 잠겨 있다가
//     가까워져야 드러난다. 얼마나 보이는가가 시간이다.
//   * 촉수 — 위에서 팔 하나만 내려온다. 몸통을 끝내 안 보여주는 게 핵심이다.
//     화면 밖에 얼마나 큰 게 있는지 모르는 편이 다 보여주는 것보다 무섭다.
//
// 2D 때 쓰던 트릭 하나가 필요 없어졌다: danger 가 높을 때 아래턱만 잠수부 위에 한 번 더
// 그리던 것. 3D 는 깊이 버퍼가 알아서 하므로 접근 곡선의 z 를 잠수부보다 앞으로 잡기만
// 하면 잠수부가 위턱과 아래턱 사이에 놓인다.

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import type { PredatorKind } from '../levels.ts';

/** 튜브 분할 수. 정점 개수가 프레임마다 같아야 버퍼를 재할당하지 않는다. */
const TUBE_SEG = 24;
const TUBE_RADIAL = 6;

export class Predators {
  private group = new THREE.Group();
  private body: THREE.Mesh;
  private lure: THREE.Mesh | null = null;
  private curve: THREE.CatmullRomCurve3;
  private mat: THREE.MeshLambertMaterial;
  private lureMat: THREE.MeshBasicMaterial | null = null;
  private t = 0;
  private danger = 0;

  constructor(
    private scene: THREE.Scene,
    private kind: PredatorKind,
  ) {
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints(0));
    this.mat = new THREE.MeshLambertMaterial({ color: 0x2c4450, flatShading: true });
    this.body = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, TUBE_SEG, 0.28, TUBE_RADIAL, false),
      this.mat,
    );
    this.group.add(this.body);

    if (kind === 'angler') {
      this.lureMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
      this.lure = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.lureMat);
      this.group.add(this.lure);
    }
    scene.add(this.group);
  }

  /**
   * 접근 곡선의 제어점.
   *
   * y 는 전부 양수다 — 보드는 화면 아래쪽(8번 과제로 바닥 정렬)에 있고 3D 는 보드를
   * 침범하면 안 된다. z 는 danger 가 커질수록 카메라 쪽(양수)으로 다가온다 —
   * depthProjection.ts 의 depthScale() 때문에 카메라에 가까운 점일수록 화면에는 y 가
   * 원점에서 더 멀리(위로) 찍힌다. 즉 이 곡선은 다가올수록 실제로도 화면에서 더
   * 위쪽(빈 띠 안쪽)으로 밀린다 — predators.test.ts 가 이 값들을 그대로 옮겨 적어
   * depthProjection.ts 의 projectPebble() 로 danger=1 에서도 보드 사각형을 침범하지
   * 않는지 검증한다(diver.test.ts 가 diver.ts 의 상수를 옮겨 적는 것과 같은 이유 —
   * 이 클래스도 parameter property 를 써서 npm test 의 Node 내장 strip-only 로더로
   * 못 읽는다).
   *
   * @param k 접근도 0..1
   */
  private controlPoints(k: number): THREE.Vector3[] {
    const reach = k;
    switch (this.kind) {
      case 'eel':
        return [
          new THREE.Vector3(4.2, 2.2, -1.5),
          new THREE.Vector3(4.2 - 1.6 * reach, 2.1, -1.0),
          new THREE.Vector3(4.2 - 3.2 * reach, 1.8, -0.2 + 1.4 * reach),
          new THREE.Vector3(4.2 - 4.6 * reach, 1.6, 0.2 + 1.6 * reach),
        ];
      case 'angler':
        return [
          new THREE.Vector3(-4.5, 3.0, -3.0),
          new THREE.Vector3(-3.0 + 1.2 * reach, 2.8, -2.2 + 0.8 * reach),
          new THREE.Vector3(-1.6 + 1.4 * reach, 2.4, -1.0 + 1.4 * reach),
          new THREE.Vector3(-0.4 + 0.6 * reach, 2.0, 0.2 + 1.4 * reach),
        ];
      case 'tentacle':
      default:
        return [
          new THREE.Vector3(1.4, 5.8, -2.0),
          new THREE.Vector3(1.2, 4.8 - 0.9 * reach, -1.2),
          new THREE.Vector3(0.7, 3.8 - 1.2 * reach, -0.2 + 1.0 * reach),
          new THREE.Vector3(0.2, 2.8 - 1.0 * reach, 0.4 + 1.4 * reach),
        ];
    }
  }

  setDanger(d: number): void {
    this.danger = Math.max(0, Math.min(1, d));
  }

  setMood(mood: DepthMood): void {
    const k = 1 - mood.gloom * 0.5;
    this.mat.color.setRGB(0.17 * k, 0.27 * k, 0.31 * k);
    if (this.lureMat) {
      this.lureMat.color.setRGB(
        mood.glowColor[0] / 255,
        mood.glowColor[1] / 255,
        mood.glowColor[2] / 255,
      );
    }
  }

  /**
   * 곡선을 갱신하고 정점만 다시 계산한다.
   *
   * TubeGeometry 를 매 프레임 새로 만들면 안 된다 — 초당 60개씩 지오메트리를 할당하고
   * GPU 버퍼를 통째로 다시 올리게 된다. 세그먼트 수가 고정이라 정점 개수는 안 변하므로,
   * 같은 규격으로 한 번 만들어 두고 position 속성만 덮어쓴다.
   */
  private rebuild(): void {
    // 뻗어 나온 길이가 남은 시간이다. 흔들림은 주기가 어긋난 사인이 만든다.
    const wobble = Math.sin(this.t * 1.3) * 0.12 * (0.3 + this.danger);
    const pts = this.controlPoints(this.danger);
    for (let i = 1; i < pts.length; i++) pts[i].x += wobble * i * 0.3;
    this.curve.points = pts;

    const radius = 0.28 + this.danger * 0.1;
    const next = new THREE.TubeGeometry(this.curve, TUBE_SEG, radius, TUBE_RADIAL, false);
    const src = next.getAttribute('position') as THREE.BufferAttribute;
    const dst = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    (dst.array as Float32Array).set(src.array as Float32Array);
    dst.needsUpdate = true;
    const sn = next.getAttribute('normal') as THREE.BufferAttribute;
    const dn = this.body.geometry.getAttribute('normal') as THREE.BufferAttribute;
    (dn.array as Float32Array).set(sn.array as Float32Array);
    dn.needsUpdate = true;
    this.body.geometry.computeBoundingSphere();
    next.dispose();

    if (this.lure) this.lure.position.copy(this.curve.getPoint(1));
  }

  step(dt: number): void {
    this.t += dt;
    this.rebuild();
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.body.geometry.dispose();
    this.mat.dispose();
    this.lure?.geometry.dispose();
    this.lureMat?.dispose();
  }
}
