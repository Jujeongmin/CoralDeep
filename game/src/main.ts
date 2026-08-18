// 진입점. Verse8 계정을 확인하고 저장을 붙인 뒤 지도 화면으로 간다.

import './style.css';

import {
  flushSave,
  getSave,
  loadSave,
  makeLocalAdapter,
  migrateGuestSave,
  mutateSave,
  setAdapter,
} from './storage.ts';
import { navigate, registerScreen, setHost } from './router.ts';
import { renderMap } from './screens/map.ts';
import { renderAquarium } from './screens/aquariumScreen.ts';
import { renderLevel } from './screens/level.ts';
import { refreshHearts } from './economy.ts';
import { unlockAudio } from './audio.ts';

/**
 * Verse8 플랫폼이 iframe URL 에 넣어주는 ?auth= 토큰에서 계정을 꺼낸다.
 * 로컬 개발이나 토큰이 없을 때는 guest 로 떨어진다 — 게임은 그대로 돌아간다.
 */
async function resolveAccount(): Promise<string | null> {
  try {
    const { Verse8 } = await import('@verse8/platform/vanilla');
    const user = await Verse8.getUser();
    return user?.account ?? null;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app not found');

  const account = await resolveAccount();
  // 로그인 전 guest 로 플레이한 진행도를 계정으로 옮긴다 (계정 저장이 이미 있으면 그쪽이 우선)
  migrateGuestSave(account);
  setAdapter(makeLocalAdapter(account));
  const save = await loadSave();

  // 브라우저 언어에 맞춰 첫 언어를 정한다 (이후에는 설정을 따른다)
  if (!save.nickname) {
    const prefersKorean = navigator.language?.toLowerCase().startsWith('ko');
    mutateSave((s) => {
      s.settings.lang = prefersKorean ? 'ko' : 'en';
      s.nickname = account ? account.slice(0, 6) : 'guest';
    });
  }

  refreshHearts();
  unlockAudio();

  setHost(app);
  registerScreen('map', renderMap);
  registerScreen('aquarium', renderAquarium);
  registerScreen('level', renderLevel);
  navigate('map');

  // 개발 환경 전용 디버그 훅 (프로덕션 번들에서는 통째로 제거된다)
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__coralDeepDev = {
      save: getSave,
      mutate: mutateSave,
      flush: flushSave,
      go: navigate,
      account,
    };
  }

  // 탭을 벗어날 때 확실히 저장
  window.addEventListener('pagehide', () => void flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
}

void boot();
