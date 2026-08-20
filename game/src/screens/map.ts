// 레벨 선택 지도.

import { button, el, houseAdStrip } from '../ui.ts';
import { icon, type IconName } from '../icons.ts';
import { t, tf } from '../i18n.ts';
import { getSave } from '../storage.ts';
import { LEVEL_COUNT, depthOf, getLevel, sceneVariantFor } from '../levels.ts';
import { canPlay } from '../economy.ts';
import { navigate } from '../router.ts';
import { createHud } from './hud.ts';
import {
  openDailyModal,
  openNoHeartsModal,
  openPiggyModal,
  openPreBoostModal,
  openSettingsModal,
  openShopModal,
  openWheelModal,
} from './modals.ts';
import { dailyAvailable, piggyReady, wheelFreeAvailable } from '../economy.ts';

/**
 * 개발 중 전 스테이지를 열어보는 스위치 — URL 에 `?unlock` 을 붙인다.
 *
 * 장면 변형(빙벽·바위 더미·어망 …)은 레벨마다 다른데, 그걸 확인하려고 앞 스테이지를
 * 전부 깨고 오는 건 말이 안 된다. `import.meta.env.DEV` 는 `vite build` 에서 false 로
 * 상수 치환되고 이 분기는 통째로 사라지므로 배포본에는 들어가지 않는다.
 */
function devUnlockAll(): boolean {
  if (!import.meta.env?.DEV) return false;
  return typeof location !== 'undefined' && location.search.includes('unlock');
}

/** 해금된 최고 단계 */
function unlockedUpTo(): number {
  return devUnlockAll() ? LEVEL_COUNT : getSave().highestUnlocked;
}

/** 지도에 보여줄 레벨 수 (해금된 곳보다 조금 더 앞까지) */
function visibleLevels(): number {
  // 전부 열어보는 중에는 있는 만큼만 보여준다. 평소엔 해금 지점 너머로 몇 칸 더 깔아
  // '앞이 더 있다'를 보여주지만, 30 단계를 다 연 상태에서 그러면 없는 칸이 잠긴 채로 뜬다.
  if (devUnlockAll()) return LEVEL_COUNT;
  const top = getSave().highestUnlocked;
  return Math.min(Math.max(LEVEL_COUNT, top + 4), top + 8);
}

