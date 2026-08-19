// 모달 모음. 광고 지면 대부분이 여기 모여 있다.

import { adButton, button, cn, el, iconButton, openModal, toast, watchRewarded } from '../ui.ts';
import { amount, icon, type IconName } from '../icons.ts';
import { LANGS, LANG_LABEL, formatDuration, predatorLabel, t, tf } from '../i18n.ts';
import { depthT, predatorFor, type PredatorKind } from '../levels.ts';
import { getSave, mutateSave, type BoosterId } from '../storage.ts';
import {
  BOOSTER_PRICE,
  DAILY_REWARDS,
  HEART_REFILL_PRICE,
  MAX_HEARTS,
  PIGGY_CAP,
  WHEEL,
  addBooster,
  addHearts,
  addPearls,
  addStars,
  buyBooster,
  buyHeartRefill,
  claimDaily,
  dailyAvailable,
  grantWheel,
  markWheelFreeUsed,
  openPiggyBank,
  piggyReady,
  refreshHearts,
  wheelFreeAvailable,
  type WheelSlot,
} from '../economy.ts';
import { applyVolumes, sfx, startAmbience } from '../audio.ts';
import { navigate, reloadScreen } from '../router.ts';
import { createWheel } from './wheelView.ts';
import { predatorArt } from '../render/predatorArt.ts';
import type { PreBooster } from '../core/engine.ts';

type Refresh = () => void;

function modalHeader(title: string, close: () => void): HTMLElement {
  return el(
    'div',
    { class: 'modal-head' },
    el('h2', { class: 'modal-title', text: title }),
    iconButton('close', close, t('close'), { size: 18 }),
  );
}

/** 가격 라벨: 아이콘 + 숫자 */
function priceButton(cost: number, onClick: () => void): HTMLButtonElement {
  const btn = el('button', { class: 'btn btn-buy' }, amount('pearl', cost, 16));
  btn.addEventListener('click', () => {
    sfx.tap();
    onClick();
  });
  return btn;
}

// ---------- 하트 ----------

export function openHeartsModal(refresh: Refresh): void {
  openModal((close) => {
    const state = refreshHearts();
    const body = el('div', { class: 'modal-body' });

    const status = el('p', {
      class: 'modal-lead',
      text: state.infinite
        ? tf('infiniteHearts', { t: formatDuration(state.infiniteMsLeft) })
        : state.hearts >= MAX_HEARTS
          ? t('heartFull')
          : tf('heartNext', { t: formatDuration(state.msToNext) }),
    });

    const hearts = el(
      'div',
      { class: 'heart-row' },
      ...Array.from({ length: MAX_HEARTS }, (_, i) =>
        el(
          'span',
          { class: `heart-pip ${state.infinite || i < state.hearts ? 'on' : ''}` },
          icon('heart', 26),
        ),
      ),
    );

    const done = (): void => {
      refresh();
      close();
    };

    body.append(
      status,
      hearts,
      // [광고 지면] 하트 1개
      //
      // 예전엔 광고 한 번에 5개를 다 채웠다. 그러면 진주로 살 이유가 사라지고
      // 하트 제약도 사실상 없어진다. 광고는 '한 판 더'만, 풀 충전은 진주로.
      adButton('refill-hearts', tf('refillHeartOne', { n: 1 }), () => {
        addHearts(1);
        toast(tf('heartsEarned', { n: 1 }));
      }, { onDone: (ok) => ok && done() }),
      el(
        'div',
        { class: 'buy-row' },
        el('span', { class: 'buy-label', text: t('refillHearts') }),
        // 상점의 하트 상품과 **같은 가격**이어야 한다. 같은 물건이 두 가격이면 싼 쪽만 팔린다.
        priceButton(HEART_REFILL_PRICE, () => {
          if (!buyHeartRefill(HEART_REFILL_PRICE)) {
            toast(t('notEnoughPearls'), 'warn');
            return;
          }
          sfx.coin();
          done();
        }),
      ),
    );

    return el('div', {}, modalHeader(t('hearts'), close), body);
  });
}

