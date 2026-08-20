// DOM 헬퍼 · 토스트 · 모달 · 광고 버튼.

import { showRewarded, adBusy } from './ads.ts';
import {
  adsNotReadyLeft,
  canClaim,
  canShow,
  cooldownLeft,
  noteShown,
  remainingToday,
  type PlacementId,
} from './adPolicy.ts';
import { formatDuration, t, tf } from './i18n.ts';
import { sfx } from './audio.ts';
import { haptics } from './haptics.ts';
import { icon, type IconName } from './icons.ts';
import { claimAdRewardIfOwned } from './net/serverAccount.ts';
import { hasNoAds, type BoosterId } from './storage.ts';

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'style') node.setAttribute('style', String(value));
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------- 부품 (shadcn 식 variant API) ----------
//
// shadcn 은 React 전용이라 그대로 못 쓴다. 대신 그 설계 방식만 가져왔다:
// 부품마다 종류(variant)와 크기(size)를 인자로 받고, 실제 색·간격은 CSS 의
// 시맨틱 토큰(--primary, --card, --border …)이 정한다. 호출부는 재질을 모른다.
// 테마를 바꾸려면 토큰만 갈아끼우면 되고, 화면 코드는 손대지 않는다.

export type Variant = 'default' | 'primary' | 'secondary' | 'ghost' | 'destructive';
export type Size = 'sm' | 'md' | 'lg' | 'icon';

/** 클래스 이름 합치기 (거짓값은 버린다) */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 아이콘 + 라벨 버튼 */
export function button(
  label: string,
  onClick: () => void,
  opts: {
    variant?: Variant;
    size?: Size;
    class?: string;
    icon?: IconName;
    disabled?: boolean;
  } = {},
): HTMLButtonElement {
  const btn = el(
    'button',
    {
      class: cn(
        'btn',
        opts.variant && opts.variant !== 'default' && `btn-${opts.variant}`,
        opts.size && opts.size !== 'md' && `btn-${opts.size}`,
        opts.class,
      ),
      disabled: opts.disabled ? 'disabled' : undefined,
    },
    opts.icon ? icon(opts.icon, 20) : null,
    el('span', { class: 'btn-label', text: label }),
  );
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    sfx.tap();
    haptics.tap();
    onClick();
  });
  return btn;
}

/** 아이콘만 있는 버튼 (닫기 / 뒤로) */
export function iconButton(
  name: IconName,
  onClick: () => void,
  label: string,
  opts: { class?: string; size?: number; variant?: Variant } = {},
): HTMLButtonElement {
  const btn = el(
    'button',
    {
      class: cn(
        'btn btn-icon-only',
        opts.variant && opts.variant !== 'default' && `btn-${opts.variant}`,
        opts.class,
      ),
      'aria-label': label,
    },
    icon(name, opts.size ?? 22),
  );
  btn.addEventListener('click', () => {
    sfx.tap();
    haptics.tap();
    onClick();
  });
  return btn;
}

/** 내용 묶음 한 장. title 을 주면 머리글이 붙는다. */
export function card(
  opts: { title?: string; class?: string } = {},
  ...children: Child[]
): HTMLElement {
  return el(
    'section',
    { class: cn('card', opts.class) },
    opts.title ? el('h3', { class: 'card-title', text: opts.title }) : null,
    el('div', { class: 'card-body' }, ...children),
  );
}

/** 짧은 상태 표시. tone 이 의미를 정한다. */
export function badge(
  label: string,
  tone: 'default' | 'brass' | 'signal' | 'destructive' | 'ad' = 'default',
): HTMLElement {
  return el('span', { class: cn('badge', tone !== 'default' && `badge-${tone}`), text: label });
}

/** 구획선 */
export function separator(): HTMLElement {
  return el('hr', { class: 'separator', 'aria-hidden': 'true' });
}

/** 0..1 진행 막대 */
export function progress(value: number, opts: { class?: string; label?: string } = {}): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return el(
    'div',
    {
      class: cn('progress', opts.class),
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(pct),
      'aria-label': opts.label,
    },
    el('i', { style: `width:${pct}%` }),
  );
}

// ---------- 토스트 ----------

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: 'info' | 'warn' = 'info'): void {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const node = el('div', { class: `toast toast-${kind}`, text: message });
  toastHost.appendChild(node);
  window.setTimeout(() => node.classList.add('out'), 2000);
  window.setTimeout(() => node.remove(), 2400);
}

// ---------- 모달 ----------

export interface ModalHandle {
  close(): void;
  root: HTMLElement;
}

