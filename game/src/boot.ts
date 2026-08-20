// 앱을 켤 때의 로딩.
//
// 예전에는 로딩이 **판에 들어갈 때** 있었다. 지도까지는 즉시 떴지만, 단계를 누르면
// 거기서 잠수부·포식자 모델(1MB 남짓)을 받느라 "3D 를 기다리는 중" 화면을 봐야 했다 —
// 게임을 하려고 누른 순간에 기다리는 셈이라 가장 나쁜 자리다.
//
// 이제는 앱을 켤 때 한 번에 끝낸다: 계정 저장을 불러오고, 3D 에셋 바이트를 받아 두고,
// 보드 타일·텍스처를 굽는다. 그동안 화면에는 로딩 표시가 있고, 지도가 뜬 뒤에는
// 어느 단계를 눌러도 바로 시작한다.

import { el } from './ui.ts';
import { t } from './i18n.ts';
import { preloadTiles } from './tiles.ts';

import diverUrl from './assets/sprites3d/diver.glb?url';
import anglerfishUrl from './assets/sprites3d/anglerfish.glb?url';
import goblinSharkUrl from './assets/sprites3d/goblinShark.glb?url';
import squidUrl from './assets/sprites3d/squid.glb?url';

/**
 * 로딩 전체에 거는 상한(ms).
 *
 * 회선이 죽었는데 로딩 화면에 갇히면 게임을 아예 못 켠다. 이 게임은 3D 없이도(웹뷰가
 * WebGL 을 못 딸 때) 보드가 돌고, 계정 없이도(오프라인) 로컬 저장으로 돈다 — 둘 다
 * 이미 사고 대응이 있으므로 여기서 무한정 기다릴 이유가 없다. 시간이 지나면 그냥
 * 들어가고, 못 끝낸 것은 뒤에서 계속 받는다.
 */
const BOOT_TIMEOUT_MS = 12000;

/** 로딩 화면. 지도가 뜨기 전까지 이 화면만 보인다. */
export function showBootLoader(host: HTMLElement): { done(): void } {
  const overlay = el(
    'div',
    { class: 'boot-loading' },
    el('div', { class: 'boot-brand' }, el('h1', { text: t('title') })),
    // 스피너는 광고 오버레이·판 로딩과 같은 것을 쓴다 — 로딩 표시를 종류별로 새로
    // 만들면 같은 상태가 화면마다 다르게 보인다.
    el('div', { class: 'ad-spinner' }),
    el('p', { text: t('bootLoading') }),
  );
  host.appendChild(overlay);
  return {
    done(): void {
      overlay.classList.add('out');
      window.setTimeout(() => overlay.remove(), 260);
    },
  };
}

/**
 * 판에서 쓸 것들을 미리 받아 둔다. **실패해도 던지지 않는다** — 하나가 없다고 게임을
 * 못 켜면 안 된다(각 로더가 자기 실패를 안에서 삼키고 정지 포즈로 대체한다).
 *
 * 포식자는 세 종을 다 받는다. 어느 종이 나올지는 단계 깊이가 정하는데(levels.ts 의
 * `predatorFor`), 지도에서 어디를 누를지는 모르는 일이라 한 종만 받아 두면 나머지
 * 두 종에서는 지금과 똑같이 판에 들어가며 기다리게 된다. 셋을 합쳐도 diver 한 개
 * 남짓이다.
 */
async function preloadAssets(): Promise<void> {
  // 타일·텍스처는 <img> 로드라 여기서 걸어만 두면 배경에서 끝난다.
  preloadTiles();

  const { glbBuffer } = await import('./render3d/glbCache.ts');
  // three 모듈(150KB 남짓)도 지금 받아 둔다 — 판에 들어갈 때 `createStage()` 가 하던
  // 동적 import 다. 모듈 캐시에 올라가 있으면 그때는 즉시 통과한다.
  //
  // **WebGL 을 못 따는 웹뷰에서는 받지 않는다.** 그 기기는 3D 무대를 아예 안 만들므로
  // (render3d/index.ts) 쓰지도 않을 것을 회선만 써 가며 받는 셈이 된다.
  const { webglAvailable } = await import('./render3d/index.ts');
  const tasks: Promise<unknown>[] = [
    glbBuffer(diverUrl),
    glbBuffer(anglerfishUrl),
    glbBuffer(goblinSharkUrl),
    glbBuffer(squidUrl),
  ];
  if (webglAvailable()) tasks.push(import('./render3d/stage.ts'));
  await Promise.allSettled(tasks);
}

/**
 * 로딩 한 판. 계정 불러오기와 에셋 받기를 같이 돌리고, 둘 다 끝나거나 상한에 걸리면
 * 끝난다.
 *
 * `account` 는 `initServerAccount()` 프로미스를 그대로 받는다 — 이 함수가 직접 부르지
 * 않는 이유는 그쪽이 재시도를 자기 안에서 돌리기 때문이다(`BOOT_RETRY_MS`). 여기서는
 * "기다릴 만큼만 기다린다"만 정한다.
 */
export async function runBootTasks(account: Promise<unknown>): Promise<void> {
  const work = Promise.allSettled([account, preloadAssets()]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, BOOT_TIMEOUT_MS));
  await Promise.race([work, timeout]);
}