// ---------- 상점 ----------

const SHOP_BOOSTERS: BoosterId[] = [
  'harpoon',
  'depthCharge',
  'tide',
  'preCurrent',
  'preMine',
  'prePearl',
];

const BOOSTER_LABEL: Record<BoosterId, { name: string; desc: string; icon: IconName }> = {
  harpoon: { name: 'boosterHarpoon', desc: 'boosterHarpoonDesc', icon: 'harpoon' },
  depthCharge: { name: 'boosterDepthCharge', desc: 'boosterDepthChargeDesc', icon: 'depthCharge' },
  tide: { name: 'boosterTide', desc: 'boosterTideDesc', icon: 'tide' },
  preCurrent: { name: 'boosterPreCurrent', desc: 'boosterPreCurrentDesc', icon: 'preCurrent' },
  preMine: { name: 'boosterPreMine', desc: 'boosterPreMineDesc', icon: 'preMine' },
  prePearl: { name: 'boosterPrePearl', desc: 'boosterPrePearlDesc', icon: 'prePearl' },
};

export function boosterMeta(id: BoosterId): { name: string; desc: string; icon: IconName } {
  const meta = BOOSTER_LABEL[id];
  return { name: t(meta.name), desc: t(meta.desc), icon: meta.icon };
}

export function openShopModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });

    const rebuild = (): void => {
      body.replaceChildren();
      const save = getSave();

      body.append(
        el('p', { class: 'modal-lead' }, `${t('pearls')} `, amount('pearl', save.pearls, 18)),
        // [광고 지면] 상점 무료 진주
        adButton('shop-free-coin', tf('freeCoinDesc', { n: 120 }), () => {
          addPearls(120);
          toast(tf('rewardPearls', { n: 120 }));
        }, { onDone: () => { refresh(); rebuild(); } }),
      );

      const list = el('div', { class: 'shop-list' });
      for (const id of SHOP_BOOSTERS) {
        const meta = boosterMeta(id);
        const owned = save.boosters[id] ?? 0;
        list.append(
          el(
            'div',
            { class: 'shop-item' },
            icon(meta.icon, 34, 'shop-icon'),
            el(
              'div',
              { class: 'shop-info' },
              // 보유 수를 제목에 `×0` 으로 붙이면 '수량 0짜리 상품'처럼 읽혀 고장난 것 같다.
              // 제목은 상품 이름만 두고, 보유 수는 따로 뺀다.
              el('strong', { text: meta.name }),
              el('small', { text: meta.desc }),
              el('em', { class: 'shop-owned', text: tf('owned', { n: owned }) }),
            ),
            priceButton(BOOSTER_PRICE[id], () => {
              if (!buyBooster(id)) {
                toast(t('notEnoughPearls'), 'warn');
                return;
              }
              sfx.coin();
              refresh();
              rebuild();
            }),
          ),
        );
      }

      // 하트는 상점에서 팔지 않는다.
      //
      // 하트가 없어서 막힌 사람은 상점이 아니라 하트 모달에서 막힌다. 파는 자리를
      // 거기 하나로 두면 "막혔다 → 바로 살 수 있다"가 한 화면 안에서 끝난다.
      // 상점에도 같은 물건을 두면 목록만 길어지고 진입 지점이 둘로 갈린다.
      body.append(list);
    };

    rebuild();
    return el('div', {}, modalHeader(t('shop'), close), body);
  });
}

// ---------- 불가사리 ----------

