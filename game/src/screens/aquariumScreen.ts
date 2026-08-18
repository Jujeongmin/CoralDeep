// 수족관 화면. 불가사리를 써서 구역을 하나씩 복원한다.

import { adButton, button, el, iconButton, toast } from '../ui.ts';
import { amount } from '../icons.ts';
import { t, tf } from '../i18n.ts';
import { getSave } from '../storage.ts';
import { addStars, spendStars } from '../economy.ts';
import { sfx } from '../audio.ts';
import { texturePattern } from '../textures.ts';
import { navigate } from '../router.ts';
import { createHud } from './hud.ts';
import {
  ALL_TASKS,
  completeTask,
  currentZone,
  nextTasks,
  placedDecor,
  progressPercent,
  type Decor,
  type Zone,
} from '../aquarium.ts';

export function renderAquarium(host: HTMLElement): void {
  const hud = createHud();
  const canvas = el('canvas', { class: 'aquarium-canvas' }) as HTMLCanvasElement;
  const taskList = el('div', { class: 'task-list' });

  const header = el(
    'header',
    { class: 'screen-head' },
    iconButton('back', () => navigate('map'), t('back')),
    el(
      'div',
      { class: 'brand' },
      el('h1', { text: t('aquarium') }),
      el('small', { class: 'aquarium-progress', text: tf('aquariumProgress', { n: progressPercent() }) }),
    ),
    hud.root,
  );

  host.append(
    header,
    el('main', { class: 'screen aquarium-screen' }, canvas, taskList),
  );

  const scene = new AquariumScene(canvas);

  const rebuild = (): void => {
    hud.refresh();
    scene.sync();
    const progressLabel = header.querySelector('.aquarium-progress');
    if (progressLabel) progressLabel.textContent = tf('aquariumProgress', { n: progressPercent() });

    taskList.replaceChildren();
    const tasks = nextTasks(3);
    if (tasks.length === 0) {
      taskList.append(el('p', { class: 'modal-note', text: t('allTasksDone') }));
      return;
    }

    const save = getSave();
    const lang = save.settings.lang;

    for (const task of tasks) {
      const affordable = save.stars >= task.cost;
      const row = el(
        'div',
        { class: `task-row ${affordable ? '' : 'locked'}` },
        el(
          'div',
          { class: 'task-info' },
          el('strong', { text: lang === 'en' ? task.en : task.ko }),
          el('small', {}, amount('starfish', task.cost, 14)),
        ),
        affordable
          ? button(t('repair'), () => {
              if (!spendStars(task.cost)) return;
              completeTask(task.id);
              sfx.star();
              toast(t('taskDone'));
              rebuild();
            }, { class: 'btn-primary' })
          : el('span', { class: 'task-need', text: tf('needStars', { n: task.cost - save.stars }) }),
      );
      taskList.append(row);
    }

    taskList.append(
      // [광고 지면] 불가사리 1개 — 복원이 막혔을 때 바로 뚫어주는 자리
      adButton('extra-star', t('extraStarTitle'), () => {
        addStars(1);
        sfx.star();
        toast(tf('starsEarned', { n: 1 }));
      }, { class: 'btn-wide', onDone: () => rebuild() }),
      button(t('play'), () => navigate('map'), { class: 'btn-secondary btn-wide' }),
    );
  };

  rebuild();

  host.addEventListener(
    'screen:destroy',
    () => {
      hud.destroy();
      scene.destroy();
    },
    { once: true },
  );
}

// ---------- 수조 그리기 ----------

