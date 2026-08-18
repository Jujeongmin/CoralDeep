// 보드 타일·장애물 에셋 생성기.  실행: node tools/make-tiles.mjs
//
// 캔버스에 도형을 직접 그리면 아무리 색을 잘 써도 '단색 도형'으로 보인다.
// 그래서 SVG 필터(내부 그림자 · 스페큘러 · 드롭섀도)로 입체감을 굽고,
// 게임에서는 그걸 한 번만 래스터화해서 캐시한다 (매 프레임 필터 비용 없음).
//
// 모두 128x128 viewBox, 실제 표시 크기의 2배 이상으로 래스터화된다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../game/src/assets/tiles');

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${body}</svg>\n`;

/** 공통 필터: 바닥 그림자 + 안쪽 음영 + 위쪽 스페큘러 */
const filters = (id, { blur = 3, dy = 3, spread = 0.55 } = {}) => `
<filter id="sh${id}" x="-30%" y="-30%" width="160%" height="170%">
  <feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="#04141f" flood-opacity="${spread}"/>
</filter>

<!-- 위쪽 베벨: 빛을 받는 면 -->
<filter id="in${id}" x="-20%" y="-20%" width="140%" height="140%">
  <feOffset dx="-2" dy="-7" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="4" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="inner"/>
  <feFlood flood-color="#ffffff" flood-opacity="0.9"/>
  <feComposite in2="inner" operator="in"/>
</filter>
<!-- 아래쪽 그늘 -->
<filter id="ao${id}" x="-20%" y="-20%" width="140%" height="140%">
  <feOffset dx="2" dy="8" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="7" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="inner"/>
  <feFlood flood-color="#000814" flood-opacity="0.62"/>
  <feComposite in2="inner" operator="in"/>
</filter>
<!-- 바닥 반사광(림라이트): 이게 있어야 물속에 떠 있는 입체로 보인다 -->
<filter id="rim${id}" x="-20%" y="-20%" width="140%" height="140%">
  <feOffset dx="0" dy="11" in="SourceAlpha" result="o"/>
  <feGaussianBlur in="o" stdDeviation="2.5" result="b"/>
  <feComposite in="SourceAlpha" in2="b" operator="out" result="inner"/>
  <feFlood flood-color="#9fe8ff" flood-opacity="0.5"/>
  <feComposite in2="inner" operator="in"/>
</filter>`;

/**
 * 위쪽 유광 하이라이트 + 작고 단단한 스페큘러 점.
 * 넓은 하이라이트만으로는 작게 줄였을 때 뭉개진다. 점 하나가 있어야 광택으로 읽힌다.
 */
const gloss = (cx, cy, rx, ry, rot = -20, op = 0.85) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#glossG)" opacity="${op}" transform="rotate(${rot} ${cx} ${cy})"/>` +
  `<ellipse cx="${cx - rx * 0.25}" cy="${cy - ry * 0.3}" rx="${(rx * 0.34).toFixed(1)}" ry="${(ry * 0.42).toFixed(1)}" fill="#ffffff" opacity="0.95" transform="rotate(${rot} ${cx} ${cy})"/>`;

const GLOSS_DEF = `
<radialGradient id="glossG" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
  <stop offset="0.55" stop-color="#ffffff" stop-opacity="0.35"/>
  <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>`;

/**
 * 타일 한 장.
 * @param id      필터 id 접두사
 * @param shape   본체 path/도형 (fill 은 url(#bodyId) 로 참조)
 * @param stops   본체 그라디언트 색 [밝은 위, 중간, 어두운 아래]
 * @param detail  표면 디테일 (본체 위에 올릴 요소들)
 */