export function openStarModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });
    body.append(
      el('p', { class: 'modal-lead' }, `${t('stars')} `, amount('starfish', getSave().stars, 18)),
      el('p', { class: 'modal-note', text: t('extraStarDesc') }),
      // [광고 지면] 불가사리 1개
      adButton('extra-star', t('extraStarTitle'), () => {
        addStars(1);
        sfx.star();
        toast(tf('starsEarned', { n: 1 }));
      }, { onDone: () => refresh() }),
      button(t('aquarium'), () => {
        close();
        navigate('aquarium');
      }, { class: 'btn-secondary' }),
    );
    return el('div', {}, modalHeader(t('stars'), close), body);
  });
}

// ---------- 일일 보상 ----------

/**
 * 하루치 칸 하나.
 *
 * 예전에는 칸마다 아이콘 세 개를 같은 크기로 늘어놓아서 **뭐가 주 보상인지** 알 수 없었다.
 * 한눈에 들어오려면 칸마다 읽는 순서가 정해져 있어야 한다:
 *   1) 며칠째인가  2) 제일 큰 보상 하나  3) 곁들이 보상
 * 그래서 주 보상(부스터 > 하트 > 진주)을 하나 골라 크게 놓고, 나머지는 작게 아래에 붙인다.
 */
function dailyCell(index: number, state: 'claimed' | 'today' | 'future'): HTMLElement {
  const reward = DAILY_REWARDS[index];
  const last = index === DAILY_REWARDS.length - 1;

  const hero: IconName = reward.booster
    ? boosterMeta(reward.booster).icon
    : reward.hearts
      ? 'heart'
      : 'pearl';

  // 곁들이 보상 — 주 보상으로 이미 쓴 건 빼고 남은 것만
  const extras: HTMLElement[] = [];
  if (hero !== 'pearl') extras.push(amount('pearl', reward.pearls, 12));
  if (reward.hearts && hero !== 'heart') extras.push(amount('heart', reward.hearts, 12));

  return el(
    'div',
    { class: cn('daily-cell', `is-${state}`, last && 'is-final') },
    el('span', { class: 'daily-day', text: tf('dailyDay', { n: index + 1 }) }),
    el(
      'div',
      { class: 'daily-hero' },
      icon(hero, last ? 44 : 32),
      hero === 'pearl'
        ? el('b', { class: 'daily-hero-n', text: String(reward.pearls) })
        : reward.booster
          ? el('b', { class: 'daily-hero-n', text: '×1' })
          : el('b', { class: 'daily-hero-n', text: `×${reward.hearts}` }),
    ),
    extras.length ? el('div', { class: 'daily-extra' }, ...extras) : null,
    // 받은 날에는 도장을 찍는다 (CSS 로 그린다 — 아이콘을 하나 더 쓰면 칸이 시끄러워진다)
    state === 'claimed' ? el('span', { class: 'daily-stamp' }) : null,
  );
}

export function openDailyModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });
    const save = getSave();
    const streakIndex = save.dailyStreak % DAILY_REWARDS.length;

    // 며칠째 이어오고 있는지가 계속 오게 만드는 동력이다. 숫자로 맨 위에 못 박아둔다.
    body.append(
      el(
        'div',
        { class: 'daily-streak' },
        el('b', { text: String(save.dailyStreak) }),
        el('span', { text: t('dailyStreak') }),
      ),
    );

    const grid = el(
      'div',
      { class: 'daily-grid' },
      ...DAILY_REWARDS.map((_, i) =>
        dailyCell(i, i < streakIndex ? 'claimed' : i === streakIndex ? 'today' : 'future'),
      ),
    );
    body.append(grid);

    if (!dailyAvailable()) {
      body.append(el('p', { class: 'modal-note', text: t('dailyDone') }));
    } else {
      let claimed = false;
      const adSlot = el('div', { class: 'modal-actions' });

      const claimBtn = button(t('dailyClaim'), () => {
        if (claimed) return;
        claimed = true;
        const result = claimDaily();
        sfx.coin();
        toast(tf('rewardPearls', { n: result.pearls }));
        refresh();
        claimBtn.disabled = true;
        adSlot.replaceChildren(
          // [광고 지면] 일일 보상 2배
          adButton('daily-chest', t('dailyDouble'), () => {
            addPearls(DAILY_REWARDS[result.index].pearls);
            toast(tf('rewardPearls', { n: DAILY_REWARDS[result.index].pearls }));
            refresh();
          }, { onDone: () => close() }),
        );
      });

      body.append(claimBtn, adSlot);
    }

    return el('div', {}, modalHeader(t('dailyTitle'), close), body);
  });
}

