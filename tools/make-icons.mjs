// 아이콘 SVG 생성기.  실행: node tools/make-icons.mjs
//
// 이모지 대신 쓰는 자체 제작 벡터 아이콘이다. 외부 에셋 의존이 없고 라이선스 문제도 없다.
// 모두 64x64 viewBox, 색을 안에 넣어 <img> 로 그대로 쓸 수 있게 만든다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../game/src/assets/icons');

const wrap = (body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"${extra}>${body}</svg>\n`;

/** 위→아래 선형 그라디언트 */
const grad = (id, from, to) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;

const gloss =
  '<ellipse cx="24" cy="20" rx="9" ry="5.5" fill="#ffffff" opacity=".45" transform="rotate(-25 24 20)"/>';

// ---------- 아이템 셰이딩 ----------
//
// 선으로만 그린 아이콘과, 음영을 구운 아이콘을 한 화면에 섞으면 후자만 '아이템'으로 보이고
// 전자는 UI 기호로 보인다. 부스터는 **가지고 있는 물건**이어야 하므로 타일·잠수부와 같은
// 필터 스택(그림자 / 위 베벨 / 아래 AO / 바닥 물빛 림)으로 통일한다. 빛은 왼쪽 위.
const ITEM_FILTERS = `
<filter id="icShadow" x="-30%" y="-30%" width="170%" height="170%">
  <feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#03101a" flood-opacity="0.55"/>
</filter>
<filter id="icBevel" x="-30%" y="-30%" width="160%" height="160%">
  <feOffset dx="-2" dy="-3" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="3" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="i"/>
  <feFlood flood-color="#fff6e4" flood-opacity="0.55"/>
  <feComposite in2="i" operator="in"/>
</filter>
<filter id="icAo" x="-30%" y="-30%" width="160%" height="160%">
  <feOffset dx="2.5" dy="4" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="4" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="i"/>
  <feFlood flood-color="#100603" flood-opacity="0.55"/>
  <feComposite in2="i" operator="in"/>
</filter>
<filter id="icRim" x="-30%" y="-30%" width="160%" height="160%">
  <feOffset dx="0" dy="5" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="1.8" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="i"/>
  <feFlood flood-color="#8fe4ff" flood-opacity="0.5"/>
  <feComposite in2="i" operator="in"/>
</filter>`;

const OUTLINE = '#1a0f08';

/** 실루엣 + 베벨/AO/림 3층. 외곽선은 어두운 한 겹만. */
const shaded = (d, fill, sw = 2.6, stroke = OUTLINE) =>
  `<g filter="url(#icShadow)"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/></g>` +
  `<g filter="url(#icBevel)"><path d="${d}" fill="#000"/></g>` +
  `<g filter="url(#icAo)"><path d="${d}" fill="#000"/></g>` +
  `<g filter="url(#icRim)"><path d="${d}" fill="#000"/></g>`;

/** 원통형 몸체용 가로 3단 그라디언트 — 세로 그라디언트는 판때기로 보인다 */
const tube = (id, dark, light, mid) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.1">` +
  `<stop offset="0" stop-color="${dark}"/><stop offset="0.3" stop-color="${light}"/>` +
  `<stop offset="0.68" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;

const icons = {
  // ---- 재화 ----
  // 생명 — 납작한 하트 도형이면 UI 기호다. 부풀어 오른 젤리 덩어리로 보이려면
  // 구형 그라디언트 + 골에 그늘 + 단단한 스페큘러 점이 있어야 한다.
  heart: wrap(
    `<defs>${ITEM_FILTERS}` +
      `<radialGradient id="h" cx="0.34" cy="0.26" r="0.9">` +
      `<stop offset="0" stop-color="#ffd4e6"/><stop offset="0.4" stop-color="#ff7aad"/>` +
      `<stop offset="0.8" stop-color="#d93a76"/><stop offset="1" stop-color="#8d1f47"/></radialGradient></defs>` +
      shaded(
        'M32 56C16 44 6 35.5 6 25.5 6 17 12.8 11 20.6 11c4.9 0 9.1 2.5 11.4 6.2C34.3 13.5 38.5 11 43.4 11 51.2 11 58 17 58 25.5 58 35.5 48 44 32 56Z',
        'url(#h)',
        3,
      ) +
      // 두 봉우리 사이 골 — 이게 있어야 두 덩어리가 붙은 형태로 읽힌다
      '<path d="M32 20q0 6 -1 11" stroke="#8d1f47" stroke-width="3" fill="none" stroke-linecap="round" opacity=".35"/>' +
      '<ellipse cx="21" cy="24" rx="7" ry="4.6" fill="#fff" opacity=".62" transform="rotate(-32 21 24)"/>' +
      '<circle cx="19" cy="22" r="2.4" fill="#fff"/>',
  ),

  // 진주 — 그냥 흰 공에 하이라이트 하나면 구슬이다.
  // 진주로 읽히는 건 자개(nacre)의 무지갯빛과, 그늘 쪽 아래에서 되받아 올라오는
  // 반사광이다. 그 둘이 있어야 유리구슬이 아니라 진주가 된다.
  pearl: wrap(
    `<defs>` +
      `<radialGradient id="p" cx=".36" cy=".28" r=".82">` +
      `<stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#e2f0fa"/>` +
      `<stop offset=".62" stop-color="#9fc2d9"/><stop offset="1" stop-color="#4d738f"/></radialGradient>` +
      // 아래에서 되받는 반사광
      `<radialGradient id="pb" cx=".62" cy=".88" r=".5">` +
      `<stop offset="0" stop-color="#dff2ff" stop-opacity=".7"/>` +
      `<stop offset="1" stop-color="#dff2ff" stop-opacity="0"/></radialGradient>` +
      `</defs>` +
      '<circle cx="32" cy="34" r="21" fill="url(#p)" stroke="#3d6c8a" stroke-width="2.2"/>' +
      // 자개 — 밝은 쪽이 아니라 **중간톤~그늘 쪽**에 얹어야 보인다.
      // 하이라이트 위에 겹치면 흰색에 묻혀 사라진다.
      '<clipPath id="pc"><circle cx="32" cy="34" r="20"/></clipPath>' +
      '<g clip-path="url(#pc)">' +
      '<ellipse cx="26" cy="45" rx="16" ry="7" fill="#ff9ed6" opacity=".42" transform="rotate(-24 26 45)"/>' +
      '<ellipse cx="44" cy="37" rx="13" ry="6" fill="#7fecc0" opacity=".38" transform="rotate(-38 44 37)"/>' +
      '<ellipse cx="37" cy="50" rx="13" ry="5" fill="#9fb8ff" opacity=".4" transform="rotate(10 37 50)"/>' +
      '<ellipse cx="18" cy="35" rx="9" ry="5" fill="#ffd79e" opacity=".3" transform="rotate(-60 18 35)"/>' +
      '</g>' +
      '<circle cx="32" cy="34" r="21" fill="url(#pb)"/>' +
      // 넓은 하이라이트 + 단단한 스페큘러 점
      '<ellipse cx="25" cy="25" rx="7.5" ry="4.8" fill="#fff" opacity=".75" transform="rotate(-30 25 25)"/>' +
      '<circle cx="23.5" cy="23.5" r="2.4" fill="#ffffff"/>',
  ),

  // 불가사리 — 예전 건 오각별(★)이었다. 별과 불가사리는 다르다.
  // 팔이 뿌리에서 굵고 끝으로 갈수록 가늘어지며 끝이 둥글고, 표면에 돌기가 있다.
  starfish: (() => {
    const arms = 5;
    const cx = 32;
    const cy = 33;
    const pt = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const f = (v) => v.toFixed(1);

    let d = '';
    for (let n = 0; n < arms; n++) {
      const a = (Math.PI * 2 * n) / arms - Math.PI / 2;
      const next = (Math.PI * 2 * (n + 1)) / arms - Math.PI / 2;
      const mid = (a + next) / 2;
      const [tx, ty] = pt(a, 27);
      const [vx, vy] = pt(mid, 10.5);
      // 팔 옆면은 안으로 살짝 오목하다 — 직선이면 다시 별이 된다
      const [c1x, c1y] = pt(a + 0.34, 20);
      const [c2x, c2y] = pt(next - 0.34, 20);
      if (n === 0) d += `M${f(tx)} ${f(ty)}`;
      d += `Q${f(c1x)} ${f(c1y)} ${f(vx)} ${f(vy)}`;
      const [ntx, nty] = pt(next, 27);
      d += `Q${f(c2x)} ${f(c2y)} ${f(ntx)} ${f(nty)}`;
    }
    d += 'Z';

    // 표면 돌기 — 팔을 따라 두 줄
    let bumps = '';
    for (let n = 0; n < arms; n++) {
      const a = (Math.PI * 2 * n) / arms - Math.PI / 2;
      for (const r of [14, 18.5, 22.5]) {
        const [bx, by] = pt(a, r);
        const s = r > 20 ? 1.3 : 1.8;
        bumps += `<circle cx="${f(bx)}" cy="${f(by)}" r="${s}" fill="#a5521a" opacity=".3"/>`;
        bumps += `<circle cx="${f(bx)}" cy="${f(by - 0.7)}" r="${s * 0.75}" fill="#ffe7b8" opacity=".45"/>`;
      }
    }

    return wrap(
      `<defs><radialGradient id="s" cx=".38" cy=".3" r=".8">` +
        `<stop offset="0" stop-color="#ffe6ac"/><stop offset=".55" stop-color="#f5a93f"/>` +
        `<stop offset="1" stop-color="#d1701c"/></radialGradient></defs>` +
        `<path d="${d}" fill="url(#s)" stroke="#8f4514" stroke-width="2.2" stroke-linejoin="round"/>` +
        bumps +
        // 가운데가 살짝 부풀어 있다
        `<circle cx="${cx}" cy="${cy}" r="7" fill="#e8912f" opacity=".5"/>` +
        `<circle cx="${cx}" cy="${cy}" r="2.6" fill="#8f4514" opacity=".6"/>` +
        `<ellipse cx="${cx - 3}" cy="${cy - 4}" rx="5" ry="3" fill="#fff" opacity=".22" transform="rotate(-25 ${cx - 3} ${cy - 4})"/>`,
    );
  })(),

  // 산소통 — 잠수부가 등에 멘 것과 같은 물건으로 보여야 한다.
  oxygen: wrap(
    `<defs>${ITEM_FILTERS}${tube('o', '#123c52', '#a9e0f4', '#3d8aad')}` +
      `${tube('ov', '#3b4b57', '#dbe8f0', '#7d8f9c')}</defs>` +
      shaded('M20 20q12 -6 24 0l0 30q0 8 -12 8t-12 -8Z', 'url(#o)', 3) +
      // 밸브 + 손잡이
      `<rect x="26" y="6" width="12" height="16" rx="3" fill="url(#ov)" stroke="${OUTLINE}" stroke-width="2.6"/>` +
      `<path d="M20 10q12 -7 24 0" fill="none" stroke="#4b5b67" stroke-width="3.4" stroke-linecap="round"/>` +
      // 잔량 눈금 — 산소통이라는 걸 알려주는 유일한 단서
      `<rect x="24" y="30" width="16" height="18" rx="4" fill="#062231" opacity=".55"/>` +
      `<rect x="26" y="38" width="12" height="8" rx="3" fill="#7fe6ff"/>` +
      `<g stroke="#eaffff" stroke-width="2.2" stroke-linecap="round" opacity=".55">` +
      `<path d="M27 34h10"/></g>` +
      `<rect x="17" y="26" width="30" height="5" rx="2.5" fill="#e8b756" stroke="${OUTLINE}" stroke-width="2.2"/>`,
  ),

  // ---- 인게임 부스터 ----
  //
  // 부스터는 **인벤토리에 들어 있는 물건**이다. 선 몇 개로 그린 기호면
  // "쓸 수 있는 아이템"이 아니라 버튼 라벨처럼 읽힌다. 전부 덩어리로 다시 잡았다.

  // 작살 — 곧게 세우면 정지한 막대다. 비스듬히 눕히고 촉을 크게 키워
  // '날아가는 물건'의 방향감을 준다.
  harpoon: wrap(
    `<defs>${ITEM_FILTERS}${tube('hp', '#5d4526', '#e0bb7f', '#a2763c')}` +
      `${tube('hs', '#42525e', '#f2f8fc', '#8fa3b1')}</defs>` +
      `<g transform="rotate(28 32 32)">` +
      // 자루
      shaded('M28 26h8v30q0 4 -4 4t-4 -4Z', 'url(#hp)', 2.6) +
      // 촉 + 미늘. 미늘이 있어야 작살이고, 없으면 화살이다.
      shaded('M32 2 47 26h-6l-3 5h-12l-3 -5h-6Z', 'url(#hs)', 2.8) +
      shaded('M17 26 8 14q9 -1 13 6Z', 'url(#hs)', 2.4) +
      shaded('M47 26 56 14q-9 -1 -13 6Z', 'url(#hs)', 2.4) +
      // 놋쇠 이음쇠
      `<rect x="25" y="26" width="14" height="7" rx="3" fill="#e8b756" stroke="${OUTLINE}" stroke-width="2.4"/>` +
      `</g>`,
  ),

  // 폭뢰 — 드럼통 + 신관. 노란 경고띠가 '터지는 물건'이라고 말해준다.
  'depth-charge': wrap(
    `<defs>${ITEM_FILTERS}${tube('d', '#161d26', '#8598ab', '#3f4c5b')}` +
      `<radialGradient id="dc" cx="0.35" cy="0.3" r="0.8">` +
      `<stop offset="0" stop-color="#fff0b8"/><stop offset="0.6" stop-color="#ffb340"/>` +
      `<stop offset="1" stop-color="#c06a06"/></radialGradient></defs>` +
      shaded('M14 22q18 -8 36 0l0 26q-18 9 -36 0Z', 'url(#d)', 3) +
      // 신관 손잡이
      `<path d="M24 20V11h16v9" fill="none" stroke="#8598ab" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M24 20V11h16v9" fill="none" stroke="${OUTLINE}" stroke-width="1.6"/>` +
      // 경고띠.
      //
      // 넓고 밝게 두면 32px 에서 띠 색이 몸통을 이겨서 **보물궤(gift)와 실루엣이 겹친다.**
      // 좁게, 어둡게 — 강철 드럼이라는 게 먼저 읽히고 띠는 거기 붙은 표식으로 남아야 한다.
      `<path d="M14 31q18 -7 36 0l0 4q-18 7 -36 0Z" fill="#e8a72c" opacity=".95"/>` +
      `<g fill="#1a0f08" opacity=".7">` +
      [17, 24, 31, 38, 45].map((x) => `<path d="M${x} 30l4 0 -4 7 -4 0Z"/>`).join('') +
      `</g>` +
      // 뇌관 램프
      `<circle cx="32" cy="45" r="7" fill="url(#dc)" stroke="${OUTLINE}" stroke-width="2.6"/>` +
      `<circle cx="30" cy="43" r="2.2" fill="#fff" opacity=".8"/>`,
  ),

  // 해류 — 선 세 줄은 '물결 표시'이지 아이템이 아니다.
  // 두께가 변하는 리본으로 채우고 물마루에 하이라이트를 얹어 흐르는 물덩어리로 만든다.
  tide: (() => {
    const ribbon = (y, w) =>
      `M2 ${y}c8-10 16-10 24 0s16 10 24 0l12-1v${w}l-12 1c-8 10-16 10-24 0s-16-10-24 0Z`;
    return wrap(
      `<defs>${ITEM_FILTERS}` +
        `<linearGradient id="t1" x1="0" y1="0" x2="1" y2="0.3">` +
        `<stop offset="0" stop-color="#bff6ff"/><stop offset="0.5" stop-color="#4fd8ff"/>` +
        `<stop offset="1" stop-color="#1d7fae"/></linearGradient>` +
        `<linearGradient id="t2" x1="0" y1="0" x2="1" y2="0.3">` +
        `<stop offset="0" stop-color="#8fe4ff"/><stop offset="0.5" stop-color="#2ba4d6"/>` +
        `<stop offset="1" stop-color="#0f5f85"/></linearGradient></defs>` +
        shaded(ribbon(20, 9), 'url(#t1)', 2.4) +
        shaded(ribbon(37, 9), 'url(#t2)', 2.4) +
        shaded(ribbon(52, 8), 'url(#t2)', 2.4) +
        // 물마루 반짝임
        `<g stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".55">` +
        `<path d="M8 18q6 -6 12 -1"/><path d="M8 35q6 -6 12 -1"/></g>`,
    );
  })(),

  // ---- 시작 부스터 ----
  // 시작 부스터는 '보드에 미리 놓이는 특수 타일'이다. 그래서 셋 다
  // **토큰(둥근 메달) 안에 그 타일이 들어 있는** 형태로 통일했다 — 인게임 부스터와 구분된다.
  'pre-current': wrap(
    `<defs>${ITEM_FILTERS}` +
      `<radialGradient id="c" cx="0.34" cy="0.28" r="0.85">` +
      `<stop offset="0" stop-color="#d6fbff"/><stop offset="0.45" stop-color="#5cd2f5"/>` +
      `<stop offset="1" stop-color="#0d5f85"/></radialGradient></defs>` +
      shaded('M32 5a27 27 0 1 1-0.1 0Z', 'url(#c)', 3) +
      // 양방향 화살 — 그 행/열이 통째로 쓸려나간다는 뜻
      `<path d="M13 32 25 22v7h14v-7l12 10-12 10v-7H25v7Z" fill="#ffffff" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<ellipse cx="23" cy="17" rx="8" ry="4.6" fill="#fff" opacity=".5" transform="rotate(-28 23 17)"/>`,
  ),

  'pre-mine': wrap(
    `<defs>${ITEM_FILTERS}` +
      `<radialGradient id="m" cx="0.34" cy="0.28" r="0.85">` +
      `<stop offset="0" stop-color="#7c8ea0"/><stop offset="0.5" stop-color="#2c3743"/>` +
      `<stop offset="1" stop-color="#0a0e13"/></radialGradient>` +
      `<radialGradient id="mg" cx="0.5" cy="0.5" r="0.5">` +
      `<stop offset="0" stop-color="#ffd257"/><stop offset="1" stop-color="#ff7a2b"/></radialGradient></defs>` +
      // 뿔 — 원뿔이라야 기뢰다. 막대면 태양 아이콘이 된다.
      `<g fill="url(#mg)" stroke="${OUTLINE}" stroke-width="2.2" stroke-linejoin="round">` +
      [0, 45, 90, 135, 180, 225, 270, 315]
        .map((deg) => {
          const a = (deg * Math.PI) / 180;
          const p = (r, o) => [
            (32 + Math.cos(a + o) * r).toFixed(1),
            (32 + Math.sin(a + o) * r).toFixed(1),
          ];
          const [tx, ty] = p(30, 0);
          const [b1x, b1y] = p(17, 0.24);
          const [b2x, b2y] = p(17, -0.24);
          return `<path d="M${tx} ${ty}L${b1x} ${b1y}L${b2x} ${b2y}Z"/>`;
        })
        .join('') +
      `</g>` +
      shaded('M32 12a20 20 0 1 1-0.1 0Z', 'url(#m)', 2.8) +
      `<ellipse cx="25" cy="24" rx="6" ry="3.6" fill="#fff" opacity=".3" transform="rotate(-30 25 24)"/>`,
  ),

  // 심연의 진주 — 재화 진주(`pearl`)와 **한눈에 갈라져야 한다**.
  //
  // 예전에는 무지갯빛 부채꼴 위에 흰 구체 음영을 두껍게 덮었다. 큰 화면에서는 무지개가
  // 보였지만 상점 목록·일일 보상 칸 크기(32~44px)로 줄이면 흰 구슬만 남아서 재화 진주와
  // 구분이 안 됐다 — 상점에서 '진주로 사는 물건'과 '진주 자체'가 같은 그림이면 값을
  // 잘못 읽는다.
  //
  // 그래서 이름 그대로 간다: 몸통은 심연(검푸른 구체), 무지갯빛은 **가장자리 고리로만**
  // 남긴다. 보드 위 특수 타일과의 연결은 그 고리가 잇고, 밝기·색이 반대라 작게 줄여도
  // 재화 진주와 헷갈리지 않는다.
  'pre-pearl': (() => {
    const cx = 32;
    const cy = 32;
    const r = 30;
    const hues = [0, 45, 90, 160, 215, 285];
    let wedges = '';
    for (let n = 0; n < hues.length; n++) {
      const a0 = (Math.PI * 2 * n) / hues.length - Math.PI / 2;
      const a1 = (Math.PI * 2 * (n + 1)) / hues.length - Math.PI / 2;
      const x0 = (cx + Math.cos(a0) * r).toFixed(2);
      const y0 = (cy + Math.sin(a0) * r).toFixed(2);
      const x1 = (cx + Math.cos(a1) * r).toFixed(2);
      const y1 = (cy + Math.sin(a1) * r).toFixed(2);
      wedges += `<path d="M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}Z" fill="hsl(${hues[n]} 95% 66%)"/>`;
    }
    return wrap(
      '<defs>' +
        // 무지갯빛이 남는 자리 = 바깥 원에서 안쪽 원을 뺀 고리. 두 원을 한 path 에 넣고
        // evenodd 로 안쪽을 뚫는다 (구멍이 나야 몸통의 어둠이 그대로 보인다).
        '<clipPath id="vpring" clip-rule="evenodd">' +
        '<path clip-rule="evenodd" d="M32 8a24 24 0 1 0 0 48a24 24 0 1 0 0-48ZM32 16a16 16 0 1 1 0 32a16 16 0 1 1 0-32Z"/></clipPath>' +
        // 몸통 — 빛은 왼쪽 위, 가장자리로 갈수록 먹빛으로 떨어진다
        '<radialGradient id="vpd" cx=".36" cy=".28" r=".88">' +
        '<stop offset="0" stop-color="#6b53c8"/>' +
        '<stop offset=".45" stop-color="#241a52"/>' +
        '<stop offset="1" stop-color="#070312"/></radialGradient>' +
        // 아래에서 되받는 물빛 반사광. 진주다움은 이 반사광이 담당한다.
        '<radialGradient id="vpb" cx=".62" cy=".9" r=".42">' +
        '<stop offset="0" stop-color="#7fe6ff" stop-opacity=".5"/>' +
        '<stop offset="1" stop-color="#7fe6ff" stop-opacity="0"/></radialGradient>' +
        '</defs>' +
        '<circle cx="32" cy="32" r="24" fill="url(#vpd)"/>' +
        `<g clip-path="url(#vpring)" style="filter:blur(3px)" opacity=".95">${wedges}</g>` +
        '<circle cx="32" cy="32" r="24" fill="url(#vpb)"/>' +
        '<circle cx="32" cy="32" r="24" fill="none" stroke="#05020c" stroke-width="2.5"/>' +
        // 하이라이트는 작고 흐리게. 재화 진주만큼 크게 넣으면 다시 흰 구슬로 보인다.
        '<ellipse cx="24" cy="21" rx="6" ry="3.4" fill="#fff" opacity=".45" transform="rotate(-30 24 21)"/>' +
        '<circle cx="22.5" cy="20" r="1.8" fill="#ffffff" opacity=".8"/>',
    );
  })(),

  // ---- 장애물 / 목표 ----
  rock: wrap(
    `<defs>${grad('r', '#8b99a9', '#4a5764')}</defs>` +
      '<path d="M32 6 54 18l-4 30-18 10-18-10-4-30Z" fill="url(#r)" stroke="#2b3540" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<path d="M32 6v22l18-10M32 28 14 18M32 28v30" stroke="#2b3540" stroke-width="2" opacity=".45" fill="none"/>',
  ),

  ice: wrap(
    `<defs>${grad('i', '#e8fbff', '#7fc9e8')}</defs>` +
      '<rect x="8" y="8" width="48" height="48" rx="8" fill="url(#i)" stroke="#3f8bab" stroke-width="2.5" opacity=".92"/>' +
      '<path d="M18 20 30 32 18 44M46 20 34 32l12 12" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>',
  ),

  net: wrap(
    '<rect x="8" y="8" width="48" height="48" rx="8" fill="#0a3d55" opacity=".35"/>' +
      '<g stroke="#efe4c0" stroke-width="3.5" stroke-linecap="round">' +
      '<path d="M20 8v48M32 8v48M44 8v48M8 20h48M8 32h48M8 44h48"/></g>' +
      '<g fill="#c8b98b"><circle cx="20" cy="20" r="2.4"/><circle cx="32" cy="20" r="2.4"/><circle cx="44" cy="20" r="2.4"/>' +
      '<circle cx="20" cy="32" r="2.4"/><circle cx="32" cy="32" r="2.4"/><circle cx="44" cy="32" r="2.4"/>' +
      '<circle cx="20" cy="44" r="2.4"/><circle cx="32" cy="44" r="2.4"/><circle cx="44" cy="44" r="2.4"/></g>',
  ),

  cage: wrap(
    `<defs>${grad('cg', '#9fb4c2', '#4d6273')}</defs>` +
      '<path d="M10 18h44v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#062c3f" opacity=".55"/>' +
      '<path d="M8 18 32 6l24 12" fill="none" stroke="url(#cg)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<g stroke="url(#cg)" stroke-width="4.5" stroke-linecap="round">' +
      '<path d="M14 20v38M25 20v38M39 20v38M50 20v38M10 58h44"/></g>',
  ),

  diver: wrap(
    `<defs>${grad('dv', '#ffd257', '#e08a12')}</defs>` +
      '<circle cx="32" cy="32" r="22" fill="#b9862a" stroke="#6d4a10" stroke-width="2.5"/>' +
      '<circle cx="32" cy="32" r="14" fill="url(#dv)" stroke="#6d4a10" stroke-width="2.5"/>' +
      '<path d="M32 18a14 14 0 0 0-9.9 23.9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".75"/>' +
      '<g fill="#6d4a10"><circle cx="10" cy="32" r="4"/><circle cx="54" cy="32" r="4"/><circle cx="32" cy="9" r="4"/></g>',
  ),

  // ---- 하단 독 ----
  aquarium: wrap(
    `<defs>${grad('aq', '#2fb7e6', '#0b4f70')}</defs>` +
      '<rect x="6" y="12" width="52" height="42" rx="7" fill="url(#aq)" stroke="#d6f2ff" stroke-width="3"/>' +
      '<path d="M40 32c0 5-5 9-11 9s-11-4-11-9 5-9 11-9 11 4 11 9Z" fill="#ffd257"/>' +
      '<path d="M40 32 51 25v14Z" fill="#ffd257"/>' +
      '<circle cx="24" cy="30" r="1.8" fill="#0b3348"/>' +
      '<g fill="#dff6ff" opacity=".8"><circle cx="16" cy="22" r="2.5"/><circle cx="21" cy="17" r="1.8"/></g>',
  ),

  shop: wrap(
    `<defs>${grad('sh', '#7fe0ff', '#1c86b5')}</defs>` +
      '<path d="M12 20h40l-4 34a4 4 0 0 1-4 3.5H20a4 4 0 0 1-4-3.5Z" fill="url(#sh)" stroke="#0d4f6d" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<path d="M23 24V17a9 9 0 0 1 18 0v7" fill="none" stroke="#0d4f6d" stroke-width="3.5" stroke-linecap="round"/>',
  ),

  wheel: wrap(
    '<circle cx="32" cy="32" r="25" fill="#0b4560" stroke="#d6f2ff" stroke-width="3"/>' +
      '<path d="M32 32 32 7A25 25 0 0 1 49.7 14.3Z" fill="#ff7a6b"/>' +
      '<path d="M32 32 49.7 14.3A25 25 0 0 1 57 32Z" fill="#ffd257"/>' +
      '<path d="M32 32h25a25 25 0 0 1-7.3 17.7Z" fill="#5fe0a0"/>' +
      '<path d="M32 32 49.7 49.7A25 25 0 0 1 32 57Z" fill="#5ed6ff"/>' +
      '<path d="M32 32V57a25 25 0 0 1-17.7-7.3Z" fill="#c48bff"/>' +
      '<path d="M32 32 14.3 49.7A25 25 0 0 1 7 32Z" fill="#ff9ec4"/>' +
      '<path d="M32 32H7a25 25 0 0 1 7.3-17.7Z" fill="#ffb340"/>' +
      '<path d="M32 32 14.3 14.3A25 25 0 0 1 32 7Z" fill="#8ef0ff"/>' +
      '<circle cx="32" cy="32" r="5" fill="#fff" stroke="#0b4560" stroke-width="2"/>',
  ),

  // 보상 상자 — 리본 두른 선물상자보다 **바다에서 건진 보물궤**가 이 게임에 맞는다.
  gift: wrap(
    `<defs>${ITEM_FILTERS}${tube('gf', '#4a2a0c', '#c9903f', '#8a5a1c')}` +
      `${tube('gw', '#3a2409', '#a9773a', '#6d4712')}</defs>` +
      // 궤 뚜껑 (반원)
      shaded('M8 30q24 -20 48 0l0 4q-24 -16 -48 0Z', 'url(#gf)', 2.8) +
      shaded('M8 30q24 -20 48 0v4H8Z', 'url(#gf)', 2.8) +
      // 궤 몸통
      shaded('M9 34h46v18q0 5 -5 5H14q-5 0 -5 -5Z', 'url(#gw)', 2.8) +
      // 테두리 쇠띠
      `<g fill="none" stroke="#e0e9f0" stroke-width="3" opacity=".8">` +
      `<path d="M20 16v41M44 16v41"/></g>` +
      `<g fill="none" stroke="${OUTLINE}" stroke-width="1.4" opacity=".7">` +
      `<path d="M20 16v41M44 16v41"/></g>` +
      // 자물쇠
      `<rect x="26" y="31" width="12" height="13" rx="3" fill="#f4dc9e" stroke="${OUTLINE}" stroke-width="2.4"/>` +
      `<circle cx="32" cy="37" r="2.4" fill="${OUTLINE}"/>` +
      // 새어 나오는 빛 — 안에 뭔가 들었다는 신호
      `<path d="M12 33h40" stroke="#fff4c4" stroke-width="2.6" stroke-linecap="round" opacity=".75"/>`,
  ),

  // 돼지 저금통.
  //
  // 예전 건 분홍 타원에 다리 네 획이라 돼지로 안 읽혔다. 돼지라고 말해주는 건
  // **주둥이**다 — 콧구멍 둘 박힌 원통이 앞으로 튀어나와야 한다. 그 다음이 늘어진 귀와
  // 말린 꼬리다. 저금통이라는 건 등의 동전 투입구와 그 위로 들어가는 동전이 알려준다.
  piggy: wrap(
    `<defs>${ITEM_FILTERS}` +
      `<radialGradient id="pg" cx="0.34" cy="0.28" r="0.9">` +
      `<stop offset="0" stop-color="#ffd9ea"/><stop offset="0.45" stop-color="#ff9ec9"/>` +
      `<stop offset="0.82" stop-color="#e2568f"/><stop offset="1" stop-color="#8d1f47"/></radialGradient>` +
      `<radialGradient id="pgs" cx="0.34" cy="0.3" r="0.85">` +
      `<stop offset="0" stop-color="#ffc9e0"/><stop offset="1" stop-color="#d94a83"/></radialGradient>` +
      `<radialGradient id="pgc" cx="0.35" cy="0.3" r="0.8">` +
      `<stop offset="0" stop-color="#fff0b8"/><stop offset="0.6" stop-color="#ffc94a"/>` +
      `<stop offset="1" stop-color="#c07d06"/></radialGradient></defs>` +
      // 말린 꼬리 — 몸통 뒤로 빠지므로 먼저 그린다
      `<path d="M9 33q-6 -1 -6 4 0 4 4 4 3 0 3 -3" fill="none" stroke="${OUTLINE}" stroke-width="5.4" stroke-linecap="round"/>` +
      `<path d="M9 33q-6 -1 -6 4 0 4 4 4 3 0 3 -3" fill="none" stroke="#e2568f" stroke-width="3" stroke-linecap="round"/>` +
      // 다리 둘 — 옆에서 본 그림이라 앞다리·뒷다리가 각각 하나씩만 보인다.
      // 넷을 늘어놓으면 64px 에서 다리 사이 간격이 1~2px 로 뭉개져 톱니처럼 보인다.
      [17, 41].map(
        (x) =>
          `<rect x="${x}" y="46" width="11" height="12" rx="5" fill="#d94a83" stroke="${OUTLINE}" stroke-width="2.4"/>`,
      ).join('') +
      // 몸통
      shaded('M10 34q0 -16 21 -16 21 0 21 16 0 16 -21 16 -21 0 -21 -16Z', 'url(#pg)', 3) +
      // 귀 — 앞으로 접혀 늘어진다
      `<path d="M20 21q-4 -10 3 -12 6 -1 7 9Z" fill="#d94a83" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/>` +
      // 주둥이 — 이게 있어야 돼지다
      `<ellipse cx="53" cy="35" rx="9" ry="8" fill="url(#pgs)" stroke="${OUTLINE}" stroke-width="2.8"/>` +
      `<ellipse cx="50" cy="35" rx="1.9" ry="2.6" fill="${OUTLINE}" opacity=".75"/>` +
      `<ellipse cx="56" cy="35" rx="1.9" ry="2.6" fill="${OUTLINE}" opacity=".75"/>` +
      // 눈
      `<circle cx="41" cy="30" r="2.6" fill="${OUTLINE}"/>` +
      `<circle cx="40.2" cy="29.2" r="0.9" fill="#fff"/>` +
      // 동전 투입구 + 들어가는 동전
      `<rect x="22" y="19" width="17" height="5" rx="2.5" fill="#5c1230" stroke="${OUTLINE}" stroke-width="2"/>` +
      `<circle cx="30" cy="10" r="7" fill="url(#pgc)" stroke="${OUTLINE}" stroke-width="2.6"/>` +
      `<circle cx="28" cy="8" r="2.2" fill="#fff" opacity=".55"/>`,
  ),

  settings: wrap(
    '<path d="M32 4l4.8 6.6 8-2.3 1.6 8.2 8.2 1.6-2.3 8L59 32l-6.7 4.8 2.3 8-8.2 1.6-1.6 8.2-8-2.3L32 59l-4.8-6.7-8 2.3-1.6-8.2-8.2-1.6 2.3-8L5 32l6.7-4.9-2.3-8 8.2-1.6 1.6-8.2 8 2.3Z" fill="#9fd8f0" stroke="#2b6a86" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="32" cy="32" r="10" fill="#0b4560" stroke="#2b6a86" stroke-width="2.5"/>',
  ),

  // ---- 기타 UI ----
  lock: wrap(
    '<path d="M20 28v-6a12 12 0 0 1 24 0v6" fill="none" stroke="#9fb4c2" stroke-width="5" stroke-linecap="round"/>' +
      '<rect x="13" y="28" width="38" height="28" rx="6" fill="#7d8b9c" stroke="#3b4855" stroke-width="2.5"/>' +
      '<circle cx="32" cy="40" r="4.5" fill="#2b3540"/><path d="M32 43v6" stroke="#2b3540" stroke-width="4" stroke-linecap="round"/>',
  ),

  star: wrap(
    `<defs>${grad('st', '#fff0b8', '#ffb340')}</defs>` +
      '<path d="M32 6 40 24l19.5 2-14.3 13.6L48.6 59 32 49.5 15.4 59l3.4-19.4L4.5 26 24 24Z" fill="url(#st)" stroke="#a5521a" stroke-width="2.5" stroke-linejoin="round"/>',
  ),

  'star-empty': wrap(
    '<path d="M32 6 40 24l19.5 2-14.3 13.6L48.6 59 32 49.5 15.4 59l3.4-19.4L4.5 26 24 24Z" fill="none" stroke="#6d8a9c" stroke-width="3" stroke-linejoin="round" opacity=".55"/>',
  ),

  close: wrap(
    '<path d="M16 16 48 48M48 16 16 48" stroke="#eaf7ff" stroke-width="6" stroke-linecap="round"/>',
  ),

  back: wrap(
    '<path d="M40 10 20 32l20 22" fill="none" stroke="#eaf7ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
  ),

  plus: wrap(
    '<circle cx="32" cy="32" r="24" fill="#5fe0a0" stroke="#1c7a4d" stroke-width="3"/>' +
      '<path d="M32 20v24M20 32h24" stroke="#08341f" stroke-width="6" stroke-linecap="round"/>',
  ),
};

mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(icons)) {
  writeFileSync(resolve(OUT, `${name}.svg`), svg, 'utf8');
}
console.log(`wrote ${Object.keys(icons).length} icons to ${OUT}`);
