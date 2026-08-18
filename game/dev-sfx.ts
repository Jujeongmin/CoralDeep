// 사운드 고르기 하네스.  /dev-sfx.html 로 연다.
//
// 내가 소리를 들을 수 없으니 후보를 한 화면에 늘어놓고 직접 고르게 한다.
// 매치음은 연쇄가 깊어질수록 음이 올라가야 하므로, 한 샘플을 재생 속도로 올려
// 6단계까지 이어 들려준다 (실제 게임과 같은 방식).
//
// 빌드 대상 아님.

const AUDITION: { title: string; note: string; files: string[]; combo: boolean }[] = [
  {
    title: '매치음 후보',
    note: '지금 쓰던 pepSound1 은 lose 로 옮겼습니다',
    combo: true,
    files: [
      'cand-impactGlass_light_000',
      'cand-impactGlass_light_002',
      'cand-impactBell_heavy_000',
      'cand-glass_001',
      'cand-bong_001',
      'cand-drop_003',
      'cand-chip-lay-2',
      'cand-chips-collide-1',
      'cand-confirmation_001',
      'cand-minimize_001',
      'cand-highUp',
      'cand-lowRandom',
      'cand-impactMining_000',
      'cand-dice-grab-1',
    ],
  },
  {
    title: '지금 들어가 있는 소리',
    note: '현재 볼륨 그대로 재생합니다',
    combo: false,
    files: ['tap', 'swap', 'invalid', 'special', 'break', 'coin', 'star', 'win', 'lose'],
  },
];

/** 지금 게임에 걸려 있는 볼륨 (audio.ts 와 같게 유지) */
const VOLUME: Record<string, number> = {
  tap: 0.5,
  swap: 0.55,
  invalid: 0.3,
  break: 0.7,
  special: 0.6,
  win: 0.45,
  lose: 0.55,
};

const ac = new AudioContext();
const cache = new Map<string, AudioBuffer>();

async function buffer(name: string): Promise<AudioBuffer | null> {
  if (cache.has(name)) return cache.get(name)!;
  const ext = ['ambience', 'flow', 'bubble'].includes(name) ? 'wav' : name === 'growl' ? 'mp3' : 'ogg';
  try {
    const res = await fetch(`/src/assets/audio/${name}.${ext}`);
    const buf = await ac.decodeAudioData(await res.arrayBuffer());
    cache.set(name, buf);
    return buf;
  } catch {
    return null;
  }
}

async function play(name: string, rate = 1, gain?: number): Promise<void> {
  if (ac.state === 'suspended') await ac.resume();
  const buf = await buffer(name);
  if (!buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const amp = ac.createGain();
  amp.gain.value = gain ?? VOLUME[name] ?? 0.7;
  src.connect(amp).connect(ac.destination);
  src.start();
}

const host = document.getElementById('host')!;

for (const group of AUDITION) {
  const title = document.createElement('h2');
  title.textContent = group.title;
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = group.note;
  const row = document.createElement('div');
  row.className = 'row';

  for (const file of group.files) {
    const label = file.replace(/^cand-/, '');
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = label;
    btn.addEventListener('click', () => void play(file, 1, 0.6));
    row.append(btn);

    if (group.combo) {
      const chain = document.createElement('button');
      chain.className = 'btn btn-secondary';
      chain.textContent = '연쇄';
      chain.addEventListener('click', () => {
        // 실제 게임의 콤보 사다리와 같은 비율
        [0, 1, 2, 3, 4, 5].forEach((n) => {
          window.setTimeout(() => void play(file, 1 + n * 0.12, 0.6), n * 190);
        });
      });
      row.append(chain);
    }
  }

  host.append(title, note, row);
}