// ---------- 룰렛 ----------

function wheelSlotIcon(slot: WheelSlot): IconName {
  switch (slot.kind) {
    case 'pearls':
      return 'pearl';
    case 'hearts':
      return 'heart';
    case 'stars':
      return 'starfish';
    case 'booster':
      return slot.booster ? boosterMeta(slot.booster).icon : 'gift';
  }
}

/** 토스트용 짧은 텍스트 */
function wheelSlotText(slot: WheelSlot): string {
  if (slot.kind === 'booster' && slot.booster) return boosterMeta(slot.booster).name;
  const unit =
    slot.kind === 'pearls' ? t('pearls') : slot.kind === 'hearts' ? t('hearts') : t('stars');
  return `${unit} +${slot.amount}`;
}

function wheelSlotNode(slot: WheelSlot): HTMLElement {
  // 원반 위에서는 아이콘이 작으면 뭘 걸었는지 안 보인다. 목록보다 크게 잡는다.
  if (slot.kind === 'booster') return icon(wheelSlotIcon(slot), 34);
  return amount(wheelSlotIcon(slot), slot.amount, 26);
}

export function openWheelModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });

    // 불가사리 칸은 제일 귀한 보상이라 원반에서 놋쇠로 따로 강조한다
    const jackpot = WHEEL.map((s, i) => (s.kind === 'stars' ? i : -1)).filter((i) => i >= 0);
    const wheel = createWheel(WHEEL.length, (n) => wheelSlotNode(WHEEL[n]), jackpot);

    const actions = el('div', { class: 'modal-actions' });
    body.append(wheel.node, actions);

    const spin = (): void => {
      if (wheel.busy()) return;
      const winner = Math.floor(Math.random() * WHEEL.length);
      actions.replaceChildren(el('p', { class: 'modal-note', text: t('wheelSpinning') }));
      void wheel.spin(winner).then(() => {
        const slot = WHEEL[winner];
        grantWheel(slot);
        toast(tf('wheelResult', { r: wheelSlotText(slot) }));
        refresh();
        rebuildActions();
      });
    };

    const rebuildActions = (): void => {
      actions.replaceChildren();
      if (wheelFreeAvailable()) {
        actions.append(
          button(t('wheelFree'), () => {
            markWheelFreeUsed();
            spin();
          }),
        );
      }
      actions.append(
        // [광고 지면] 룰렛 추가 스핀
        adButton('lucky-wheel-spin', t('wheelAdSpin'), () => spin()),
      );
    };

    rebuildActions();
    // 모달이 닫힐 때 rAF 를 세워야 한다 — 안 그러면 배경에서 계속 돈다
    return el(
      'div',
      {},
      modalHeader(t('wheelTitle'), () => {
        wheel.destroy();
        close();
      }),
      body,
    );
  });
}

// ---------- 저금통 ----------

export function openPiggyModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });

    const rebuild = (): void => {
      body.replaceChildren();
      const save = getSave();
      const ratio = Math.min(1, save.piggy / PIGGY_CAP);

      body.append(
        el('div', { class: 'piggy-art' }, icon('piggy', 76)),
        el('div', { class: 'progress' }, el('i', { style: `width:${ratio * 100}%` })),
        el('p', {
          class: 'modal-lead',
          text: tf('piggyProgress', { a: save.piggy, b: PIGGY_CAP }),
        }),
        // [광고 지면] 저금통 보너스 채우기
        adButton('piggy-bank-boost', tf('piggyBoost', { n: 150 }), () => {
          mutateSave((s) => {
            s.piggy = Math.min(PIGGY_CAP, s.piggy + 150);
          });
          toast(tf('piggyBoost', { n: 150 }));
        }, { onDone: () => { refresh(); rebuild(); } }),
        piggyReady()
          ? button(t('piggyOpen'), () => {
              const amount = openPiggyBank();
              sfx.coin();
              toast(tf('rewardPearls', { n: amount }));
              refresh();
              close();
            })
          : el('p', { class: 'modal-note', text: t('piggyNotReady') }),
      );
    };

    rebuild();
    return el('div', {}, modalHeader(t('piggyTitle'), close), body);
  });
}

