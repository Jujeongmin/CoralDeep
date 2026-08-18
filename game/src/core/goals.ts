// 레벨 목표 진행도.

import type { Board, Collected, Goal } from './types.ts';
import { countBlockers } from './board.ts';

export interface GoalProgress {
  goal: Goal;
  done: number;
  /** 목표 수량 (레벨에서 0 이하로 두면 보드에서 자동 계산) */
  target: number;
}

export function initGoals(goals: Goal[], board: Board): GoalProgress[] {
  const present = countBlockers(board);
  return goals.map((goal) => {
    let target = goal.count;
    if (target <= 0) {
      if (goal.type === 'rock') target = present.rock;
      else if (goal.type === 'ice') target = present.ice;
      else if (goal.type === 'net') target = present.net;
      // 탈출은 '길이 이어졌는가' 하나뿐이다
      else if (goal.type === 'escape') target = 1;
      else target = 1;
    }
    return { goal, done: 0, target };
  });
}

export function applyCollected(progress: GoalProgress[], collected: Collected): void {
  for (const p of progress) {
    switch (p.goal.type) {
      case 'rock':
        p.done = Math.min(p.target, p.done + collected.rock);
        break;
      case 'ice':
        p.done = Math.min(p.target, p.done + collected.ice);
        break;
      case 'net':
        p.done = Math.min(p.target, p.done + collected.net);
        break;
      case 'escape':
        p.done = Math.min(p.target, p.done + collected.escaped);
        break;
      case 'color': {
        const c = p.goal.color;
        if (c === undefined) break;
        p.done = Math.min(p.target, p.done + (collected.colors[c] ?? 0));
        break;
      }
    }
  }
}

export function goalsComplete(progress: GoalProgress[]): boolean {
  return progress.every((p) => p.done >= p.target);
}

/** 아직 탈출하지 못한 잠수부가 남아있는가 (산소 제한이 걸리는 조건) */
export function rescuePending(progress: GoalProgress[]): boolean {
  return progress.some((p) => p.goal.type === 'escape' && p.done < p.target);
}

export function remainingTotal(progress: GoalProgress[]): number {
  return progress.reduce((sum, p) => sum + Math.max(0, p.target - p.done), 0);
}

/**
 * 남은 이동 수에 따라 별 개수를 준다.
 * 3별: 목표 달성 + 이동 30% 이상 남김 / 2별: 10% 이상 / 1별: 달성만.
 */
export function starsFor(movesLeft: number, totalMoves: number): 1 | 2 | 3 {
  const ratio = totalMoves > 0 ? movesLeft / totalMoves : 0;
  if (ratio >= 0.3) return 3;
  if (ratio >= 0.1) return 2;
  return 1;
}
