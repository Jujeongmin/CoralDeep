// 곰치 머리 리그.
//
// 머리는 한 장이 아니라 위턱(`eelHead`)과 아래턱(`eelJaw`) 두 조각이고,
// 경첩에서 실제로 벌어진다. 그 조립 규칙(경첩 위치, 벌릴 때 위턱이 같이 젖혀지는 양)이
// 여기 한 곳에만 있어야 한다 — 장면과 실패 모달이 서로 다른 곰치를 그리면 같은 적으로 안 보인다.

import { drawPart } from '../sprites.ts';

/** 스프라이트 원본 크기 (viewBox) — 배율 계산용 */
export const EEL_HEAD_W = 190;
export const EEL_HEAD_H = 130;
/** 회전 기준점(목덜미)이 스프라이트 안에서 놓인 자리 */
export const EEL_PIVOT_X = 10;
export const EEL_PIVOT_Y = 60;

export interface EelHeadPose {
  /** 목덜미(회전 기준점)를 놓을 캔버스 좌표 */
  x: number;
  y: number;
  /** 스프라이트 원본 대비 배율 */
  scale: number;
  /** 0 = 다문 입, 1 = 크게 벌린 입 */
  open: number;
  /** 머리 전체 방향 (라디안) */
  rotation?: number;
  /**
   * 세로 뒤집기. 왼쪽을 향할 때 -1.
   *
   * 스프라이트는 오른쪽을 보고 그려져 있다. 왼쪽으로 가려고 180° 돌리면 위아래까지
   * 같이 뒤집혀 배가 하늘로 간다. 회전만으로는 '왼쪽을 보는 곰치'를 만들 수 없어서
   * 뒤집기를 한 번 더 넣는다.
   */
  flip?: 1 | -1;
  /**
   * `'jaw'` 면 아래턱만 그린다.
   *
   * 머리는 잠수부보다 **뒤에** 그려진다. 코앞까지 왔을 때 그대로 두면 사람이 턱
   * 앞에 선 것처럼 보여 거리감이 죽는다. 배경에 머리를 다 그린 뒤 아래턱만 한 번 더
   * 앞에 얹으면, 잠수부가 위턱과 아래턱 **사이**에 놓인다.
   */
  part?: 'all' | 'jaw';
}

/**
 * 곰치 머리 한 개를 그린다.
 *
 * 아래턱을 먼저 그려야 위턱이 그 위를 덮어 경첩 이음매가 안 보인다.
 * 입을 벌릴 때 아래턱만 내리면 턱이 빠진 것처럼 보인다 — 위턱도 조금 젖혀야
 * 실제로 '벌어지는' 동작이 된다 (0.5 : 0.16 비율).
 */
export function drawEelHead(ctx: CanvasRenderingContext2D, pose: EelHeadPose): void {
  const { x, y, scale, open } = pose;
  ctx.save();
  ctx.translate(x, y);
  if (pose.rotation) ctx.rotate(pose.rotation);
  if (pose.flip === -1) ctx.scale(1, -1);
  // 아래턱 경첩은 머리 기준점에서 입꼬리 쪽으로 (20, 10)
  drawPart(ctx, 'eelJaw', {
    x: 20 * scale,
    y: 10 * scale,
    scale,
    rotation: open * 0.5,
  });
  if (pose.part !== 'jaw') {
    drawPart(ctx, 'eelHead', { x: 0, y: 0, scale, rotation: -open * 0.16 });
  }
  ctx.restore();
}
