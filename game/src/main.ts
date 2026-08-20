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
import { currentScreen, navigate, registerScreen, reloadScreen, setHost } from './router.ts';
import { renderMap } from './screens/map.ts';
import { renderAquarium } from './screens/aquariumScreen.ts';
import { renderLevel } from './screens/level.ts';
import { refreshHearts } from './economy.ts';
import { startMusic, unlockAudio } from './audio.ts';
import { flushPendingClears, initServerAccount, syncNow } from './net/serverAccount.ts';
import { initVxShop } from './net/vx.ts';

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
  // 배경 음악은 화면이 아니라 앱에 매단다 — 지도·수족관·판 안 어디서든 같은 곡이
  // 끊기지 않고 이어진다. 자동재생이 막힌 브라우저(모바일 대부분)에서는 여기서
  // 조용히 실패하고, 첫 터치에서 unlockAudio() 의 리스너가 다시 켠다.
  void startMusic();

  // 계정 서버와의 첫 동기화(마이그레이션)는 배경에서 돈다 — 로컬은 이미 위에서
  // loadSave() 로 준비됐으므로, 접속이 느리거나 서버가 없어도(배포 전, 오프라인)
  // 첫 화면 진입을 막지 않는다. 서버 값이 오면 그때 로컬을 계정 값으로 맞춘다.
  //
  // 계정 값이 도착하면 지금 화면을 다시 그린다. 지도는 이미 로컬 값으로 떠 있는데,
  // 저장소가 막힌 기기에서는 그 값이 빈 상태라 계정에 있는 진행도가 화면에 안 나타난다
  // — 다시 그려야 그때 열린 단계까지 보인다. 판을 푸는 중에는 reloadScreen 이 알아서
  // 지도로 되돌리는 대신 진행을 버리므로, 지도/수족관에 있을 때만 다시 그린다.
  void initServerAccount(() => {
    const screen = currentScreen();
    if (screen === 'map' || screen === 'aquarium') reloadScreen();
  });

  // VXShop 카탈로그(광고제거 가격·구매 가능 여부)도 미리 당겨 둔다. 상점을 열 때 처음
  // 부르면 그 순간 로딩 중이라 폴백 가격이 잠깐 보였다가 실제 값으로 바뀐다 — 여기서
  // 미리 불러 두면 그 깜빡임이 줄어든다. 실패해도(배포 전, 오프라인) 조용히 넘어간다
  // (`net/vx.ts` 의 `vxRemoveAdsPrice`/`isRemoveAdsPurchasable` 이 폴백을 갖고 있다).
  initVxShop();

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

  // 탭을 벗어날 때 확실히 저장. 계정 서버에도 같은 타이밍에 최선노력으로 밀어 둔다 —
  // 그 사이 로컬에서만 소비된 것(부스터·하트 사용 등)이 계정에 반영될 마지막 기회다.
  window.addEventListener('pagehide', () => {
    void flushSave();
    syncNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushSave();
      syncNow();
      return;
    }
    // 돌아왔을 때는 밀린 클리어를 다시 밀어 본다. 나가 있는 동안 회선이 살아났을 수
    // 있고, 이 큐는 오래 들고 있을수록 다른 기기와 어긋난다.
    //
    // 이어서 계정도 다시 읽는다. 예전에는 계정을 **부팅 때 한 번만** 읽어서, PC 에서
    // 깬 판이 이미 켜져 있던 폰에는 앱을 껐다 켜기 전까지 안 나타났다. 앱으로 돌아오는
    // 순간이 다른 기기의 변화를 반영하기에 가장 자연스러운 지점이다.
    void flushPendingClears().then(() => {
      syncNow();
      const screen = currentScreen();
      if (screen === 'map' || screen === 'aquarium') {
        // 값이 도착한 뒤에 다시 그려야 한다 — syncNow 는 응답을 기다리지 않으므로
        // 여기서 바로 그리면 옛 값이 그대로다.
        window.setTimeout(() => {
          const now = currentScreen();
          if (now === 'map' || now === 'aquarium') reloadScreen();
        }, 1200);
      }
    });
  });
}

void boot();