// ---------- 설정 ----------

export function openSettingsModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });

    const rebuild = (): void => {
      body.replaceChildren();
      const s = getSave().settings;
      const row = (label: string, value: string, onToggle: () => void): HTMLElement =>
        el(
          'div',
          { class: 'setting-row' },
          el('span', { text: label }),
          button(value, () => {
            onToggle();
            refresh();
            rebuild();
          }, { class: 'btn-secondary' }),
        );

      /**
       * 볼륨 슬라이더 한 줄.
       *
       * 값은 `input` 마다 저장한다 — `change` 로 미루면 손가락을 떼기 전까지 소리가
       * 안 변해서 "지금 얼마나 큰지"를 들으며 맞출 수가 없다.
       * 모달을 다시 그리지는 않는다. 다시 그리면 드래그 중인 노브가 사라진다.
       */
      const volumeRow = (
        label: string,
        get: () => number,
        set: (v: number) => void,
        preview?: () => void,
      ): HTMLElement => {
        const value = el('span', { class: 'setting-value', text: `${Math.round(get() * 100)}` });
        const input = el('input', {
          type: 'range',
          min: '0',
          max: '100',
          step: '5',
          value: String(Math.round(get() * 100)),
          class: 'slider',
          'aria-label': label,
        }) as HTMLInputElement;
        input.addEventListener('input', () => {
          const v = Number(input.value) / 100;
          set(v);
          value.textContent = String(Math.round(v * 100));
          applyVolumes();
        });
        // 손을 뗄 때 한 번 들려준다 — 숫자만으로는 얼마나 큰지 알 수 없다
        if (preview) input.addEventListener('change', preview);
        return el(
          'div',
          { class: 'setting-row setting-row-slider' },
          el('span', { text: label }),
          el('div', { class: 'slider-wrap' }, input, value),
        );
      };

      body.append(
        volumeRow(
          t('bgmVolume'),
          () => getSave().settings.bgmVolume,
          (v) => {
            mutateSave((d) => {
              d.settings.bgmVolume = v;
            });
            // 0 에서 올렸으면 배경음을 다시 켠다 (applyVolumes 가 0 일 때 세워둔다)
            if (v > 0) void startAmbience();
          },
        ),
        volumeRow(
          t('sfxVolume'),
          () => getSave().settings.sfxVolume,
          (v) => {
            mutateSave((d) => {
              d.settings.sfxVolume = v;
            });
          },
          () => sfx.tap(),
        ),
        row(t('haptics'), s.haptics ? t('on') : t('off'), () =>
          mutateSave((d) => {
            d.settings.haptics = !d.settings.haptics;
          }),
        ),
        // 언어.
        //
        // 언어가 넷이라 눌러서 돌리는 버튼은 원하는 언어까지 최대 세 번 눌러야 하고,
        // 무엇이 있는지도 안 보인다. 전부 늘어놓고 지금 것을 표시하는 쪽이 낫다.
        //
        // 바꾼 뒤에는 이 모달만 다시 그려선 안 된다 — 지도·독·HUD 의 글자는 이미
        // 그려져 있어서 그대로 남는다. 화면을 통째로 다시 그린 뒤 설정을 다시 연다.
        el(
          'div',
          { class: 'setting-row setting-row-lang' },
          el('span', { text: t('language') }),
          el(
            'div',
            { class: 'lang-grid' },
            ...LANGS.map((code) => {
              const btn = el('button', {
                class: cn('lang-chip', code === s.lang && 'on'),
                text: LANG_LABEL[code],
                'aria-pressed': code === s.lang ? 'true' : 'false',
              });
              btn.addEventListener('click', () => {
                if (code === getSave().settings.lang) return;
                mutateSave((d) => {
                  d.settings.lang = code;
                });
                close();
                reloadScreen();
                // close() 는 닫히는 애니메이션(180ms) 뒤에 DOM 에서 지운다.
                // 곧바로 다시 열면 설정 창이 두 장 겹친다.
                window.setTimeout(() => openSettingsModal(() => undefined), 200);
              });
              return btn;
            }),
          ),
        ),
      );
    };

    rebuild();
    return el('div', {}, modalHeader(t('settings'), close), body);
  });
}

