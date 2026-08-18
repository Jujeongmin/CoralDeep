// 룰렛 원반 — 실제로 돌아가는 연출.
//
// 예전에는 격자 8칸에 표시등이 순서대로 켜졌다 꺼지는 방식이었다. 그건 '룰렛'이 아니라
// 로딩 표시로 보인다. 도박성 연출이 주는 긴장은 **관성**에서 나온다:
// 처음엔 눈으로 못 따라갈 만큼 빠르고, 끝에서 한 칸 한 칸 아쉽게 느려지다 멈춘다.
//
// 그래서 CSS transform 회전 + ease-out 하나로 굴린다. JS 로 매 프레임 각도를 계산하면
// 메인 스레드가 밀릴 때 툭툭 끊기지만, transform 전이는 컴포지터가 돌리므로 매끄럽다.
//
// 대신 "지금 몇 번 칸을 지나고 있나"는 알아야 한다 (딸깍 소리와 포인터 튕김).
// 그래서 rAF 로 계산된 행렬을 읽어 실제 각도를 역산한다 — 애니메이션의 진짜 상태를 보는 것이라
// 이징 함수를 JS 로 다시 구현할 필요가 없다.

import { el } from '../ui.ts';
import { sfx } from '../audio.ts';
import { haptics } from '../haptics.ts';

/** 한 바퀴 도는 데 필요한 각 (칸 수는 호출부가 정한다) */
const TURN = 360;

/**
 * 감속에 쓸 시간. 짧으면 긴장이 안 생기고, 길면 지루하다.
 * **`style.css` 의 `.wheel-disc` 전이 시간과 같아야 한다** — 여기서 결과 지급 시점을 잡는다.
 */
const SPIN_MS = 4200;

/** 멈추기 전 최소 몇 바퀴 도는가 */
const MIN_TURNS = 5;

export interface WheelHandle {
  /** 모달 본문에 넣을 요소 */
  node: HTMLElement;
  /** 당첨 칸으로 돌린다. 멈추면 resolve. */
  spin(winner: number): Promise<void>;
  /** 진행 중인지 */
  busy(): boolean;
  /** rAF 정리 */
  destroy(): void;
}

/**
 * 섹터 배색 — 인접 칸이 구분되게 번갈아 깐다.
 * 두 색이 비슷하면 칸 경계가 살(spoke) 뿐이라 '나뉜 원반'이 아니라 '바퀴살'로 보인다.
 */
const SECTOR_A = '#1c5b7a';
const SECTOR_B = '#08283c';
/** 대박 칸(불가사리)은 놋쇠로 따로 뺀다 */
const SECTOR_JACKPOT = '#8a5f18';

/**
 * 원반 배경 SVG.
 *
 * 칸을 DOM 요소로 만들어 배치하면 경계에 안티에일리어싱 틈이 생겨 바퀴가 갈라져 보인다.
 * 한 장의 SVG 로 그리면 그런 틈이 없다.
 */
