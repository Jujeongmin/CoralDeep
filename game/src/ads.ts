// Verse8 광고 SDK 어댑터.
//
// 공식 문서: https://docs.verse8.io/docs/ads/intro
//   Verse8Ads.showRewarded({ placementId, timeoutMs })
//     -> { status: 'rewarded' | 'dismissed' | 'failed', requestId?, reward?, error? }
//
// 규칙
//  - 보상형은 반드시 사용자의 클릭에서만 호출한다 (자동 재생 금지).
//  - 프로덕션에서 SDK 가 실패하면 실패로 처리한다. 가짜 광고를 절대 보여주지 않는다.
//  - 개발 환경(import.meta.env.DEV)에서만 시뮬레이션 오버레이로 폴백한다.

import { Verse8Ads } from '@verse8/ads';
import { t, tf } from './i18n.ts';
import { noteShown, type PlacementId } from './adPolicy.ts';

export type AdStatus = 'rewarded' | 'skipped' | 'failed';

export interface RewardedOutcome {
  status: AdStatus;
  /** 서버 사이드 검증용 상관 ID. 시뮬레이션에는 없다. */
  requestId?: string;
}

const SIM_DURATION = 4;
let initialized = false;
let busy = false;

function ensureInit(): void {
  if (initialized) return;
  Verse8Ads.init({ debug: import.meta.env.DEV });
  initialized = true;
}

/** 광고가 재생 중인가 (버튼 중복 클릭 차단용) */
export function adBusy(): boolean {
  return busy;
}

// ---------- 개발 환경 시뮬레이션 ----------

function simulate(): Promise<AdStatus> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ad-overlay';
    overlay.innerHTML = `
      <div class="ad-frame">
        <span class="ad-badge">AD · REWARDED</span>
        <div class="ad-stage">
          <div class="ad-spinner"></div>
          <p class="ad-caption">${t('adCaption')}</p>
          <p class="ad-devnote">${t('adDevNote')}</p>
        </div>
        <div class="ad-progress"><i></i></div>
        <div class="ad-foot">
          <span class="ad-timer">${tf('adTimerWait', { n: SIM_DURATION })}</span>
          <button class="ad-close" disabled aria-label="${t('adCloseAria')}">✕</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const bar = overlay.querySelector('.ad-progress i') as HTMLElement;
    const timerText = overlay.querySelector('.ad-timer') as HTMLElement;
    const closeBtn = overlay.querySelector('.ad-close') as HTMLButtonElement;

    // 경과는 실제 시각으로 잰다. 탭이 백그라운드로 가면 setInterval 이 1초로 조여지므로
    // 틱 수를 더하는 방식은 크게 어긋난다.
    const startedAt = performance.now();
    let elapsed = 0;
    const tickMs = 100;
    const tick = window.setInterval(() => {
      elapsed = (performance.now() - startedAt) / 1000;
      const ratio = Math.min(1, elapsed / SIM_DURATION);
      bar.style.width = `${ratio * 100}%`;
      if (ratio >= 1) {
        window.clearInterval(tick);
        timerText.textContent = t('adTimerReady');
        closeBtn.disabled = false;
        closeBtn.classList.add('ready');
      } else {
        timerText.textContent = tf('adTimerWait', { n: Math.ceil(SIM_DURATION - elapsed) });
      }
    }, tickMs);

    closeBtn.addEventListener('click', () => {
      window.clearInterval(tick);
      overlay.remove();
      resolve(elapsed >= SIM_DURATION ? 'rewarded' : 'skipped');
    });
  });
}

// ---------- 공개 API ----------

/**
 * 보상형 광고를 재생한다. 반드시 사용자 클릭 핸들러 안에서 호출할 것.
 * 성공(rewarded)일 때만 보상을 지급한다.
 */
export async function showRewarded(placementId: PlacementId): Promise<RewardedOutcome> {
  if (busy) return { status: 'failed' };
  busy = true;
  ensureInit();

  try {
    const result = await Verse8Ads.showRewarded({ placementId, timeoutMs: 120_000 });
    switch (result.status) {
      case 'rewarded':
        noteShown(placementId);
        return { status: 'rewarded', requestId: result.requestId };
      case 'dismissed':
        return { status: 'skipped' };
      default: {
        if (import.meta.env.DEV) {
          const status = await simulate();
          if (status === 'rewarded') noteShown(placementId);
          return { status };
        }
        return { status: 'failed' };
      }
    }
  } catch {
    if (import.meta.env.DEV) {
      const status = await simulate();
      if (status === 'rewarded') noteShown(placementId);
      return { status };
    }
    return { status: 'failed' };
  } finally {
    busy = false;
  }
}