const tile = (id, shape, stops, detail = '') =>
  svg(`<defs>
${filters(id)}
${GLOSS_DEF}
<linearGradient id="body${id}" x1="0.2" y1="-0.05" x2="0.8" y2="1.05">
  <stop offset="0" stop-color="${stops[0]}"/>
  <stop offset="0.34" stop-color="${stops[1]}"/>
  <stop offset="1" stop-color="${stops[2]}"/>
</linearGradient>
<clipPath id="clip${id}">${shape.replace('FILL', 'none')}</clipPath>
</defs>
<g filter="url(#sh${id})">
  ${shape.replace('FILL', `url(#body${id})`)}
</g>
<g clip-path="url(#clip${id})">
  ${detail}
  <g filter="url(#ao${id})">${shape.replace('FILL', '#000')}</g>
  <g filter="url(#rim${id})">${shape.replace('FILL', '#000')}</g>
  <g filter="url(#in${id})">${shape.replace('FILL', '#000')}</g>
</g>
<!-- 어두운 외곽선: 물 위에서도 타일이 또렷하게 떨어져 보인다 -->
${shape.replace('FILL', 'none').replace('/>', ' stroke="#05161f" stroke-opacity="0.55" stroke-width="4"/>')}`);

// ---- 표면 디테일 조각 ----

/** 산호 표면의 구멍들 */
const pores = () => {
  let out = '';
  for (let n = 0; n < 16; n++) {
    const a = n * 2.399;
    const r = 10 + (n % 5) * 7;
    const x = (64 + Math.cos(a) * r).toFixed(1);
    const y = (66 + Math.sin(a) * r * 0.9).toFixed(1);
    const rr = (2.2 + (n % 3) * 0.9).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="${rr}" fill="#000" opacity="0.16"/>`;
    out += `<circle cx="${x}" cy="${(Number(y) - 1.2).toFixed(1)}" r="${rr}" fill="#fff" opacity="0.12"/>`;
  }
  return out;
};

/** 해초 잎맥 */
const veins = () => {
  let out = '';
  for (let n = -2; n <= 2; n++) {
    out += `<path d="M64 22 q${n * 13} 40 ${n * 17} 84" stroke="#0b3d24" stroke-width="2.4" fill="none" opacity="0.28"/>`;
    out += `<path d="M64 20 q${n * 13} 40 ${n * 17} 84" stroke="#a8f0c8" stroke-width="1.2" fill="none" opacity="0.3"/>`;
  }
  return out;
};

/**
 * 가리비 방사 늑골.
 *
 * 직선 몇 줄이면 부채 접힌 자국이지 조개가 아니다. 늑골은 부풀어 있어서
 * 한쪽에 그늘, 반대쪽에 빛이 걸리고, 그 위를 성장선이 가로지른다.
 */
const ridges = () => {
  let out = '';
  for (let n = -4; n <= 4; n++) {
    const x = 64 + n * 12;
    // 늑골 하나 = 어두운 골 + 밝은 마루
    out += `<path d="M64 106Q${64 + n * 6} 60 ${x + 3} 26" stroke="#8a5f0a" stroke-width="5" fill="none" opacity="0.26"/>`;
    out += `<path d="M64 106Q${64 + n * 6} 60 ${x - 1} 26" stroke="#fff3c4" stroke-width="2.2" fill="none" opacity="0.34"/>`;
  }
  // 성장선 — 늑골을 가로지르는 동심 호
  for (const r of [34, 52, 68]) {
    out += `<path d="M${64 - r * 0.95} ${104 - r * 0.5}Q64 ${104 - r * 1.15} ${64 + r * 0.95} ${104 - r * 0.5}" stroke="#8a5f0a" stroke-width="1.6" fill="none" opacity="0.22"/>`;
  }
  // 경첩 쪽 귀
  out += `<path d="M46 32q18 -8 36 0l-4 -8q-14 -5 -28 0Z" fill="#e0b03a" opacity="0.5"/>`;
  out += `<ellipse cx="86" cy="82" rx="26" ry="20" fill="#7a5208" opacity="0.2" transform="rotate(-25 86 82)"/>`;
  return out;
};

/**
 * 해파리 — 젤리처럼 속이 비쳐야 한다.
 * 종 안쪽에 방사관이 지나가고, 그 아래로 촉수가 어른거린다.
 */
const jellyInner = () => {
  let out =
    // 종 안쪽 공동
    `<ellipse cx="64" cy="70" rx="32" ry="24" fill="#ffffff" opacity="0.12"/>` +
    `<ellipse cx="60" cy="58" rx="22" ry="15" fill="#ffe4ff" opacity="0.28"/>`;
  // 방사관 — 종 꼭대기에서 가장자리로 뻗는다
  for (let n = -3; n <= 3; n++) {
    out += `<path d="M64 40Q${64 + n * 9} 62 ${64 + n * 15} 88" stroke="#f0c8ff" stroke-width="2.4" fill="none" opacity="0.35"/>`;
  }
  // 종 가장자리의 두꺼운 테
  out += `<path d="M28 78q36 22 72 0" stroke="#ffffff" stroke-width="3.5" fill="none" opacity="0.3"/>`;
  // 아래로 늘어진 촉수
  for (let n = -2; n <= 2; n++) {
    out += `<path d="M${64 + n * 13} 96q${n * 4} 14 ${n * 2} 26" stroke="#e6b6ff" stroke-width="2.2" fill="none" opacity="0.4" stroke-linecap="round"/>`;
  }
  out += `<ellipse cx="86" cy="80" rx="24" ry="18" fill="#3d1266" opacity="0.2" transform="rotate(-25 86 80)"/>`;
  return out;
};