function discSvg(count: number, jackpot: number[]): string {
  const cx = 100;
  const cy = 100;
  const r = 96;
  const step = (Math.PI * 2) / count;
  let wedges = '';
  for (let n = 0; n < count; n++) {
    // 0번 칸의 중앙이 위(12시)를 향하게 반 칸 돌려서 시작한다
    const a0 = n * step - Math.PI / 2 - step / 2;
    const a1 = a0 + step;
    const x0 = (cx + Math.cos(a0) * r).toFixed(2);
    const y0 = (cy + Math.sin(a0) * r).toFixed(2);
    const x1 = (cx + Math.cos(a1) * r).toFixed(2);
    const y1 = (cy + Math.sin(a1) * r).toFixed(2);
    const fill = jackpot.includes(n) ? SECTOR_JACKPOT : n % 2 === 0 ? SECTOR_A : SECTOR_B;
    wedges += `<path d="M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}Z" fill="${fill}"/>`;
    // 칸 사이 놋쇠 살
    wedges += `<line x1="${cx}" y1="${cy}" x2="${x0}" y2="${y0}" stroke="#c79a45" stroke-width="2.5"/>`;
  }
  return (
    `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<defs>` +
    // 가운데가 밝고 가장자리로 갈수록 어두워져야 접시가 아니라 볼록한 원반으로 보인다
    `<radialGradient id="wsh" cx="0.36" cy="0.3" r="0.85">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>` +
    `<stop offset="0.55" stop-color="#ffffff" stop-opacity="0.03"/>` +
    `<stop offset="1" stop-color="#01121c" stop-opacity="0.55"/></radialGradient>` +
    `<linearGradient id="wrim" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="#ffe9b8"/><stop offset="0.45" stop-color="#c79a45"/>` +
    `<stop offset="1" stop-color="#6b4a12"/></linearGradient>` +
    `</defs>` +
    `<g>${wedges}</g>` +
    `<circle cx="100" cy="100" r="96" fill="url(#wsh)"/>` +
    // 놋쇠 테 + 리벳
    `<circle cx="100" cy="100" r="96" fill="none" stroke="url(#wrim)" stroke-width="7"/>` +
    `<circle cx="100" cy="100" r="99.5" fill="none" stroke="#1a0f08" stroke-width="2.5"/>` +
    `<circle cx="100" cy="100" r="92" fill="none" stroke="#1a0f08" stroke-width="2"/>` +
    Array.from({ length: count }, (_, n) => {
      const a = n * step - Math.PI / 2;
      const x = (cx + Math.cos(a) * 96).toFixed(2);
      const y = (cy + Math.sin(a) * 96).toFixed(2);
      return `<circle cx="${x}" cy="${y}" r="3.4" fill="#f4dc9e" stroke="#1a0f08" stroke-width="1.4"/>`;
    }).join('') +
    `</svg>`
  );
}

/**
 * 계산된 transform 행렬에서 실제 회전각(도)을 꺼낸다.
 *
 * 전이가 아직 안 걸린 프레임에는 `transform: none` 이 나오는데, 그걸 그대로
 * DOMMatrix 에 넘기면 예외가 난다. 그 프레임은 0도로 친다.
 */
function currentAngle(node: HTMLElement): number {
  const raw = getComputedStyle(node).transform;
  if (!raw || raw === 'none') return 0;
  try {
    const m = new DOMMatrixReadOnly(raw);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  } catch {
    return 0;
  }
}

/**
 * 룰렛 원반을 만든다.
 *
 * @param count 칸 수
 * @param cellNode 칸 n 안에 넣을 요소 (아이콘 + 수량)
 * @param jackpot 놋쇠로 강조할 칸 번호
 */
