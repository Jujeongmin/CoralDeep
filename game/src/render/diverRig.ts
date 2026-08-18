// 잠수부 그리기.
//
// 예전에는 부위별 스프라이트를 관절마다 돌려 팔다리를 허우적거리게 했다. 그걸 버렸다.
// 저폴리 모델은 관절부가 실제로 이어져 있지 않아서, 꺾을수록 이음매가 벌어지고
// 종이인형처럼 보인다. 게다가 그 동작은 '살아 있음'보다 '덜컹거림'으로 읽혔다.
//
// 지금은 **포즈를 미리 잡아 구운 한 장**을 쓴다 (`tools/bake-diver-3d.mjs` 가 3D 에서
// 팔을 내린 뒤 통째로 렌더한다). 움직임은 관절이 아니라 **몸 전체**가 만든다:
// 물에 뜬 사람은 팔다리를 휘젓는 게 아니라 천천히 오르내리며 좌우로 기운다.

import { DIVER_META, drawPart } from '../sprites.ts';

/** 머리 꼭대기 ~ 발바닥 전체 높이 (배율 계산용) */
export const DIVER_SPAN = DIVER_META.rig.span;

/**
 * 기준점에서 발바닥까지의 거리.
 *
 * 장면에서 잠수부를 어디에 놓을지는 '어깨를 어디 둘까'가 아니라 **'발이 어디 닿을까'**로
 * 정해야 한다. 기준점을 고정해두면 크기를 조금만 바꿔도 발이 바위 턱에서 떠오른다.
 */
export const DIVER_FEET = DIVER_META.rig.feet;

export interface DiverPose {
  /** 기준점(몸통 윗면) 위치 */
  x: number;
  y: number;
  /** 스프라이트 원본 대비 배율 */
  scale: number;
  /** 애니메이션 시간 */
  time: number;
  /** 0 = 침착, 1 = 위급. 흔들림의 속도와 폭을 함께 올린다. */
  panic: number;
  /** 0..1 탈출 중 — 아래로 빠져나가며 몸을 앞으로 기울인다 */
  escape?: number;
  /** 0..1 환호 (장애물을 부쉈을 때 한 번 솟구친다) */
  cheer?: number;
  alpha?: number;
}

/**
 * 잠수부 한 명을 그린다.
 *
 * 흔들림은 주기가 다른 두 사인의 합이다. 하나만 쓰면 시계추처럼 규칙적이라
 * 기계로 보인다 — 주기가 어긋나는 둘을 겹쳐야 물결에 밀리는 것처럼 읽힌다.
 */
export function drawDiver(ctx: CanvasRenderingContext2D, pose: DiverPose): void {
  const { x, y, scale, time } = pose;
  const panic = Math.max(0, Math.min(1.4, pose.panic));
  const escape = pose.escape ?? 0;
  const cheer = pose.cheer ?? 0;

  // 위급할수록 빠르고 크게 — 다만 '허우적'이 아니라 '흔들림'의 폭이다
  const speed = 1 + panic * 1.6;
  const sway = 0.05 + panic * 0.09;

  // 좌우로 기울기
  const tilt =
    (Math.sin(time * speed) * 0.7 + Math.sin(time * speed * 1.7 + 1.3) * 0.3) * sway;
  // 위아래로 뜨고 가라앉기 (원본 단위)
  const bob = (Math.sin(time * speed * 0.8) * 0.6 + Math.sin(time * speed * 1.3) * 0.4) * 6;
  // 환호하면 잠깐 솟구친다
  const lift = cheer * 26;

  ctx.save();
  ctx.globalAlpha = pose.alpha ?? 1;
  ctx.translate(x, y + (bob - lift) * scale);
  // 빠져나갈 때는 아래를 향해 몸을 앞으로 눕힌다
  ctx.rotate(tilt + escape * 0.3);
  drawPart(ctx, 'diver', { x: 0, y: 0, scale });
  ctx.restore();
}

/** 기포가 나오는 지점 (헬멧 옆) */
export function helmetPos(pose: DiverPose): [number, number] {
  return [pose.x + 26 * pose.scale, pose.y - 34 * pose.scale];
}
