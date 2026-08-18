// 큰 WAV 를 게임에 실을 크기로 굽는 개발 하네스.  /dev-audio.html 로 연다.
//
// Freesound 원본은 34MB · 54MB 짜리 스테레오 48kHz WAV 다. 그대로는 못 싣는다.
// ffmpeg 이 없으므로 브라우저로 처리한다: 디코드 → 구간 자르기 → 모노 → 낮은
// 샘플레이트로 리샘플 → 앞뒤 크로스페이드(루프 이음매 제거) → 16bit PCM WAV.
//
// 낮은 샘플레이트가 문제되지 않는 이유: 수중 앰비언트·물 흐름은 저역이 대부분이라
// 11kHz(나이키스트 5.5kHz)로도 귀에 차이가 거의 없다. 대신 용량이 1/8 로 준다.
//
// 빌드 대상 아님.

interface Job {
  src: string;
  out: string;
  /** 잘라낼 시작 지점(초) */
  from: number;
  /** 길이(초) */
  length: number;
  /** 출력 샘플레이트 */
  rate: number;
  /** 루프용 크로스페이드 길이(초). 0 이면 원샷. */
  crossfade: number;
  gain: number;
}

const JOBS: Job[] = [
  {
    src: '504641__fission9__underwater-ambience.wav',
    out: 'ambience',
    from: 12,
    length: 8,
    rate: 11025,
    crossfade: 1.2,
    gain: 0.9,
  },
  {
    src: '852478__kolbyrfx__watrundwtr_underwater-bubble-flow-loop_kolbyr_free-sounds.wav',
    out: 'flow',
    from: 3,
    length: 4,
    rate: 16000,
    crossfade: 0.6,
    gain: 1,
  },
  {
    src: '539823__ristooooo1__bubbles-001.wav',
    out: 'bubble',
    from: 0.05,
    length: 1.2,
    rate: 22050,
    crossfade: 0,
    gain: 1,
  },
];

const log = document.getElementById('log')!;

/** Float 샘플 배열을 16bit PCM WAV 바이트로 */
function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function run(): Promise<void> {
  const lines: string[] = [];
  for (const job of JOBS) {
    const res = await fetch(`/src/assets/${job.src}`);
    const raw = await res.arrayBuffer();
    const ac = new AudioContext();
    const decoded = await ac.decodeAudioData(raw);
    await ac.close();

    // 자를 구간을 원본 레이트에서 먼저 확보한다
    const from = Math.min(job.from, Math.max(0, decoded.duration - job.length));
    const frames = Math.floor(job.length * job.rate);

    // OfflineAudioContext 의 목표 레이트가 곧 리샘플러다
    const off = new OfflineAudioContext(1, frames, job.rate);
    const source = off.createBufferSource();
    source.buffer = decoded;
    const amp = off.createGain();
    amp.gain.value = job.gain;
    source.connect(amp).connect(off.destination);
    source.start(0, from, job.length);
    const rendered = await off.startRendering();

    const data = rendered.getChannelData(0).slice();
    // 루프 이음매 — 끝부분을 앞부분에 겹쳐 넣어 딸깍 소리를 없앤다
    if (job.crossfade > 0) {
      const fade = Math.floor(job.crossfade * job.rate);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[i] = data[i] * t + data[data.length - fade + i] * (1 - t);
      }
    }
    const blob = encodeWav(job.crossfade > 0 ? data.slice(0, data.length - Math.floor(job.crossfade * job.rate)) : data, job.rate);
    const b64 = await new Promise<string>((r) => {
      const f = new FileReader();
      f.onload = () => r(String(f.result).split(',')[1]);
      f.readAsDataURL(blob);
    });
    await fetch(`http://localhost:5199/?name=aud_${job.out}`, { method: 'POST', body: b64 });
    lines.push(`${job.out}: ${Math.round(blob.size / 1024)}KB @${job.rate}Hz`);
    log.textContent = lines.join(' | ');
  }
  (window as unknown as { audioDone: boolean }).audioDone = true;
}

void run();
