// 상단 재화 바. 하트/진주/불가사리 + 각 항목이 광고 모달로 이어진다.

import { el } from '../ui.ts';
import { icon } from '../icons.ts';
import { formatDuration, t, tf } from '../i18n.ts';
import { MAX_HEARTS, refreshHearts } from '../economy.ts';
import { getSave } from '../storage.ts';
import { openHeartsModal, openShopModal, openStarModal } from './modals.ts';

export interface Hud {
  root: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export function createHud(): Hud {
  const heartValue = el('span', { class: 'hud-value' });
  const heartTimer = el('span', { class: 'hud-timer' });
  const pearlValue = el('span', { class: 'hud-value' });
  const starValue = el('span', { class: 'hud-value' });

  const heartChip = el(
    'button',
    { class: 'hud-chip hud-heart', 'aria-label': t('hearts') },
    icon('heart', 18),
    heartValue,
    heartTimer,
  );
  const pearlChip = el(
    'button',
    { class: 'hud-chip hud-pearl', 'aria-label': t('pearls') },
    icon('pearl', 18),
    pearlValue,
    icon('plus', 14, 'hud-plus'),
  );
  const starChip = el(
    'button',
    { class: 'hud-chip hud-star', 'aria-label': t('stars') },
    icon('starfish', 18),
    starValue,
    icon('plus', 14, 'hud-plus'),
  );

  heartChip.addEventListener('click', () => openHeartsModal(refresh));
  pearlChip.addEventListener('click', () => openShopModal(refresh));
  starChip.addEventListener('click', () => openStarModal(refresh));

  const root = el('div', { class: 'hud' }, heartChip, pearlChip, starChip);

  function refresh(): void {
    const hearts = refreshHearts();
    const save = getSave();
    if (hearts.infinite) {
      heartValue.textContent = '∞';
      // 남은 시간이 없는 무한(개발 빌드)은 0:00 을 띄우지 않는다
      heartTimer.textContent =
        hearts.infiniteMsLeft > 0 ? formatDuration(hearts.infiniteMsLeft) : '';
    } else {
      heartValue.textContent = `${hearts.hearts}/${MAX_HEARTS}`;
      heartTimer.textContent = hearts.msToNext > 0 ? formatDuration(hearts.msToNext) : '';
    }
    heartChip.title = hearts.msToNext > 0 ? tf('heartNext', { t: formatDuration(hearts.msToNext) }) : t('heartFull');
    pearlValue.textContent = String(save.pearls);
    starValue.textContent = String(save.stars);
  }

  refresh();
  const timer = window.setInterval(refresh, 1000);

  return {
    root,
    refresh,
    destroy: () => window.clearInterval(timer),
  };
}