/**
 * 모달.
 *
 * shadcn 의 Dialog 는 Radix 위에 얹혀 있어서 접근성 처리를 공짜로 얻는다.
 * 여기선 React 를 안 쓰므로 그 부분만 직접 구현한다:
 *  - role="dialog" + aria-modal, 제목을 aria-labelledby 로 연결
 *  - 열릴 때 첫 조작 요소로 포커스를 옮기고, 닫을 때 원래 자리로 되돌린다
 *  - Tab 이 모달 밖으로 못 빠져나간다 (포커스 트랩)
 *  - Esc 로 닫는다 (닫기를 막은 모달은 제외)
 */
export function openModal(
  build: (close: () => void) => HTMLElement,
  opts: { dismissable?: boolean; class?: string; onClose?: () => void } = {},
): ModalHandle {
  const dismissable = opts.dismissable !== false;
  const previous = document.activeElement as HTMLElement | null;
  const backdrop = el('div', { class: 'modal-backdrop' });

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.classList.add('out');
    window.setTimeout(() => backdrop.remove(), 180);
    previous?.focus?.();
    // Esc·바깥 클릭·닫기 버튼 등 어느 경로로 닫히든 여기 한 곳을 반드시 거친다 —
    // 모달이 열려 있는 동안만 켜 둔 구독(상점의 watchVxShop 등)을 정리할 자리다.
    opts.onClose?.();
  };

  const panel = el(
    'div',
    { class: cn('modal', opts.class), role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
    build(close),
  );

  const focusable = (): HTMLElement[] =>
    [
      ...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((n) => n.offsetParent !== null);

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && dismissable) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  backdrop.appendChild(panel);
  if (dismissable) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }
  document.body.appendChild(backdrop);

  // 제목이 있으면 스크린리더가 모달 이름으로 읽게 연결한다
  const title = panel.querySelector<HTMLElement>('.modal-title');
  if (title) {
    if (!title.id) title.id = `modal-title-${Math.round(performance.now())}`;
    panel.setAttribute('aria-labelledby', title.id);
  }

  document.addEventListener('keydown', onKeydown, true);
  (focusable()[0] ?? panel).focus();

  return { close, root: panel };
}

// ---------- 광고 / 광고제거 ----------

export interface AdAvailability {
  ok: boolean;
  reason: string;
  /**
   * 'claim' 이면 광고제거를 산 사람이다 — 버튼이 광고 없이 바로 받는 '받기'로 뜬다.
   * 'ad' 면 지금까지처럼 광고를 봐야 한다. adButton() 이 이 값으로 태그·클릭 동작을 가른다.
   */
  mode: 'ad' | 'claim';
}

/** ok:false 일 때 보여줄 이유. canShow/canClaim 둘 다 같은 표(하루 상한 -> 쿨다운 -> 그 외)를 쓴다. */
function unavailableReason(placement: PlacementId): string {
  if (remainingToday(placement) <= 0) return t('adDailyDone');
  const left = cooldownLeft(placement);
  if (left > 0) return tf('adCooldown', { n: formatDuration(left) });
  // 재고 없음은 이 지면의 사정이 아니라 광고 네트워크의 사정이다 — '오늘 다 봤어요'
  // 처럼 사용자가 뭘 했기 때문이라고 읽히면 안 되므로 문구를 따로 둔다. 광고제거
  // 구매자의 '받기' 버튼에는 안 걸린다 (canClaim 은 백오프를 안 본다).
  if (adsNotReadyLeft() > 0) return t('adNotReady');
  return t('adUnavailable');
}

/**
 * 이 지면을 지금 쓸 수 있는지, 못 쓰면 왜인지, 그리고 광고제거 여부에 따라 어느
 * 모드('ad'/'claim')로 보여줄지.
 *
 * **광고제거를 사도 하루 상한·쿨다운은 그대로 적용한다.** 이 지면들은 광고를 보는
 * 대가로 재화를 주는 것이지 재화 자체가 무제한은 아니다 — 상한을 없애면 "광고를 안 봐도
 * 되는 상품"이 아니라 "재화가 무제한인 상품"이 되어 버려서, 광고제거 구매 하나가
 * 게임 경제 전체를 무너뜨린다. 광고제거가 없애는 것은 **광고 재생**뿐이다. 그래서
 * '받기' 버튼도 쿨다운이 남아 있으면 똑같이 비활성화되고 남은 시간을 보여준다 —
 * 광고 버튼과 같은 방식으로 "지금은 안 된다"를 말하지, 죽은 버튼처럼 보이지 않는다.
 */
export function adAvailability(placement: PlacementId): AdAvailability {
  const mode: AdAvailability['mode'] = hasNoAds() ? 'claim' : 'ad';
  const ok = mode === 'claim' ? canClaim(placement) : canShow(placement);
  return { ok, reason: ok ? '' : unavailableReason(placement), mode };
}

/** 광고 재생 없이 바로 보상을 준다 (광고제거 구매자 전용 경로). 카운터 소비·계정 반영은
 * 광고를 실제로 본 경로(watchRewarded 의 rewarded 분기)와 완전히 같다 — 광고 유무만 다르다. */