// ---------- 레벨 시작 전 부스터 ----------

const PRE_BOOSTERS: { id: BoosterId; kind: PreBooster }[] = [
  { id: 'preCurrent', kind: 'current' },
  { id: 'preMine', kind: 'mine' },
  { id: 'prePearl', kind: 'pearl' },
];

export function openPreBoostModal(
  levelId: number,
  onStart: (selected: PreBooster[]) => void,
  /** 구조 미션이면 산소량. 0 이면 일반 레벨 */
  rescueOxygen = 0,
): void {
  openModal((close) => {
    const selected = new Set<BoosterId>();
    const body = el('div', { class: 'modal-body' });

    const rebuild = (): void => {
      body.replaceChildren();
      const save = getSave();

      if (rescueOxygen > 0) {
        // 레벨마다 실제로 쫓아오는 포식자가 다르다(levels.ts predatorFor) — 안내
        // 문구가 그 이름을 그대로 불러야 "그 녀석이 온다"가 미리 읽힌다.
        const predator = predatorFor(depthT(levelId));
        body.append(
          el(
            'div',
            { class: 'rescue-brief' },
            icon('cage', 44),
            el(
              'div',
              { class: 'rescue-brief-text' },
              el('strong', { text: t('rescueTitle') }),
              el('small', { text: tf('rescueDesc', { predator: predatorLabel(predator) }) }),
              el('span', { class: 'rescue-oxy' }, icon('oxygen', 16), `${t('oxygen')} ${rescueOxygen}`),
            ),
          ),
        );
      }

      body.append(el('p', { class: 'modal-lead', text: t('preBoostDesc') }));

      const list = el('div', { class: 'preboost-list' });
      for (const entry of PRE_BOOSTERS) {
        const meta = boosterMeta(entry.id);
        const owned = save.boosters[entry.id] ?? 0;
        const isOn = selected.has(entry.id);

        const card = el(
          'div',
          { class: `preboost-card ${isOn ? 'on' : ''} ${owned <= 0 ? 'empty' : ''}` },
          icon(meta.icon, 32, 'preboost-icon'),
          el('strong', { text: meta.name }),
          el('small', { text: meta.desc }),
          el('span', { class: 'preboost-count', text: `×${owned}` }),
        );
        card.addEventListener('click', () => {
          if (owned <= 0) return;
          sfx.tap();
          if (isOn) selected.delete(entry.id);
          else selected.add(entry.id);
          rebuild();
        });

        if (owned <= 0) {
          // [광고 지면] 시작 부스터 무료 획득
          card.append(
            adButton('free-booster-prelevel', t('freeBoosterAd'), () => {
              addBooster(entry.id, 1);
              toast(`${meta.name} +1`);
            }, { class: 'btn-tiny', extra: entry.id, onDone: () => rebuild() }),
          );
        }
        list.append(card);
      }

      body.append(
        list,
        button(t('start'), () => {
          const kinds: PreBooster[] = [];
          for (const entry of PRE_BOOSTERS) {
            if (!selected.has(entry.id)) continue;
            mutateSave((s) => {
              s.boosters[entry.id] = Math.max(0, (s.boosters[entry.id] ?? 0) - 1);
            });
            kinds.push(entry.kind);
          }
          close();
          onStart(kinds);
        }, { class: 'btn-primary' }),
      );
    };

    rebuild();
    return el('div', {}, modalHeader(tf('levelN', { n: levelId }), close), body);
  }, { dismissable: true });
}

