import type { Range } from '../lib/cuts';

/** A cut's edge the user dragged: which cut, which edge, and the time it now sits at. */
export type EdgeMove = { cut: number; side: 'start' | 'end'; to: number };

/**
 * The talk's sound drawn across the window, the stretches the edit removes
 * shaded over it, each edge of each with a handle to drag it.
 */
export class Waveform {
  private peaks: Float32Array = new Float32Array(0);
  private samples: Float32Array | null = null;
  private duration = 0;
  private cuts: Range[] = [];
  private handles: HTMLElement[] = [];
  /** Hears a dragged edge once the mouse or the finger lets go. */
  onEdge: (move: EdgeMove) => void = () => {};

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
    this.placeHandles();
  }

  setCuts(cuts: Range[]) {
    this.cuts = cuts;
    this.placeHandles();
    this.draw();
  }

  private at = (t: number) => `${(100 * t) / this.duration}%`;

  private placeHandles() {
    for (const h of this.handles) h.remove();
    this.handles = [];
    if (!this.duration) return;
    this.cuts.forEach((c, i) => {
      for (const side of ['start', 'end'] as const) {
        // an edge at either end of the talk has nowhere to go
        if (c[side] <= 0 || c[side] >= this.duration) continue;
        const h = document.createElement('div');
        h.className = 'cut-edge';
        h.title = `Drag the ${side} of this cut`;
        h.style.left = this.at(c[side]);
        h.addEventListener('pointerdown', (e) => this.drag(e, i, side, h));
        this.canvas.parentElement!.append(h);
        this.handles.push(h);
      }
    });
  }

  private drag(e: PointerEvent, i: number, side: 'start' | 'end', h: HTMLElement) {
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const box = this.canvas.getBoundingClientRect();
    const cut = this.cuts[i];
    const from = cut[side];
    // a cut keeps at least 20 ms, so an edge never passes the other
    const lo = side === 'start' ? 0 : cut.start + 0.02;
    const hi = side === 'start' ? cut.end - 0.02 : this.duration;
    let to = from;
    const show = (t: number) => {
      h.style.left = this.at(t);
      this.cuts = this.cuts.map((c, k) => (k === i ? { ...c, [side]: t } : c));
      this.draw();
    };
    const move = (ev: PointerEvent) => {
      to = Math.min(hi, Math.max(lo, ((ev.clientX - box.left) / box.width) * this.duration));
      show(to);
    };
    const end = (ev: PointerEvent) => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', end);
      h.removeEventListener('pointercancel', end);
      if (ev.type === 'pointerup' && to !== from) this.onEdge({ cut: i, side, to });
      else show(from);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
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
