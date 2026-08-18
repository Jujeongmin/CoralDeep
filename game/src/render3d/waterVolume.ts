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

import * as THREE from 'three';

import type { DepthMood } from '../render/depth.ts';
import { depthScale, type HoleBox } from './seafloor.ts';

const MAX_SHAFTS = 5;

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
      const y0 = clear.cy;
      this.shafts[i].position.set(x0 * dk, y0 * dk, z);
      this.shafts[i].rotation.z = (k - 0.5) * 0.5;
      this.shafts[i].scale.set(clear.w * 0.16 * dk, clear.h * 0.9 * dk, 1);
      this.mats[i].opacity = 0.05 + mood.shafts * 0.1;
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