/** 진주 무지갯빛 */
const iridescent = () =>
  `<ellipse cx="52" cy="52" rx="30" ry="24" fill="#bfe9ff" opacity="0.45" transform="rotate(-25 52 52)"/>
   <ellipse cx="80" cy="80" rx="26" ry="18" fill="#ffd7f2" opacity="0.35" transform="rotate(-25 80 80)"/>
   <ellipse cx="70" cy="40" rx="20" ry="10" fill="#d9ffe9" opacity="0.3" transform="rotate(-15 70 40)"/>`;

/** 물방울 굴절 링 */
const refraction = () =>
  `<circle cx="64" cy="66" r="40" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.22"/>
   <circle cx="64" cy="66" r="30" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.16"/>
   <ellipse cx="64" cy="98" rx="22" ry="9" fill="#ffffff" opacity="0.18"/>`;

// ---- 도형 ----

// 육각형·원·마름모는 어느 매치3 에나 있는 보석 모양이다. 심해 물건으로 바꾼다.
// 판이 9칸으로 넓어져 타일이 작아졌으므로 **실루엣만으로 구분**돼야 한다:
// 가시 / 매끈한 원 / 술 달린 돔 / 부채 / 종 / 소라 — 겹치는 윤곽이 없다.

/** 성게 — 가시가 돋은 별 모양. 윤곽이 제일 시끄러워서 눈에 먼저 띈다. */
const urchin = (() => {
  const pts = [];
  const spikes = 13;
  for (let n = 0; n < spikes * 2; n++) {
    const a = (Math.PI * n) / spikes - Math.PI / 2;
    const r = n % 2 === 0 ? 52 : 31;
    pts.push(`${(64 + Math.cos(a) * r).toFixed(1)},${(66 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="FILL"/>`;
})();

/** 유리 부표 — 그물에 싸인 구슬. 유일한 매끈한 원이라 대비가 된다. */
const floatBall = '<circle cx="64" cy="66" r="46" fill="FILL"/>';

/**
 * 관산호 폴립 덩어리 — 대롱이 다발로 붙어 위로 자란다.
 *
 * 처음엔 말미잘 촉수를 노렸는데, **채워진 실루엣으로는 촉수가 안 된다**.
 * 촉수는 가닥 사이가 뚫려 있어야 촉수인데 단일 path 로는 그 틈을 못 만든다.
 * 대롱 끝이 제각각인 이 모양은 관산호로 읽으면 정확하고, 게임 제목과도 맞는다.
 */
const polypCluster =
  '<path d="M18 92 q0 -26 12 -38 q9 -9 13 3 q3 -20 12 -8 q5 -22 15 -6 q6 -20 15 -4 q6 -14 13 4 q6 -10 12 4 q10 13 10 45 q-51 22 -102 0Z" fill="FILL"/>';

/** 가리비 — 부채꼴 조개 */
const scallop =
  '<path d="M64 110 A50 50 0 0 1 22 46 L64 30 L106 46 A50 50 0 0 1 64 110Z" fill="FILL"/>';

/** 해파리 — 종 아래로 촉수가 늘어진다 */
const jellyfish =
  '<path d="M16 74 a48 46 0 0 1 96 0 q0 18 -14 24 q-10 -12 -20 0 q-12 -12 -24 0 q-12 -12 -24 0 q-14 -6 -14 -24Z" fill="FILL"/>';

/** 소라 — 뾰족한 첨탑과 부푼 몸통. 좌우 비대칭이라 다른 것과 안 겹친다. */
const conch =
  '<path d="M96 18 q14 26 6 54 q-8 30 -34 38 q-28 8 -44 -10 q-14 -16 -2 -32 q8 -11 22 -10 q-8 -12 2 -20 q10 -8 22 -2 q-4 -14 8 -20 q12 -6 20 2Z" fill="FILL"/>';

// ---- 새 실루엣에 맞춘 표면 디테일 ----

/**
 * 성게 — 가시가 뻗어나간 결 + 껍질 돌기.
 *
 * 표면 디테일은 **중간톤**에 얹어야 보인다. 하이라이트 위에 겹치면 흰색에 묻히고,
 * 그늘 위에 겹치면 검정에 묻힌다. 그리고 형태는 밝은 면·어두운 면·단단한 점 하나로
 * 만들어진다 — 이 규칙을 여섯 타일에 똑같이 적용했다.
 */
const urchinBumps = () => {
  let out = '';
  // 가시 뿌리에서 뻗는 결 — 가시가 왜 거기 있는지 설명해준다
  for (let n = 0; n < 13; n++) {
    const a = (Math.PI * 2 * n) / 13 - Math.PI / 2;
    const x1 = (64 + Math.cos(a) * 12).toFixed(1);
    const y1 = (66 + Math.sin(a) * 12).toFixed(1);
    const x2 = (64 + Math.cos(a) * 46).toFixed(1);
    const y2 = (66 + Math.sin(a) * 46).toFixed(1);
    out += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#5c1109" stroke-width="4" opacity="0.28" stroke-linecap="round"/>`;
    out += `<path d="M${(Number(x1) - 1.4).toFixed(1)} ${(Number(y1) - 1.4).toFixed(1)}L${(Number(x2) - 1.4).toFixed(1)} ${(Number(y2) - 1.4).toFixed(1)}" stroke="#ffd0c2" stroke-width="1.6" opacity="0.3" stroke-linecap="round"/>`;
  }
  // 껍질 돌기
  for (let n = 0; n < 20; n++) {
    const a = n * 2.399;
    const r = 7 + (n % 5) * 4.5;
    const x = 64 + Math.cos(a) * r;
    const y = 66 + Math.sin(a) * r;
    out += `<circle cx="${x.toFixed(1)}" cy="${(y + 1).toFixed(1)}" r="2.8" fill="#5c1109" opacity="0.26"/>`;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.3" fill="#ffd9cc" opacity="0.4"/>`;
  }
  // 그늘 쪽 (오른쪽 아래)
  out += `<ellipse cx="84" cy="88" rx="34" ry="28" fill="#4a0d07" opacity="0.22" transform="rotate(-30 84 88)"/>`;
  return out;
};

/** 부표를 감싼 밧줄 그물 */
const netWrap = () => {
  let out =
    // 유리 안쪽 — 반대편 벽이 비쳐 보인다
    `<ellipse cx="64" cy="82" rx="30" ry="18" fill="#ffffff" opacity="0.14"/>` +
    `<ellipse cx="80" cy="86" rx="20" ry="12" fill="#bff0ff" opacity="0.2" transform="rotate(-20 80 86)"/>`;
  // 밧줄 — 어두운 심 위에 밝은 꼬임
  const cols = [-2, -1, 0, 1, 2];
  for (const n of cols) {
    const d = `M${64 + n * 22} 20 q${-n * 8} 46 0 92`;
    out += `<path d="${d}" stroke="#3a2c12" stroke-width="4.4" fill="none" opacity="0.45"/>`;
    out += `<path d="${d}" stroke="#d9c48a" stroke-width="2" fill="none" opacity="0.5"/>`;
  }
  for (const y of [40, 66, 92]) {
    const d = `M18 ${y} q46 ${y < 66 ? 10 : -10} 92 0`;
    out += `<path d="${d}" stroke="#3a2c12" stroke-width="4.4" fill="none" opacity="0.45"/>`;
    out += `<path d="${d}" stroke="#d9c48a" stroke-width="2" fill="none" opacity="0.5"/>`;
  }
  // 매듭 — 그물은 매듭이 있어야 그물이다
  for (const n of cols) {
    for (const y of [40, 66, 92]) {
      const x = 64 + n * 22 + (-n * 8) * ((y - 20) / 92) * 0.6;
      out += `<ellipse cx="${x.toFixed(1)}" cy="${y}" rx="4" ry="3" fill="#e6d3a0" stroke="#3a2c12" stroke-width="1.2" opacity="0.75"/>`;
    }
  }
  // 그늘 쪽
  out += `<ellipse cx="88" cy="88" rx="28" ry="22" fill="#062a45" opacity="0.22" transform="rotate(-25 88 88)"/>`;
  return out;
};

/**
 * 관산호 대롱.
 *
 * 결을 세로줄로만 그으면 푸딩 틀의 주름이 된다. 대롱으로 읽히려면
 * (1) 대롱 사이가 **어두운 골**로 갈라지고 (2) 끝에 **뚫린 입**이 있어야 한다.
 */
const polyps = () => {
  const tips = [
    [30, 56],
    [43, 44],
    [55, 34],
    [70, 32],
    [84, 40],
    [97, 52],
  ];
  let out = '';
  // 대롱 사이 골 — 어두운 쪽을 먼저 깔아야 갈라진 게 보인다
  for (let n = 0; n < tips.length - 1; n++) {
    const x = (tips[n][0] + tips[n + 1][0]) / 2;
    const y = (tips[n][1] + tips[n + 1][1]) / 2;
    out += `<path d="M${x} ${y} L${64 + (x - 64) * 1.5} 104" stroke="#06381f" stroke-width="5" opacity="0.42" stroke-linecap="round"/>`;
  }
  // 대롱 몸통의 밝은 면
  for (const [x, y] of tips) {
    out += `<path d="M${x} ${y} L${64 + (x - 64) * 1.4} 102" stroke="#bdffd9" stroke-width="3" opacity="0.26" stroke-linecap="round"/>`;
  }
  // 뚫린 입 — 가장자리는 밝고 안은 어둡다
  for (const [x, y] of tips) {
    out += `<ellipse cx="${x}" cy="${y + 3}" rx="6.5" ry="3.6" fill="#d9fff0" opacity="0.5"/>`;
    out += `<ellipse cx="${x}" cy="${y + 3.4}" rx="4" ry="2.1" fill="#04301a" opacity="0.55"/>`;
  }
  return out;
};

/** 소라 나선 */
const spiral = () => {
  let out = '';
  // 나선 능선 — 안쪽으로 갈수록 촘촘해진다
  for (let n = 0; n < 5; n++) {
    const r = 36 - n * 7;
    const sx = 78 - n * 5;
    const sy = 26 + n * 7;
    out += `<path d="M${sx} ${sy} a${r} ${r * 0.82} 0 1 1 ${-r * 0.62} ${r * 1.22}" stroke="#8d6a3a" stroke-width="3.4" fill="none" opacity="0.3"/>`;
    out += `<path d="M${sx} ${sy - 2} a${r} ${r * 0.82} 0 1 1 ${-r * 0.62} ${r * 1.22}" stroke="#fff6e6" stroke-width="1.5" fill="none" opacity="0.4"/>`;
  }
  // 줄무늬 — 나선을 가로지른다
  for (let n = 0; n < 7; n++) {
    const a = -0.9 + n * 0.42;
    const x1 = (64 + Math.cos(a) * 16).toFixed(1);
    const y1 = (58 + Math.sin(a) * 16).toFixed(1);
    const x2 = (64 + Math.cos(a) * 44).toFixed(1);
    const y2 = (58 + Math.sin(a) * 44).toFixed(1);
    out += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#a8794a" stroke-width="3" opacity="0.2" stroke-linecap="round"/>`;
  }
  // 입 — 아래쪽으로 벌어진 구멍. 이게 있어야 속이 빈 껍데기로 읽힌다.
  out += `<path d="M40 84q14 -10 28 2q-6 18 -22 20q-12 -6 -6 -22Z" fill="#6b4a24" opacity="0.45"/>`;
  out += `<path d="M43 86q12 -8 23 2" stroke="#fff6e6" stroke-width="2.4" fill="none" opacity="0.45" stroke-linecap="round"/>`;
  out += `<ellipse cx="92" cy="80" rx="24" ry="20" fill="#5c4222" opacity="0.18" transform="rotate(-25 92 80)"/>`;
  return out;
};

const tiles = {
  'tile-0': tile('c0', urchin, ['#ff9d8c', '#ef5f4a', '#a8281a'], urchinBumps()),
  'tile-1': tile('c1', floatBall, ['#a5ecff', '#43c3f0', '#1466a0'], netWrap()),
  'tile-2': tile('c2', polypCluster, ['#9df5c0', '#42d183', '#137a45'], polyps()),
  'tile-3': tile('c3', scallop, ['#ffe9a3', '#ffc53d', '#a87206'], ridges()),
  'tile-4': tile('c4', jellyfish, ['#e2b6ff', '#b473ee', '#5f2a9c'], jellyInner()),
  'tile-5': tile('c5', conch, ['#ffffff', '#f0e0c8', '#a88f6a'], spiral()),
};

// ---- 장애물 ----

/** 울퉁불퉁한 바위 실루엣 */
const rockShape = (seed) => {
  const pts = [];
  for (let n = 0; n < 11; n++) {
    const a = (Math.PI * 2 * n) / 11;
    const r = 46 + Math.sin(seed + n * 2.7) * 7;
    pts.push(`${(64 + Math.cos(a) * r).toFixed(1)},${(64 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="FILL"/>`;
};

/** 바위 표면 결정·균열 */
const rockDetail = (seed) => {
  let out = '';
  for (let n = 0; n < 26; n++) {
    const a = n * 2.399 + seed;
    const r = 6 + (n % 6) * 7;
    const x = (64 + Math.cos(a) * r).toFixed(1);
    const y = (64 + Math.sin(a) * r).toFixed(1);
    const rr = (1.6 + (n % 4)).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="${rr}" fill="#0f1720" opacity="0.28"/>`;
    out += `<circle cx="${x}" cy="${(Number(y) - 1).toFixed(1)}" r="${rr}" fill="#c8d6e2" opacity="0.16"/>`;
  }
  // 균열
  out += `<path d="M30 46 L58 62 L48 92" stroke="#0b1219" stroke-width="3" fill="none" opacity="0.35"/>`;
  out += `<path d="M96 42 L74 66 L88 96" stroke="#0b1219" stroke-width="2.5" fill="none" opacity="0.3"/>`;
  return out;
};

/** 바위 위에 자란 산호 */
const coralGrowth = () =>
  `<g opacity="0.95">
    <path d="M40 34 q-8 -16 2 -24 q8 -6 12 4 q6 -12 14 -4 q8 8 -2 22Z" fill="#ff7fa8"/>
    <path d="M84 40 q-4 -14 6 -20 q9 -5 11 6 q4 -8 10 -1 q6 8 -3 17Z" fill="#ffab5e"/>
    <path d="M44 30 v-10 M52 28 v-12 M60 30 v-9" stroke="#ffd2e2" stroke-width="2.5" opacity="0.6"/>
  </g>`;

/** 바위 면 분할 — 빛을 받는 면과 그늘진 면을 나눠 칠하면 덩어리로 읽힌다 */
const facets = (seed) => {
  const pt = (n, r) => {
    const a = (Math.PI * 2 * n) / 11;
    return `${(64 + Math.cos(a) * r).toFixed(1)},${(64 + Math.sin(a) * r).toFixed(1)}`;
  };
  const light = [pt(7 + seed * 0, 44), pt(9, 40), '64,64', pt(5, 42)].join(' ');
  const dark = [pt(1, 44), pt(3, 46), '64,64', pt(2, 40)].join(' ');
  return (
    `<polygon points="${light}" fill="#ffffff" opacity="0.13"/>` +
    `<polygon points="${dark}" fill="#000814" opacity="0.22"/>`
  );
};

/**
 * 장면용 바위 덩어리.
 * 조명 방향은 보드 타일과 같게 유지하되(화면이 따로 놀지 않게), 광택은 죽인다 —
 * 바위가 젤리처럼 번들거리면 안 된다.
 */
const boulder = (n, stops, withCoral) =>
  tile(
    `b${n}`,
    rockShape(n * 1.7 + 0.6),
    stops,
    facets(n) + rockDetail(n * 1.7 + 0.6) + (withCoral ? coralGrowth() : ''),
  )
    .replace('flood-opacity="0.9"', 'flood-opacity="0.42"') // 위쪽 베벨 약하게
    .replace('flood-color="#9fe8ff" flood-opacity="0.5"', 'flood-color="#7fc4dd" flood-opacity="0.22"'); // 림라이트 약하게

const blockers = {
  'rock-1': tile('r1', rockShape(1.3), ['#8fa0b0', '#5d6b7a', '#2b3540'], rockDetail(1.3)),
  'rock-2': tile(
    'r2',
    rockShape(4.1),
    ['#7d8d9c', '#4a5764', '#212a33'],
    rockDetail(4.1) + coralGrowth(),
  ),
  // 심해 암석. 보드 타일보다 어두워야 배경으로 물러나고 타일이 앞으로 나온다.
  'boulder-1': boulder(1, ['#6b7b8b', '#3f4b58', '#18202a'], false),
  'boulder-2': boulder(2, ['#5d6d7c', '#374350', '#141b24'], true),
  'boulder-3': boulder(3, ['#748493', '#45525f', '#1b232d'], false),
  'boulder-4': boulder(4, ['#556372', '#313d49', '#111820'], true),
  ice: svg(`<defs>
${filters('ic', { blur: 2, dy: 2, spread: 0.35 })}
${GLOSS_DEF}
<linearGradient id="bodyic" x1="0.2" y1="0" x2="0.8" y2="1">
  <stop offset="0" stop-color="#f2fdff" stop-opacity="0.92"/>
  <stop offset="0.5" stop-color="#b6e9fb" stop-opacity="0.8"/>
  <stop offset="1" stop-color="#63b8dc" stop-opacity="0.85"/>
</linearGradient>
</defs>
<g filter="url(#shic)">
  <rect x="8" y="8" width="112" height="112" rx="16" fill="url(#bodyic)"/>
</g>
<g clip-path="url(#clipic)">
  <path d="M20 30 L58 60 L26 96" stroke="#ffffff" stroke-width="4" fill="none" opacity="0.6"/>
  <path d="M104 26 L70 62 L100 100" stroke="#ffffff" stroke-width="3.5" fill="none" opacity="0.5"/>
  <path d="M64 12 L64 40 M64 88 L64 116" stroke="#ffffff" stroke-width="3" opacity="0.35"/>
</g>
<rect x="8" y="8" width="112" height="112" rx="16" fill="none" stroke="#eafaff" stroke-width="3" opacity="0.7"/>
${gloss(44, 36, 26, 14, -25, 0.5)}`),
  net: svg(`<defs>
<linearGradient id="bodyn" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f6ecc8"/>
  <stop offset="1" stop-color="#b9a575"/>
</linearGradient>
<filter id="shn" x="-20%" y="-20%" width="140%" height="140%">
  <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/>
</filter>
</defs>
<g filter="url(#shn)" stroke="url(#bodyn)" stroke-width="7" stroke-linecap="round" fill="none">
  <path d="M32 4 V124 M64 4 V124 M96 4 V124"/>
  <path d="M4 32 H124 M4 64 H124 M4 96 H124"/>
</g>
<g fill="#8c7a4e">
  <circle cx="32" cy="32" r="5"/><circle cx="64" cy="32" r="5"/><circle cx="96" cy="32" r="5"/>
  <circle cx="32" cy="64" r="5"/><circle cx="64" cy="64" r="5"/><circle cx="96" cy="64" r="5"/>
  <circle cx="32" cy="96" r="5"/><circle cx="64" cy="96" r="5"/><circle cx="96" cy="96" r="5"/>
</g>
<g stroke="#fffbe8" stroke-width="2" opacity="0.45" fill="none">
  <path d="M29 4 V124 M61 4 V124 M93 4 V124"/>
</g>`),
};

// 유광 하이라이트를 각 타일 위에 얹는다 (본체 위, 디테일 위)
const withGloss = (content, cx, cy, rx, ry) =>
  content.replace('</svg>', `${gloss(cx, cy, rx, ry)}</svg>`);

const glossPos = {
  'tile-0': [48, 40, 22, 13],
  'tile-1': [48, 42, 24, 15],
  'tile-2': [44, 42, 24, 14],
  'tile-3': [56, 50, 22, 12],
  'tile-4': [48, 46, 24, 14],
  'tile-5': [56, 44, 22, 12],
  'rock-1': [46, 40, 20, 11],
  'rock-2': [46, 40, 18, 10],

};

mkdirSync(OUT, { recursive: true });
const all = { ...tiles, ...blockers };
for (const [name, content] of Object.entries(all)) {
  const g = glossPos[name];
  writeFileSync(resolve(OUT, `${name}.svg`), g ? withGloss(content, ...g) : content, 'utf8');
}
console.log(`wrote ${Object.keys(all).length} tile assets to ${OUT}`);