// ---------- 결과 ----------

export interface WinInfo {
  levelId: number;
  stars: number;
  starsGained: number;
  pearls: number;
  score: number;
}

export function openWinModal(
  info: WinInfo,
  handlers: { onNext: () => void; onMap: () => void; refresh: Refresh },
): void {
  openModal(
    (close) => {
      const body = el('div', { class: 'modal-body' });
      let doubled = false;

      const starRow = el(
        'div',
        { class: 'star-row' },
        ...[1, 2, 3].map((n) =>
          el('span', { class: `star ${n <= info.stars ? 'on' : ''}` }, icon(n <= info.stars ? 'star' : 'starEmpty', 44)),
        ),
      );

      const rewardLine = el('p', {
        class: 'modal-lead',
        text: `${tf('rewardPearls', { n: info.pearls })} · ${tf('starsEarned', { n: info.starsGained })}`,
      });

      body.append(
        starRow,
        el('p', { class: 'modal-note', text: `${t('score')} ${info.score}` }),
        rewardLine,
        // [광고 지면] 클리어 보상 2배
        adButton('double-coins', t('doubleReward'), () => {
          if (doubled) return;
          doubled = true;
          addPearls(info.pearls);
          sfx.coin();
          rewardLine.textContent = `${tf('rewardPearls', { n: info.pearls * 2 })} · ${tf('starsEarned', { n: info.starsGained })}`;
          handlers.refresh();
        }),
        el(
          'div',
          { class: 'modal-actions' },
          button(t('toMap'), () => {
            close();
            handlers.onMap();
          }, { class: 'btn-secondary' }),
          button(t('nextLevel'), () => {
            close();
            handlers.onNext();
          }, { class: 'btn-primary' }),
        ),
      );

      return el('div', {}, el('h2', { class: 'modal-title big', text: t('levelClear') }), body);
    },
    { dismissable: false },
  );
}

