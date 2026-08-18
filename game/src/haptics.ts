// 진동 피드백. 지원하지 않는 기기에서는 조용히 무시된다.

import { getSave } from './storage.ts';

function buzz(pattern: number | number[]): void {
  if (!getSave().settings.haptics) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // 일부 브라우저는 사용자 제스처 없이 부르면 예외를 던진다
  }
}

export const haptics = {
  tap: () => buzz(8),
  swap: () => buzz(12),
  invalid: () => buzz([20, 40, 20]),
  clear: () => buzz(16),
  special: () => buzz([12, 20, 24]),
  win: () => buzz([24, 40, 24, 40, 60]),
  lose: () => buzz([60, 60, 60]),
};