function claimDirect(placement: PlacementId, onReward: () => void, extra?: BoosterId): boolean {
  const availability = adAvailability(placement);
  if (!availability.ok) {
    toast(availability.reason, 'warn');
    return false;
  }
  noteShown(placement);
  onReward();
  sfx.coin();
  haptics.clear();
  claimAdRewardIfOwned(placement, extra);
  return true;
}

/**
 * 보상형 광고를 재생하고, 끝까지 본 경우에만 onReward 를 부른다. 광고제거를 산 사람은
 * 광고를 아예 안 틀고 claimDirect() 로 바로 보상을 받는다.
 * 반드시 사용자 클릭 핸들러 안에서 호출할 것.
 *
 * @param extra 부스터를 고르는 지면(`free-booster-prelevel`/`free-booster-ingame`)에서
 *   어느 부스터를 받는지. 계정 서버에 그대로 실어 보낸다(`claimAdRewardIfOwned`) —
 *   그 외 지면에서는 안 쓴다.
 */
export async function watchRewarded(
  placement: PlacementId,
  onReward: () => void,
  extra?: BoosterId,
): Promise<boolean> {
  if (hasNoAds()) return claimDirect(placement, onReward, extra);

  const availability = adAvailability(placement);
  if (!availability.ok) {
    toast(availability.reason, 'warn');
    return false;
  }
  if (adBusy()) return false;

  const outcome = await showRewarded(placement);
  if (outcome.status === 'rewarded') {
    onReward();
    sfx.coin();
    haptics.clear();
    // 계정 서버가 금액·쿨다운·하루 상한을 쥐는 지면이면 여기서 함께 알린다 — 여기
    // 한 곳만 고치면 광고 버튼을 쓰는 모든 자리가 같이 적용된다. 서버가 모르는 지면
    // (룰렛, 부활용 광고)은 `claimAdRewardIfOwned` 가 조용히 넘어간다.
    claimAdRewardIfOwned(placement, extra);
    return true;
  }
  toast(
    outcome.status === 'skipped'
      ? t('adSkipped')
      : outcome.status === 'notReady'
        ? t('adNotReady')
        : t('adFailed'),
    'warn',
  );
  return false;
}

/**
 * 보상형 광고 버튼. 쿨다운/일일 상한이면 자동으로 비활성화되고 이유를 보여준다.
 * 광고 재생 중에는 중복 클릭을 막는다.
 *
 * **열두 지면 전부 이 함수 하나를 거친다** — 광고제거를 산 사람에게는 `adAvailability()`
 * 가 'claim' 모드를 돌려주고, 여기서 태그가 'AD' 대신 '받기'로, 클릭이 광고 재생 대신
 * 즉시 지급으로 바뀐다. 지면마다 호출부를 손대지 않고 이 한 곳만 고치면 전부 같이
 * 바뀐다 — 새 광고 지면이 생겨도 adButton() 을 쓰는 한 자동으로 이 규칙을 따른다.
 */
export function adButton(
  placement: PlacementId,
  label: string,
  onReward: () => void,
  opts: { class?: string; onDone?: (rewarded: boolean) => void; extra?: BoosterId } = {},
): HTMLButtonElement {
  const availability = adAvailability(placement);
  const btn = el(
    'button',
    {
      class: cn('btn btn-ad', availability.mode === 'claim' && 'btn-claim', opts.class),
      disabled: availability.ok ? undefined : 'disabled',
    },
    el('span', { class: 'ad-tag', text: availability.mode === 'claim' ? t('claimTag') : 'AD' }),
    el('span', { class: 'btn-label', text: availability.ok ? label : availability.reason }),
  );

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    sfx.tap();
    haptics.tap();
    const rewarded = await watchRewarded(placement, onReward, opts.extra);
    opts.onDone?.(rewarded);
    if (!rewarded && document.body.contains(btn)) {
      const next = adAvailability(placement);
      btn.disabled = !next.ok;
      const labelNode = btn.querySelector('.btn-label');
      if (labelNode) labelNode.textContent = next.ok ? label : next.reason;
    }
  });

  return btn;
}

/** 하우스 광고(자체 홍보) 스트립. Verse8 광고 SDK 에는 배너가 없어 자리만 우리가 만든다. */
export function houseAdStrip(onClick: () => void): HTMLElement {
  const strip = el(
    'div',
    { class: 'house-ad' },
    el('span', { class: 'ad-tag', text: t('houseAdLabel') }),
    el('span', { class: 'house-ad-text', text: t('houseAdText') }),
    el('span', { class: 'house-ad-go', text: '›' }),
  );
  strip.addEventListener('click', () => {
    sfx.tap();
    onClick();
  });
  return strip;
}
