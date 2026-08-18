// 곰치·케이지 스프라이트 생성기.  실행: node tools/make-sprites.mjs
//
// 곰치 머리는 위턱(eel-head)과 아래턱(eel-jaw)으로 쪼개서 낸다 — 경첩에서 실제로
// 턱이 열려야 물어뜯는 동작이 나온다.
//
// 회전 기준점(pivot) 규약: 각 부위의 viewBox 안에서 PIVOTS 에 적은 좌표가 관절이다.
// 그리는 쪽(render/eelRig.ts)이 이 값을 알고 있어야 한다.
//
// 잠수부는 여기서 만들지 않는다 — Quaternius 모델을 tools/bake-diver-3d.mjs 로 굽는다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../game/src/assets/sprites');

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;

// ---------- 곰치 ----------
// 타일과 같은 필터 스택(그림자·베벨·AO·림라이트)을 써야 같은 화면에서 재질이 어긋나지 않는다.

const EEL_FILTERS = `
<filter id="eelShadow" x="-30%" y="-30%" width="170%" height="180%">
  <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#02100a" flood-opacity="0.6"/>
</filter>
<filter id="eelBevel" x="-20%" y="-20%" width="140%" height="140%">
  <feOffset dx="-3" dy="-9" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="6" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="inner"/>
  <feFlood flood-color="#dcffb0" flood-opacity="0.55"/>
  <feComposite in2="inner" operator="in"/>
</filter>
<filter id="eelAo" x="-20%" y="-20%" width="140%" height="140%">
  <feOffset dx="3" dy="11" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="9" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="inner"/>
  <feFlood flood-color="#02120a" flood-opacity="0.7"/>
  <feComposite in2="inner" operator="in"/>
</filter>
<filter id="eelRim" x="-20%" y="-20%" width="140%" height="140%">
  <feOffset dx="0" dy="13" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="3" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="inner"/>
  <feFlood flood-color="#9fe8ff" flood-opacity="0.42"/>
  <feComposite in2="inner" operator="in"/>
</filter>`;

const EEL_GRADS = `
<linearGradient id="ehSkin" x1="0.1" y1="0" x2="0.6" y2="1">
  <stop offset="0" stop-color="#8fb44e"/>
  <stop offset="0.45" stop-color="#5c8433"/>
  <stop offset="1" stop-color="#2d4a1d"/>
</linearGradient>
<linearGradient id="ejSkin" x1="0.1" y1="0" x2="0.5" y2="1">
  <stop offset="0" stop-color="#7ba244"/>
  <stop offset="1" stop-color="#28421a"/>
</linearGradient>
<radialGradient id="ehEye" cx="0.4" cy="0.35" r="0.7">
  <stop offset="0" stop-color="#ffe9a1"/>
  <stop offset="0.6" stop-color="#e8a81f"/>
  <stop offset="1" stop-color="#9a6206"/>
</radialGradient>
<linearGradient id="ehMouth" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#54121c"/>
  <stop offset="1" stop-color="#8c2f3a"/>
</linearGradient>
<linearGradient id="ehFin" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#a8cf6d"/>
  <stop offset="1" stop-color="#4c7a2c"/>
</linearGradient>`;

/**
 * 머리 실루엣 — 목덜미(10,60)에서 주둥이 끝까지.
 * 끝을 viewBox 경계에 붙이면 드롭섀도·베벨이 잘려 단면이 생긴다. 여유를 둔다.
 */
const EEL_SKULL =
  'M10 36q34 -25 80 -13 44 10 74 36 5 4 0 8 -9 8 -23 8l-52 -3q-42 -2 -81 6Z';

/** 아래턱 — 경첩(10,8) 에서 앞으로 */
const EEL_JAW = 'M10 8q40 8 78 22 28 11 54 22 -30 10 -66 4Q28 44 8 28Z';

/** 뒤로 휘어진 송곳니. 곧은 삼각형은 이빨이 아니라 톱니로 보인다. */
const fang = (x, y, len, up = false) => {
  const s = up ? -1 : 1;
  return (
    `<path d="M${x} ${y}` +
    `q1 ${(s * len * 0.5).toFixed(1)} -2.5 ${(s * len).toFixed(1)}` +
    `q6.5 ${(-s * len * 0.42).toFixed(1)} 6.5 ${(-s * len * 0.98).toFixed(1)}Z"/>`
  );
};

/** 얼룩 무늬 — 곰치 특유의 점막. 클립 안에서만 보인다. */
const EEL_BLOTCHES = [
  [30, 46, 13, 9],
  [58, 66, 10, 7],
  [86, 34, 12, 8],
  [104, 60, 9, 6],
  [126, 44, 11, 7],
  [46, 22, 9, 6],
  [140, 66, 8, 5],
  [72, 50, 7, 5],
]
  .map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#e8dfa0"/>`)
  .join('');