export function renderMap(host: HTMLElement): void {
  const hud = createHud();
  const save = getSave();

  const path = el('div', { class: 'level-path' });
  const total = visibleLevels();

  for (let id = total; id >= 1; id--) {
    const stars = save.levelStars[id] ?? 0;
    const unlocked = id <= unlockedUpTo();
    // 현재 진행 위치는 실제 저장값을 따른다 — 전부 열어봐도 '지금 어디까지 왔는지'는 남아야 한다
    const isCurrent = id === save.highestUnlocked;

    const level = getLevel(id);
    // 전 레벨이 탈출 미션이다. 잠수부 수가 곧 난이도라 그걸 표시한다.
    const divers = ((level.layout ?? []).join('').match(/D/g) ?? []).length;

    const node = el(
      'button',
      {
        class: `level-node ${unlocked ? '' : 'locked'} ${isCurrent ? 'current' : ''}`,
        disabled: unlocked ? undefined : 'disabled',
        'aria-label': `${tf('levelN', { n: id })} · ${depthOf(id)}m`,
      },
      el(
        'span',
        // 깊이가 곧 난이도다. 400m 를 넘어가면 표찰도 빛을 잃게 해서
        // 스크롤만 내려도 '더 깊이 내려왔다'가 읽히게 한다.
        { class: `level-plate ${depthOf(id) >= 400 ? 'abyssal' : ''}`.trim() },
        unlocked ? null : icon('lock', 16, 'level-lock'),
        el('span', { class: 'level-num', text: String(id) }),
        el('span', { class: 'level-depth', text: `${depthOf(id)}m` }),
        unlocked && divers > 1
          ? el('span', { class: 'level-badge divers', text: `×${divers}` })
          : null,
        // 전부 열어보는 중이면 그 레벨의 장면 변형을 표찰에 적는다.
        // 어느 단계가 빙벽이고 어느 단계가 어망인지 눌러보기 전에 알 수 있어야 한다.
        devUnlockAll()
          ? el('span', { class: 'level-badge variant', text: sceneVariantFor(level) })
          : null,
        el(
          'span',
          { class: 'level-stars' },
          ...[1, 2, 3].map((n) => el('i', { class: n <= stars ? 'on' : '' })),
        ),
      ),
    );
    if (isCurrent) node.id = 'current-level';
    node.addEventListener('click', () => startLevel(id, () => refreshAll()));
    path.append(node);
  }

  /**
   * @param label   버튼에 보이는 짧은 이름 (독은 6칸이라 길면 두 줄로 접힌다)
   * @param full    스크린리더가 읽을 온전한 이름. 없으면 label 을 쓴다.
   */
  /**
   * 배지가 붙는 칸은 **표시등을 항상 만들어 두고 보이기만 껐다 켠다.**
   *
   * 예전에는 화면을 그릴 때 `badge` 가 참인 칸에만 `<i>` 를 넣었다. 지도는 한 번
   * 그려지고 그대로 남는 화면이라, 일일 보상을 받고 모달을 닫아도 그 `<i>` 는 그
   * 자리에 그대로 켜져 있었다 — 받을 게 없는데 빨간 불만 남는다. 갱신 함수가 매번
   * 다시 계산해서 클래스만 바꾸도록 뒤집는다.
   */
  const badgeRefreshers: (() => void)[] = [];

  const bottomButton = (
    name: IconName,
    label: string,
    onClick: () => void,
    pending: (() => boolean) | null = null,
    full = label,
  ): HTMLElement => {
    const dot = pending ? el('i', { class: 'dock-badge' }) : null;
    const btn = el(
      'button',
      { class: 'dock-btn', 'aria-label': full },
      icon(name, 26, 'dock-icon'),
      el('span', { class: 'dock-label', text: label }),
      dot,
    );
    if (pending && dot) {
      const sync = (): void => {
        dot.classList.toggle('is-off', !pending());
      };
      sync();
      badgeRefreshers.push(sync);
    }
    btn.addEventListener('click', onClick);
    return btn;
  };

  /** HUD 숫자와 독 표시등을 함께 갱신한다 — 모달이 닫힐 때마다 이걸 넘긴다. */
  const refreshAll = (): void => {
    hud.refresh();
    for (const sync of badgeRefreshers) sync();
  };

  const dock = el(
    'nav',
    { class: 'dock' },
    bottomButton('aquarium', t('aquarium'), () => navigate('aquarium')),
    bottomButton('shop', t('shop'), () => openShopModal(refreshAll)),
    // 독 라벨은 짧은 이름을 쓴다. 모달 제목은 긴 이름 그대로다.
    bottomButton('wheel', t('wheelShort'), () => openWheelModal(refreshAll), wheelFreeAvailable, t('wheelTitle')),
    bottomButton('gift', t('dailyShort'), () => openDailyModal(refreshAll), dailyAvailable, t('dailyTitle')),
    bottomButton('piggy', t('piggyShort'), () => openPiggyModal(refreshAll), piggyReady, t('piggyTitle')),
    bottomButton('settings', t('settings'), () => openSettingsModal(refreshAll)),
  );

  // 모달을 거치지 않고도 바뀌는 것들이 있다 — 자정을 넘기면 일일 보상·룰렛이 다시
  // 열리고, 저금통은 레벨을 깨고 돌아오면 차 있을 수 있다. HUD 시계와 같은 주기로
  // 함께 확인한다 (계산은 저장값 비교뿐이라 비용이 없다).
  const badgeTimer = window.setInterval(() => {
    for (const sync of badgeRefreshers) sync();
  }, 1000);

  const header = el(
    'header',
    { class: 'screen-head' },
    // 복원 진행도는 수족관 화면에만 둔다.
    //
    // 지도는 '다음 레벨을 고르는' 화면이다. 여기서 하는 일과 무관한 진행도를 제목 옆에
    // 붙여두면 시선만 나눠 가지고, 정작 그 숫자를 눌러도 아무 데도 못 간다.
    // 진행도는 그걸 실제로 올릴 수 있는 화면(수족관)에서 보여준다.
    el('div', { class: 'brand' }, el('h1', { text: t('title') })),
    hud.root,
  );

  host.append(
    header,
    el('main', { class: 'screen map-screen' }, path),
    // 자체 홍보 스트립 (Verse8 광고 SDK 에는 배너가 없다 — 자리만 우리가 만든다)
    houseAdStrip(() => navigate('aquarium')),
    dock,
  );

  // 진행 중인 레벨이 화면에 보이게 스크롤
  requestAnimationFrame(() => {
    document.getElementById('current-level')?.scrollIntoView({ block: 'center' });
  });

  host.addEventListener(
    'screen:destroy',
    () => {
      window.clearInterval(badgeTimer);
      hud.destroy();
    },
    { once: true },
  );
}

export function startLevel(levelId: number, refresh: () => void): void {
  if (!canPlay()) {
    openNoHeartsModal(refresh);
    return;
  }
  openPreBoostModal(
    levelId,
    (preBoosters) => navigate('level', { levelId, preBoosters }),
    getLevel(levelId).oxygen ?? 0,
  );
}

export { button };
