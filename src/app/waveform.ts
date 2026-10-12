import type { Range } from '../lib/cuts';

/** The talk's sound drawn across the window, the stretches the edit removes shaded over it. */
export class Waveform {
  private peaks: Float32Array = new Float32Array(0);
  private samples: Float32Array | null = null;
  private duration = 0;
  private cuts: Range[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private playhead: HTMLElement,
  ) {
    new ResizeObserver(() => this.layout()).observe(canvas);
  }

  setSound(samples: Float32Array, rate: number) {
    this.samples = samples;
    this.duration = samples.length / rate;
    this.layout();
  }

  setCuts(cuts: Range[]) {
    this.cuts = cuts;
    this.draw();
  }

  moveTo(t: number) {
    this.playhead.style.left = this.duration ? `${(100 * t) / this.duration}%` : '0';
  }

  // one peak per device pixel, so a long talk costs one pass over its samples per resize
  private layout() {
    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    this.canvas.width = w;
    this.canvas.height = h;
    const s = this.samples;
    this.peaks = new Float32Array(w);
    if (s && s.length) {
      const per = s.length / w;
      for (let x = 0; x < w; x++) {
        let peak = 0;
        const from = Math.floor(x * per);
        const to = Math.min(s.length, Math.floor((x + 1) * per));
        // a stride keeps a long talk fast; a peak a few samples wide is still found
        const step = Math.max(1, Math.floor((to - from) / 256));
        for (let i = from; i < to; i += step) {
          const v = Math.abs(s[i]);
          if (v > peak) peak = v;
        }
        this.peaks[x] = peak;
      }
      let max = 0;
      for (const p of this.peaks) if (p > max) max = p;
      if (max > 0) for (let x = 0; x < w; x++) this.peaks[x] /= max;
    }
    this.draw();
  }

  private draw() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const style = getComputedStyle(this.canvas);
    const ink = style.getPropertyValue('--wave').trim() || '#444';
    const cut = style.getPropertyValue('--cut').trim() || '#c2410c';
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    ctx.fillStyle = ink;
    for (let x = 0; x < w; x++) {
      const half = Math.max(1, this.peaks[x] * (h / 2 - 2));
      ctx.fillRect(x, mid - half, 1, half * 2);
    }
    if (!this.duration) return;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = cut;
    for (const r of this.cuts) {
      const x0 = (r.start / this.duration) * w;
      ctx.fillRect(x0, 0, Math.max(1, ((r.end - r.start) / this.duration) * w), h);
    }
    ctx.globalAlpha = 1;
  }
}