class AquariumScene {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private time = 0;
  private last = 0;
  private decor: Decor[] = [];
  private zone: Zone;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.zone = currentZone();
    this.sync();
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
    this.last = performance.now();
    this.loop(this.last);
  }

  sync(): void {
    this.decor = placedDecor();
    this.zone = currentZone();
    this.resize();
  }

  private onResize = (): void => this.resize();

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, Math.floor(rect.width));
    this.h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.time += Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, this.zone.bg[0]);
    grad.addColorStop(1, this.zone.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 물빛 커스틱.
    // 큰 타원을 깔면 물빛이 아니라 뿌연 얼룩이 된다. 실제 커스틱은
    // **가늘고 구불거리는 밝은 줄**이 천장 가까이에서 흔들리는 것이다.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(180, 235, 255, 0.1)';
    ctx.lineCap = 'round';
    for (let n = 0; n < 7; n++) {
      const phase = this.time * 0.5 + n * 1.7;
      ctx.lineWidth = Math.max(1, h * (0.004 + (n % 3) * 0.003));
      ctx.beginPath();
      for (let px = 0; px <= w; px += w / 14) {
        const py = h * (0.05 + (n % 4) * 0.055) + Math.sin(px * 0.02 + phase) * h * 0.022;
        px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 배경 기포
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#dff6ff';
    for (let n = 0; n < 18; n++) {
      const seed = n * 37.7;
      const bx = ((Math.sin(seed) * 0.5 + 0.5) * w + Math.sin(this.time + n) * 8) % w;
      const by = h - (((this.time * (18 + (n % 7) * 6) + seed * 20) % (h + 60)) - 30);
      const r = 2 + (n % 4);
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.decor.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `${Math.round(h * 0.05)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(t('subtitle'), w / 2, h / 2);
    }

    // 정해진 순서로 그려야 앞뒤가 맞는다
    const order: Decor['kind'][] = [
      'glass', 'sand', 'rock', 'wreck', 'kelp', 'coral', 'lamp', 'jelly', 'fish', 'ray', 'turtle', 'whale',
    ];
    for (const kind of order) {
      for (const d of this.decor) {
        if (d.kind === kind) this.drawDecor(d);
      }
    }

    // 관측창 안쪽 — 가장자리로 갈수록 어두워야 '들여다보는 창'이 된다.
    // 테두리는 CSS 가 황동으로 그리므로 여기서 흰 선을 또 긋지 않는다.
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(2, 12, 18, 0.85)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // 위에서 비스듬히 들어오는 작업등
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const shaft = ctx.createLinearGradient(w * 0.25, 0, w * 0.55, h);
    shaft.addColorStop(0, 'rgba(150, 210, 235, 0.16)');
    shaft.addColorStop(0.7, 'rgba(150, 210, 235, 0)');
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(w * 0.12, 0);
    ctx.lineTo(w * 0.46, 0);
    ctx.lineTo(w * 0.72, h);
    ctx.lineTo(w * 0.3, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawDecor(d: Decor): void {
    const { ctx, w, h } = this;
    const x = d.x * w;
    const y = d.y * h;
    const s = d.scale * Math.min(w, h) * 0.13;
    const wobble = Math.sin(this.time * 1.4 + d.x * 9) * 0.12;

    ctx.save();
    switch (d.kind) {
      case 'glass':
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = `hsl(${d.hue} 80% 70%)`;
        ctx.fillRect(0, 0, w, h);
        break;

      case 'sand': {
        // 보드 바닥과 같은 해저 모래 사진을 깐다. 여기만 단색 그라디언트면
        // 같은 게임 안의 두 바다가 서로 다른 재질이 된다.
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, h * 0.88);
        for (let px = 0; px <= w; px += w / 8) {
          ctx.quadraticCurveTo(px + w / 16, h * (0.84 + 0.04 * Math.sin(px)), px + w / 8, h * 0.88);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        const sand = texturePattern(ctx, 'sand', (h * 0.5) / 512);
        if (sand) {
          ctx.fillStyle = sand;
          ctx.fill();
          // 물속 깊이만큼 가라앉힌다
          ctx.fillStyle = 'rgba(6, 26, 36, 0.45)';
          ctx.fill();
        } else {
          const g = ctx.createLinearGradient(0, h * 0.82, 0, h);
          g.addColorStop(0, `hsl(${d.hue} 55% 62%)`);
          g.addColorStop(1, `hsl(${d.hue} 45% 42%)`);
          ctx.fillStyle = g;
          ctx.fill();
        }
        break;
      }

      case 'rock': {
        ctx.beginPath();
        ctx.ellipse(x, y, s * 1.1, s * 0.7, 0, Math.PI, Math.PI * 2);
        const stone = texturePattern(ctx, 'boulder', (s * 1.6) / 512);
        ctx.fillStyle = stone ?? `hsl(${d.hue} 20% 38%)`;
        ctx.fill();
        if (stone) {
          ctx.fillStyle = 'rgba(6, 24, 34, 0.4)';
          ctx.fill();
        }
        break;
      }

      case 'coral':
        ctx.strokeStyle = `hsl(${d.hue} 75% 62%)`;
        ctx.lineWidth = s * 0.22;
        ctx.lineCap = 'round';
        for (let n = -2; n <= 2; n++) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + n * s * 0.35, y - s * 0.6, x + n * s * 0.5, y - s * (1.1 - Math.abs(n) * 0.15));
          ctx.stroke();
        }
        break;

      case 'kelp':
        ctx.strokeStyle = `hsl(${d.hue} 60% 45%)`;
        ctx.lineWidth = s * 0.2;
        ctx.lineCap = 'round';
        for (let n = -1; n <= 1; n++) {
          ctx.beginPath();
          ctx.moveTo(x + n * s * 0.25, y);
          ctx.quadraticCurveTo(
            x + n * s * 0.25 + wobble * s * 2,
            y - s * 1.2,
            x + n * s * 0.25 + wobble * s * 3,
            y - s * 2.2,
          );
          ctx.stroke();
        }
        break;

      case 'lamp': {
        const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3);
        g.addColorStop(0, `hsla(${d.hue}, 95%, 75%, 0.55)`);
        g.addColorStop(1, 'hsla(0,0%,100%,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, s * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsl(${d.hue} 90% 80%)`;
        ctx.fillRect(x - s * 0.4, y - s * 0.12, s * 0.8, s * 0.24);
        break;
      }

      case 'wreck':
        ctx.fillStyle = `hsl(${d.hue} 35% 30%)`;
        ctx.beginPath();
        ctx.moveTo(x - s * 1.6, y - s * 0.4);
        ctx.quadraticCurveTo(x, y + s * 0.9, x + s * 1.6, y - s * 0.4);
        ctx.lineTo(x + s * 1.2, y - s * 0.7);
        ctx.lineTo(x - s * 1.2, y - s * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `hsl(${d.hue} 30% 20%)`;
        ctx.lineWidth = s * 0.12;
        ctx.stroke();
        break;

      case 'jelly': {
        const jy = y + Math.sin(this.time * 0.9 + d.x * 7) * s * 0.5;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = `hsl(${d.hue} 80% 72%)`;
        ctx.beginPath();
        ctx.arc(x, jy, s * 0.75, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `hsl(${d.hue} 80% 78%)`;
        ctx.lineWidth = s * 0.09;
        for (let n = -2; n <= 2; n++) {
          ctx.beginPath();
          ctx.moveTo(x + n * s * 0.22, jy);
          ctx.quadraticCurveTo(
            x + n * s * 0.22 + Math.sin(this.time * 2 + n) * s * 0.2,
            jy + s * 0.7,
            x + n * s * 0.22,
            jy + s * 1.3,
          );
          ctx.stroke();
        }
        break;
      }

      case 'fish': {
        const fx = x + Math.sin(this.time * 0.6 + d.x * 11) * w * 0.12;
        const dir = Math.cos(this.time * 0.6 + d.x * 11) >= 0 ? 1 : -1;
        ctx.translate(fx, y + Math.sin(this.time * 1.7 + d.y * 5) * s * 0.2);
        ctx.scale(dir, 1);
        ctx.fillStyle = `hsl(${d.hue} 80% 60%)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.6, s * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.55, 0);
        ctx.lineTo(-s * 0.95, -s * 0.3);
        ctx.lineTo(-s * 0.95, s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#0d2230';
        ctx.beginPath();
        ctx.arc(s * 0.3, -s * 0.08, s * 0.07, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'ray': {
        const rx = x + Math.sin(this.time * 0.35 + d.x * 5) * w * 0.2;
        ctx.translate(rx, y + Math.sin(this.time * 0.8) * s * 0.3);
        ctx.fillStyle = `hsl(${d.hue} 30% 45%)`;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.5);
        ctx.quadraticCurveTo(s * 1.4, Math.sin(this.time * 2) * s * 0.4, s * 0.2, s * 0.5);
        ctx.quadraticCurveTo(0, s * 0.2, -s * 0.2, s * 0.5);
        ctx.quadraticCurveTo(-s * 1.4, Math.sin(this.time * 2 + 1) * s * 0.4, 0, -s * 0.5);
        ctx.fill();
        break;
      }

      case 'turtle': {
        const tx = x + Math.sin(this.time * 0.28 + d.x * 3) * w * 0.24;
        ctx.translate(tx, y + Math.sin(this.time * 0.9) * s * 0.25);
        ctx.fillStyle = `hsl(${d.hue} 40% 40%)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.8, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsl(${d.hue} 35% 55%)`;
        ctx.beginPath();
        ctx.arc(s * 0.85, -s * 0.1, s * 0.22, 0, Math.PI * 2);
        ctx.fill();
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(-s * 0.1, sy * s * 0.5, s * 0.4, s * 0.16, sy * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case 'whale': {
        const wx = x + Math.sin(this.time * 0.18) * w * 0.3;
        ctx.globalAlpha = 0.55;
        ctx.translate(wx, y + Math.sin(this.time * 0.5) * s * 0.4);
        ctx.fillStyle = `hsl(${d.hue} 60% 65%)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 2.2, s * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 2.1, 0);
        ctx.lineTo(-s * 2.9, -s * 0.7);
        ctx.lineTo(-s * 2.9, s * 0.7);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
}

export { ALL_TASKS };
