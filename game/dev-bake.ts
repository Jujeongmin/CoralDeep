// Poly Haven 4k 디퓨즈를 게임에서 쓸 크기·색으로 굽는 개발 하네스.
//
// 원본은 낮에 찍은 사진이라 그대로 깔면 심해로 안 보인다.
// 여기서 축소 + 심해 색보정(어둡게, 청록으로, 대비 유지)까지 해서 한 번만 굽고,
// 결과 파일을 game/src/assets/textures/ 에 넣어 런타임에는 그냥 타일링만 한다.
//
// 빌드 대상 아님 (vite 엔트리는 index.html 뿐).
//
// 다시 구우려면:
//   1. assets-raw/*.blend.zip 안의 *_diff_4k.jpg 를 game/public/rawtex/ 로 꺼낸다
//   2. dev 서버에서 /dev-bake.html 을 연다
//   3. 결과가 로컬 수집 서버(5199)로 넘어오면 game/src/assets/textures/*.jpg 로 복사한다
//   4. game/public/rawtex 는 반드시 지운다 — public 은 dist 로 통째로 복사된다

interface Recipe {
  /** public/rawtex 안의 파일 이름 */
  src: string;
  /** 저장할 이름 */
  out: string;
  /** 출력 한 변 크기 */
  size: number;
  /** 곱할 색 (심해 필터) */
  tint: [number, number, number];
  /** 전체 밝기 */
  gain: number;
  /** 0 = 완전 흑백, 1 = 원본 채도 */
  sat: number;
  /** 중간톤 기준 대비 */
  contrast: number;
}

const RECIPES: Recipe[] = [
  // 보드를 둘러싼 자갈. 알갱이가 보여야 하므로 제일 크게.
  {
    src: 'coral_gravel_diff_4k.jpg',
    out: 'gravel',
    size: 1024,
    tint: [0.66, 0.84, 0.96],
    gain: 0.85,
    sat: 0.45,
    contrast: 1.3,
  },
  // 상단 장면 바위 / 바위 블로커.
  // dark_rock_02 는 원본이 이미 새까맣다. 감광하면 형태가 사라지므로 오히려 올려야 한다.
  {
    src: 'dark_rock_02_diff_4k.jpg',
    out: 'rock',
    size: 512,
    tint: [0.7, 0.86, 1.0],
    gain: 1.9,
    sat: 0.5,
    contrast: 1.25,
  },
  // 덩어리 바위
  {
    src: 'rock_boulder_cracked_diff_4k.jpg',
    out: 'boulder',
    size: 512,
    tint: [0.66, 0.84, 1.0],
    gain: 0.6,
    sat: 0.5,
    contrast: 1.18,
  },
  // 해저 모래 — 보드 바닥
  {
    src: 'coast_sand_05_diff_4k.jpg',
    out: 'sand',
    size: 512,
    tint: [0.55, 0.78, 0.92],
    gain: 0.42,
    sat: 0.4,
    contrast: 1.1,
  },
  // 산호 벽 — 약간의 따뜻함은 남긴다
  {
    src: 'coral_fort_wall_01_diff_4k.jpg',
    out: 'coral',
    size: 512,
    tint: [0.8, 0.92, 1.0],
    gain: 0.72,
    sat: 0.75,
    contrast: 1.12,
  },
];

const log = document.getElementById('log')!;

function grade(data: Uint8ClampedArray, r: Recipe): void {
  const [tr, tg, tb] = r.tint;
  for (let i = 0; i < data.length; i += 4) {
    let cr = data[i] / 255;
    let cg = data[i + 1] / 255;
    let cb = data[i + 2] / 255;

    // 채도 낮추기 (탁한 물속)
    const lum = cr * 0.299 + cg * 0.587 + cb * 0.114;
    cr = lum + (cr - lum) * r.sat;
    cg = lum + (cg - lum) * r.sat;
    cb = lum + (cb - lum) * r.sat;

    // 중간톤 기준 대비 — 밝기를 낮추면 뭉개지므로 먼저 살려둔다
    cr = 0.5 + (cr - 0.5) * r.contrast;
    cg = 0.5 + (cg - 0.5) * r.contrast;
    cb = 0.5 + (cb - 0.5) * r.contrast;

    // 심해 색 + 감광
    data[i] = Math.max(0, Math.min(255, cr * tr * r.gain * 255));
    data[i + 1] = Math.max(0, Math.min(255, cg * tg * r.gain * 255));
    data[i + 2] = Math.max(0, Math.min(255, cb * tb * r.gain * 255));
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${url}`));
    img.src = url;
  });
}

async function bake(): Promise<void> {
  const lines: string[] = [];
  for (const r of RECIPES) {
    const img = await load(`./rawtex/${r.src}`);
    const c = document.createElement('canvas');
    c.width = r.size;
    c.height = r.size;
    const ctx = c.getContext('2d')!;
    // 4k → 목표 크기. 한 번에 줄이면 앨리어싱이 생기므로 절반씩 내려간다.
    let cur: HTMLCanvasElement | HTMLImageElement = img;
    let w = img.naturalWidth;
    while (w / 2 >= r.size) {
      const half = document.createElement('canvas');
      half.width = w / 2;
      half.height = w / 2;
      const hx = half.getContext('2d')!;
      hx.imageSmoothingQuality = 'high';
      hx.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
      w = half.width;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, r.size, r.size);

    const id = ctx.getImageData(0, 0, r.size, r.size);
    grade(id.data, r);
    ctx.putImageData(id, 0, 0);

    document.body.append(c);
    const url = c.toDataURL('image/jpeg', 0.86);
    await fetch(`http://localhost:5199/?name=tex_${r.out}`, {
      method: 'POST',
      body: url.split(',')[1],
    });
    lines.push(`${r.out}: ${r.size}px ${Math.round((url.length * 0.75) / 1024)}KB`);
    log.textContent = lines.join(' | ');
  }
  (window as unknown as { bakeDone: boolean }).bakeDone = true;
}

void bake();