const sprites = {
  // 곰치 머리 — 위턱·눈까지 포함. 회전 기준은 목덜미(10,60).
  //
  // 평평한 초록 삼각형이면 '몬스터'가 아니라 도형으로 보인다.
  // 실제 곰치처럼 주둥이를 길게 빼고, 얼룩덜룩한 점막 무늬를 넣고,
  // 베벨·AO·림라이트를 구워 물속 덩어리로 읽히게 한다.
  'eel-head': svg(
    190,
    130,
    `<defs>${EEL_FILTERS}${EEL_GRADS}</defs>` +
      `<g filter="url(#eelShadow)">` +
      // 머리통 — 목덜미에서 시작해 주둥이 끝까지 길게
      `<g>` +
      `<path id="ehBody" d="${EEL_SKULL}" fill="url(#ehSkin)"/>` +
      `<g filter="url(#eelBevel)"><path d="${EEL_SKULL}" fill="#000"/></g>` +
      `<g filter="url(#eelAo)"><path d="${EEL_SKULL}" fill="#000"/></g>` +
      `<g filter="url(#eelRim)"><path d="${EEL_SKULL}" fill="#000"/></g>` +
      `</g>` +
      `</g>` +
      // 얼룩 무늬 — 머리 실루엣 안에서만 보이게 클립
      `<clipPath id="ehClip"><path d="${EEL_SKULL}"/></clipPath>` +
      `<g clip-path="url(#ehClip)" opacity="0.5">` +
      EEL_BLOTCHES +
      `</g>` +
      // 입 안쪽 (위턱 아래면)
      `<path d="M82 72q38 4 74 6 -16 11 -40 9l-36 -6Z" fill="url(#ehMouth)"/>` +
      // 위턱 이빨 — 앞으로 갈수록 작아진다
      `<g fill="#f4f7f2" stroke="#9aa79b" stroke-width="1">` +
      [0, 1, 2, 3, 4, 5].map((n) => fang(80 + n * 12, 70, 19 - n * 2.1)).join('') +
      `</g>` +
      // 아가미 구멍
      `<ellipse cx="36" cy="78" rx="7" ry="10" fill="#1c3016" opacity=".75"/>` +
      // 눈 — 흰자 없이 노란 홍채 + 세로 동공, 위에 하이라이트
      `<circle cx="68" cy="42" r="12.5" fill="#1e3317"/>` +
      `<circle cx="68" cy="42" r="10" fill="url(#ehEye)"/>` +
      `<ellipse cx="68" cy="42" rx="3.4" ry="8.4" fill="#120c04"/>` +
      `<ellipse cx="64" cy="37" rx="3.6" ry="2.6" fill="#ffffff" opacity=".9"/>` +
      // 눈두덩 — 성난 인상은 눈썹 하나로 결정된다
      `<path d="M52 29q16 -3 30 6" fill="none" stroke="#223d19" stroke-width="6" stroke-linecap="round"/>` +
      // 콧구멍 튜브 (곰치 특징)
      `<ellipse cx="146" cy="56" rx="4.5" ry="5.5" fill="#2a4720"/>` +
      // 등지느러미 시작부
      `<path d="M14 32q28 -22 62 -17 -26 9 -43 24Z" fill="url(#ehFin)" opacity=".9"/>`,
  ),

  // 곰치 아래턱 — 경첩(10,8) 기준으로 회전시켜 입을 벌린다
  'eel-jaw': svg(
    150,
    72,
    `<defs>${EEL_FILTERS}${EEL_GRADS}</defs>` +
      `<g filter="url(#eelShadow)">` +
      `<path d="${EEL_JAW}" fill="url(#ejSkin)"/>` +
      `<g filter="url(#eelBevel)"><path d="${EEL_JAW}" fill="#000"/></g>` +
      `<g filter="url(#eelAo)"><path d="${EEL_JAW}" fill="#000"/></g>` +
      `</g>` +
      `<clipPath id="ejClip"><path d="${EEL_JAW}"/></clipPath>` +
      `<g clip-path="url(#ejClip)" opacity="0.4">` +
      EEL_BLOTCHES +
      `</g>` +
      // 아래턱 이빨 — 위를 향한다
      `<g fill="#f4f7f2" stroke="#9aa79b" stroke-width="1">` +
      [0, 1, 2, 3, 4].map((n) => fang(36 + n * 15, 26, 17 - n * 1.8, true)).join('') +
      `</g>`,
  ),

  // 케이지 창살 — 잠수부 앞에 덮는다.
  //
  // 매끈한 회색 막대 네 개면 울타리 그림이지 '가둔 것'으로 안 보인다.
  // 바다에 오래 잠긴 쇠는 녹슬고 얼룩진다. 세로봉마다 명암을 넣어 원통으로 세우고,
  // 가로 띠에 리벳을 박고, 녹 얼룩을 얹는다.
  'cage-bars': svg(
    96,
    96,
    `<defs>` +
      `<linearGradient id="cbBar" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#4d5a63"/>` +
      `<stop offset="0.32" stop-color="#c3d2dc"/>` +
      `<stop offset="0.62" stop-color="#8496a3"/>` +
      `<stop offset="1" stop-color="#39444c"/></linearGradient>` +
      `<linearGradient id="cbRail" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#c3d2dc"/>` +
      `<stop offset="0.45" stop-color="#7d8f9c"/>` +
      `<stop offset="1" stop-color="#333d45"/></linearGradient>` +
      `</defs>` +
      // 세로봉 — 원통으로 보이게 좌우 그라디언트
      [14, 35, 61, 82]
        .map(
          (x) =>
            `<rect x="${x - 4}" y="6" width="8" height="84" rx="4" fill="url(#cbBar)" stroke="#232c33" stroke-width="1.5"/>`,
        )
        .join('') +
      // 가로 띠
      [12, 84]
        .map(
          (y) =>
            `<rect x="4" y="${y - 5}" width="88" height="10" rx="5" fill="url(#cbRail)" stroke="#232c33" stroke-width="1.5"/>`,
        )
        .join('') +
      // 리벳
      [14, 35, 61, 82]
        .flatMap((x) => [12, 84].map((y) => [x, y]))
        .map(
          ([x, y]) =>
            `<circle cx="${x}" cy="${y}" r="3.1" fill="#9fb0bc" stroke="#2a343b" stroke-width="1.2"/>` +
            `<circle cx="${x - 0.8}" cy="${y - 0.9}" r="1.1" fill="#e6f0f6" opacity="0.75"/>`,
        )
        .join('') +
      // 녹 얼룩 — 봉 위에서만 흘러내린다. 봉 밖으로 새면 배경에 묻은 얼룩처럼 보인다.
      `<clipPath id="cbClip">` +
      [14, 35, 61, 82]
        .map((x) => `<rect x="${x - 4}" y="6" width="8" height="84" rx="4"/>`)
        .join('') +
      `</clipPath>` +
      `<g clip-path="url(#cbClip)">` +
      [14, 35, 61, 82]
        .map(
          (x, n) =>
            `<path d="M${x + 1} ${24 + n * 9} q-3 ${18 + n * 5} 0 ${34 + n * 6}" stroke="#8a4a1e" stroke-width="4" fill="none" opacity="0.34" stroke-linecap="round"/>`,
        )
        .join('') +
      `</g>`,
  ),
};