export function createWheel(
  count: number,
  cellNode: (n: number) => HTMLElement,
  jackpot: number[] = [],
): WheelHandle {
  const disc = el('div', { class: 'wheel-disc', html: discSvg(count, jackpot) });

  // 칸 내용은 SVG 밖에 DOM 으로 얹는다 — 아이콘이 <img> 라서 SVG 안에 못 넣는다.
  const labels: HTMLElement[] = [];
  for (let n = 0; n < count; n++) {
    const deg = (360 / count) * n;
    // 칸 방향으로 밀어낸 뒤 **되돌려** 세운다. 안 그러면 글자가 기울어 읽기 어렵다.
    // 칸 위치는 각도 하나(`--a`)로만 넘긴다.
    //
    // 예전엔 `translateY(-62px)` 로 밀어냈는데, 원반 지름은 화면 폭에 따라 변하므로
    // 픽셀로 고정하면 작은 화면에서는 아이콘이 축에 처박히고 큰 화면에서는 테를 넘는다.
    // 지금은 칸 상자를 원반과 같은 크기로 깔고 위쪽에 붙여둔 뒤 상자째 돌린다 —
    // 밀어내는 거리가 자동으로 원반 크기에 비례한다.
    const label = el(
      'div',
      { class: 'wheel-item', style: `--a: ${deg}deg` },
      // 되돌려 세우는 것과 당첨 확대는 안쪽이 맡는다.
      // 바깥 transform 은 칸 위치를 잡는 데 이미 쓰고 있다.
      el('div', { class: 'wheel-item-in' }, cellNode(n)),
    );
    labels.push(label);
    disc.append(label);
  }

  const pointer = el('div', { class: 'wheel-pointer' });
  const hub = el('div', { class: 'wheel-hub' });
  // 원반을 잘라내는 층.
  //
  // 정사각형을 돌리면 **경계 상자**가 대각선 길이(약 1.41배)로 부푼다. 그대로 두면
  // 모달에 가로 스크롤이 생긴다. 원반 내용은 어차피 원 안에 있으므로 정사각형으로 잘라도
  // 잃는 게 없다. 포인터는 테 밖으로 조금 튀어나와야 해서 이 층 **밖**에 둔다.
  const stage = el('div', { class: 'wheel-stage' }, disc);
  // 회전각은 이 요소의 `--spin` 하나가 쥐고 있다 (원반과 칸이 각각 읽어 간다)
  const node = el('div', { class: 'wheel-wrap', style: '--spin: 0deg' }, stage, hub, pointer);

  let spinning = false;
  let angle = 0;
  let raf = 0;

  const stopTicker = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const spin = (winner: number): Promise<void> =>
    new Promise((resolve) => {
      if (spinning) {
        resolve();
        return;
      }
      spinning = true;
      labels.forEach((l) => l.classList.remove('won'));

      // 당첨 칸이 12시에 오려면 그 칸 각도만큼 **반대로** 돌아야 한다.
      const target = -(360 / count) * winner;
      // 항상 앞으로만 돌게 현재 각도보다 큰 값을 고른다 (뒤로 돌면 룰렛이 아니다)
      const turns = MIN_TURNS * TURN;
      let next = angle + turns;
      next += ((target - next) % TURN) + (((target - next) % TURN) > 0 ? 0 : TURN);
      angle = next;

      // 각도는 CSS 변수 하나로만 넘긴다.
      //
      // 원반(`.wheel-disc`)은 `+--spin` 으로 돌고, 칸 내용(`.wheel-item-in`)은 `-–spin` 으로
      // 같은 시간·같은 이징으로 되돌아간다. 둘이 정확히 상쇄되므로 **도는 동안에도, 멈춘 뒤에도**
      // 아이콘과 숫자가 화면 기준으로 똑바로 서 있다.
      // (되돌리지 않으면 원반이 45°의 배수에서 멈추므로 라벨이 전부 그만큼 기운 채 끝난다.)
      //
      // 변수만 바꾸면 transform 전이가 알아서 걸린다 — requestAnimationFrame 을 기다리지 않으므로
      // 탭이 백그라운드여도 "원반은 멈춰 있는데 보상만 지급되는" 일이 없다.
      node.style.setProperty('--spin', `${angle}deg`);

      // 칸을 지날 때마다 딸깍 + 포인터 튕김
      let lastSector = -1;
      const tick = (): void => {
        const a = currentAngle(disc);
        const sector = Math.floor((((-a % 360) + 360) % 360) / (360 / count));
        if (sector !== lastSector) {
          if (lastSector !== -1) {
            sfx.tap();
            pointer.classList.remove('kick');
            // 클래스를 다시 붙이려면 리플로우를 한 번 강제해야 애니메이션이 재생된다
            void pointer.offsetWidth;
            pointer.classList.add('kick');
          }
          lastSector = sector;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      window.setTimeout(() => {
        stopTicker();
        spinning = false;
        labels[winner].classList.add('won');
        sfx.star();
        haptics.win();
        resolve();
      }, SPIN_MS + 40);
    });

  return {
    node,
    spin,
    busy: () => spinning,
    destroy: stopTicker,
  };
}