export function openLoseModal(handlers: {
  /** 'eaten' 이면 시간 연장, 'moves' 면 이동 수 연장, 'deadBoard' 면 되살릴 방법이 없다 */
  reason: 'moves' | 'eaten' | 'deadBoard';
  /** 이 판에서 실제로 쫓아오던 포식자(levels.ts predatorFor) — oxygenOut 문구가 그
   * 이름을 부른다. reason 이 'eaten' 이 아니면 안 쓰이지만, 호출부(level.ts)가
   * 매번 levelId 로 다시 계산하지 않도록 항상 받아 둔다. */
  predator: PredatorKind;
  onRevive: () => void;
  onRetry: () => void;
  onMap: () => void;
  extraMoves: number;
  extraOxygen: number;
}): void {
  openModal(
    (close) => {
      const body = el('div', { class: 'modal-body' });
      const isOxygen = handlers.reason === 'eaten';
      // 판이 막힌 거면 섞어도 짝이 안 나온다. 이동 수를 줘도 소용없으니 부활 지면을 안 띄운다.
      const isDead = handlers.reason === 'deadBoard';
      // 그림은 진 이유를 그대로 보여줘야 한다. 시간이 다 되면 포식자에게 잡힌 것이므로
      // 그 그림을 띄운다 (예전엔 산소통이었다 — 문구와 그림이 다른 말을 하고 있었다).
      //
      // 문구(아래 lead)와 그림(render/predatorArt.ts) 이 같은 생물을 가리켜야 한다 —
      // 실제로 잡은 건 오징어인데 그림이 곰치면 "얘한테 잡혔구나"가 안 읽힌다.
      if (isOxygen) body.append(el('div', { class: 'lose-art' }, predatorArt(handlers.predator)));
      const lead = isOxygen
        ? tf('oxygenOut', { predator: predatorLabel(handlers.predator) })
        : isDead
          ? t('noMatchesLeft')
          : t('outOfMoves');
      body.append(el('p', { class: 'modal-lead', text: lead }));
      if (!isDead) {
        body.append(
          isOxygen
            ? // [광고 지면] 산소통 보충 (구조 미션 전용)
              adButton('oxygen-refill', tf('oxygenRefill', { n: handlers.extraOxygen }), () => {
                handlers.onRevive();
              }, { class: 'btn-primary', onDone: (ok) => ok && close() })
            : // [광고 지면] 이동 수 연장 (부활)
              adButton('revive-extra-moves', tf('extraMoves', { n: handlers.extraMoves }), () => {
                handlers.onRevive();
              }, { class: 'btn-primary', onDone: (ok) => ok && close() }),
        );
      }
      body.append(
        el(
          'div',
          { class: 'modal-actions' },
          button(t('toMap'), () => {
            close();
            handlers.onMap();
          }, { class: 'btn-secondary' }),
          button(t('retry'), () => {
            close();
            handlers.onRetry();
          }),
        ),
      );
      return el('div', {}, el('h2', { class: 'modal-title big', text: t('levelFailed') }), body);
    },
    { dismissable: false },
  );
}

/** 하트가 없을 때 뜨는 안내 (하트 모달로 이어진다) */
export function openNoHeartsModal(refresh: Refresh): void {
  openModal((close) => {
    const body = el('div', { class: 'modal-body' });
    const state = refreshHearts();
    body.append(
      el('p', { class: 'modal-lead', text: t('noHearts') }),
      el('p', {
        class: 'modal-note',
        text: tf('heartNext', { t: formatDuration(state.msToNext) }),
      }),
      // [광고 지면] 하트 1개 (진입 차단 지점 — 전환율이 가장 높다)
      // 같은 지면(`refill-hearts`)이므로 하트 모달과 보상이 같아야 한다.
      // 여기서만 풀 충전을 주면 "막힌 뒤에 눌러야 이득"이 되어 하트 모달을 아무도 안 쓴다.
      adButton('refill-hearts', tf('refillHeartOne', { n: 1 }), () => {
        addHearts(1);
        toast(tf('heartsEarned', { n: 1 }));
      }, { class: 'btn-primary', onDone: (ok) => { refresh(); if (ok) close(); } }),
      button(t('close'), close, { class: 'btn-secondary' }),
    );
    return el('div', {}, modalHeader(t('hearts'), close), body);
  });
}

/** 인게임 부스터가 떨어졌을 때: 광고 한 번으로 1회 사용 */
export function openFreeBoosterModal(
  boosterId: BoosterId,
  onGranted: () => void,
): void {
  openModal((close) => {
    const meta = boosterMeta(boosterId);
    const body = el('div', { class: 'modal-body' });
    body.append(
      el('div', { class: 'preboost-icon big' }, icon(meta.icon, 64)),
      el('p', { class: 'modal-lead', text: t('inGameFreeBooster') }),
      el('p', { class: 'modal-note', text: meta.desc }),
      // [광고 지면] 인게임 부스터 무료 1회
      adButton('free-booster-ingame', t('watchAd'), () => {
        addBooster(boosterId, 1);
        onGranted();
      }, { class: 'btn-primary', extra: boosterId, onDone: (ok) => ok && close() }),
      button(t('cancel'), close, { class: 'btn-secondary' }),
    );
    return el('div', {}, modalHeader(meta.name, close), body);
  });
}

/** watchRewarded 를 직접 쓰고 싶을 때를 위한 재수출 */
export { watchRewarded };