/** 각 부위의 관절 좌표 (viewBox 기준). rescueScene.ts 가 이 값으로 회전축을 잡는다. */
const PIVOTS = {
  // 머리는 목에서 돌아야 한다. 머리 한가운데를 축으로 잡으면 고개가 미끄러진다.
  // 얼굴·창은 헬멧과 **같은 축**이어야 고개를 돌릴 때 눈이 창 밖으로 새지 않는다.
  'eel-head': [10, 60],
  'eel-jaw': [10, 8],
};

/**
 * 태그 짝 검사.
 *
 * 문자열을 이어붙여 SVG 를 만들면 `</g>` 하나가 빠져도 파일은 그냥 써진다.
 * 브라우저는 그런 SVG 를 통째로 로드 실패로 처리하는데, <img> 의 onerror 는
 * 조용히 지나가서 "그 부위만 안 보이는" 형태로만 드러난다. 여기서 미리 잡는다.
 */
function checkTags(name, svgText) {
  const stack = [];
  for (const m of svgText.matchAll(/<\/?([a-zA-Z]+)[^>]*?>/g)) {
    const [whole, tag] = m;
    if (whole.startsWith('</')) {
      const open = stack.pop();
      if (open !== tag) throw new Error(`${name}: </${tag}> 인데 열린 건 <${open ?? '없음'}>`);
    } else if (!whole.endsWith('/>')) {
      stack.push(tag);
    }
  }
  if (stack.length) throw new Error(`${name}: 안 닫힌 태그 ${stack.join(', ')}`);
}

mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(sprites)) {
  checkTags(name, content);
  writeFileSync(resolve(OUT, `${name}.svg`), content, 'utf8');
}
writeFileSync(resolve(OUT, 'pivots.json'), `${JSON.stringify(PIVOTS, null, 2)}\n`, 'utf8');
console.log(`wrote ${Object.keys(sprites).length} sprites + pivots.json to ${OUT}`);
