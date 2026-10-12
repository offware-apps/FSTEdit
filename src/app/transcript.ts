import type { Silence, Word } from '../lib/cuts';
import type { EditHistory } from '../lib/history';

type Item = { kind: 'word'; i: number; at: number } | { kind: 'pause'; i: number; at: number };

export type TranscriptEvents = {
  /** The selection changed; `seekTo` is where the video should move, when the user chose it. */
  select(seekTo: number | null): void;
  /** The user struck or restored the selection with a key. */
  toggle(): void;
};

/**
 * The transcript as one long line of words and pauses. It builds its elements
 * once per transcript and changes classes alone on each edit, so a one-hour
 * talk of ten thousand words stays responsive.
 */
export class TranscriptView {
  private items: Item[] = [];
  private els: HTMLElement[] = [];
  private anchor = -1;
  private focus = -1;
  private dragging = false;
  private touch: { x: number; y: number; id: number; anchor: number; focus: number } | null = null;
  private now: HTMLElement | null = null;
  /** Keeps the word being played in view; off on a slow screen, where every scroll is a redraw. */
  follow = true;

  constructor(
    private root: HTMLElement,
    private edit: EditHistory,
    private events: TranscriptEvents,
  ) {
    root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    root.addEventListener('pointermove', (e) => this.pointerMove(e));
    root.addEventListener('pointerup', (e) => this.pointerUp(e));
    // the browser took the gesture to scroll: the selection stays as it was
    root.addEventListener('pointercancel', () => {
      if (this.touch && !this.dragging) {
        this.anchor = this.touch.anchor;
        this.focus = this.touch.focus;
        this.refresh();
      }
      this.touch = null;
      this.dragging = false;
    });
    root.addEventListener('keydown', (e) => this.key(e));
  }

  get length() {
    return this.items.length;
  }

  entry(k: number): Word | Silence {
    const it = this.items[k];
    return it.kind === 'word' ? this.edit.words[it.i] : this.edit.silences[it.i];
  }

  /** The selected range of items, first and last, or null. */
  selection(): [number, number] | null {
    if (this.anchor < 0 || this.focus < 0) return null;
    return [Math.min(this.anchor, this.focus), Math.max(this.anchor, this.focus)];
  }

  selected(): (Word | Silence)[] {
    const s = this.selection();
    if (!s) return [];
    const out: (Word | Silence)[] = [];
    for (let k = s[0]; k <= s[1]; k++) out.push(this.entry(k));
    return out;
  }

  /** Builds the elements again; for a new transcript or a new set of silences. */
  rebuild() {
    this.items = [
      ...this.edit.words.map((w, i) => ({ kind: 'word' as const, i, at: w.start })),
      ...this.edit.silences.map((s, i) => ({ kind: 'pause' as const, i, at: s.start })),
    ].sort((a, b) => a.at - b.at);
    const frag = document.createDocumentFragment();
    this.els = this.items.map((it, k) => {
      const el = document.createElement('span');
      el.id = `t${k}`;
      el.dataset.k = String(k);
      el.setAttribute('role', 'option');
      if (it.kind === 'word') {
        el.className = 'w';
        el.textContent = this.edit.words[it.i].text;
      } else {
        const s = this.edit.silences[it.i];
        const length = `${(s.end - s.start).toFixed(1)} s`;
        el.className = s.label ? 'p marked' : 'p';
        el.textContent = s.label ? `${s.label}, ${length}` : length;
      }
      frag.append(el, ' ');
      return el;
    });
    this.root.replaceChildren(frag);
    this.now = null;
    // a selection the user made survives a rebuild, as after an undo; none is made for them
    if (this.focus >= 0 && this.items.length) {
      this.anchor = Math.min(this.anchor, this.items.length - 1);
      this.focus = Math.min(this.focus, this.items.length - 1);
    } else this.anchor = this.focus = -1;
    this.refresh();
  }

  /** Brings every element's struck and selected marks up to date. */
  refresh() {
    const sel = this.selection();
    this.els.forEach((el, k) => {
      const e = this.entry(k);
      el.classList.toggle('cut', e.cut);
      el.setAttribute('aria-selected', String(!!sel && k >= sel[0] && k <= sel[1]));
      el.classList.toggle('sel', !!sel && k >= sel[0] && k <= sel[1]);
      // the struck state is spoken, since a screen reader does not read a line through a word
      const name = this.items[k].kind === 'word' ? (e as Word).text : `${(e as Silence).label ?? 'pause'}, ${(e.end - e.start).toFixed(1)} seconds`;
      el.setAttribute('aria-label', e.cut ? `${name.replace(/[,.;:!?]+$/, '')}, struck` : name);
    });
    if (this.focus >= 0) this.root.setAttribute('aria-activedescendant', `t${this.focus}`);
    else this.root.removeAttribute('aria-activedescendant');
  }

  select(anchor: number, focus = anchor, seek = true) {
    if (!this.items.length) return;
    const clamp = (k: number) => Math.max(0, Math.min(this.items.length - 1, k));
    this.anchor = clamp(anchor);
    this.focus = clamp(focus);
    this.refresh();
    this.els[this.focus]?.scrollIntoView({ block: 'nearest' });
    this.events.select(seek ? this.entry(Math.min(this.anchor, this.focus)).start : null);
  }

  /** Underlines the word being said at talk time `t`. */
  setNow(t: number) {
    let el: HTMLElement | null = null;
    // the words are in time order, so a binary search finds the one at t
    let lo = 0;
    let hi = this.items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = this.entry(mid);
      if (t < e.start) hi = mid - 1;
      else if (t >= e.end) lo = mid + 1;
      else {
        el = this.els[mid];
        break;
      }
    }
    if (el === this.now) return;
    this.now?.classList.remove('now');
    el?.classList.add('now');
    this.now = el;
    if (el && this.follow) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > innerHeight - 140) el.scrollIntoView({ block: 'center' });
    }
  }

  private at(e: PointerEvent): number | null {
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-k]');
    if (target && this.root.contains(target)) return Number(target.dataset.k);
    if (e.pointerType === 'mouse') return null;
    // a finger that lands between two lines picks the nearest word within 24 px
    let best: number | null = null;
    let bestD = 24;
    this.els.forEach((el, k) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  private pointerDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse') {
      // a finger may be about to scroll: wait for a tap, or a sideways drag, before changing the selection
      this.touch = { x: e.clientX, y: e.clientY, id: e.pointerId, anchor: this.anchor, focus: this.focus };
      return;
    }
    const k = this.at(e);
    if (k === null || e.button !== 0) return;
    e.preventDefault();
    this.root.focus({ preventScroll: true });
    this.dragging = true;
    this.root.setPointerCapture(e.pointerId);
    if (e.shiftKey && this.anchor >= 0) this.select(this.anchor, k, false);
    else this.select(k, k, false);
  }

  private pointerMove(e: PointerEvent) {
    if (this.touch && !this.dragging) {
      const dx = Math.abs(e.clientX - this.touch.x);
      const dy = Math.abs(e.clientY - this.touch.y);
      if (dx > 8 && dx > dy) {
        const k = this.at(new PointerEvent('pointerdown', { clientX: this.touch.x, clientY: this.touch.y, pointerType: 'touch' }));
        if (k !== null) {
          this.dragging = true;
          this.root.setPointerCapture(e.pointerId);
          this.select(k, k, false);
        }
      }
    }
    if (!this.dragging) return;
    const k = this.at(e);
    if (k !== null && k !== this.focus) this.select(this.anchor, k, false);
  }

  private pointerUp(e?: PointerEvent) {
    if (this.touch && !this.dragging && e) {
      const moved = Math.hypot(e.clientX - this.touch.x, e.clientY - this.touch.y);
      this.touch = null;
      const k = moved < 10 ? this.at(e) : null;
      if (k !== null) this.select(k, k, true);
      return;
    }
    this.touch = null;
    if (!this.dragging) return;
    this.dragging = false;
    const s = this.selection();
    if (s) this.events.select(this.entry(s[0]).start);
  }

  private key(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const f = this.focus < 0 ? 0 : this.focus;
    const move = (k: number) => (e.shiftKey ? this.select(this.anchor, k) : this.select(k));
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(f + 1),
      ArrowDown: () => move(f + 1),
      ArrowLeft: () => move(f - 1),
      ArrowUp: () => move(f - 1),
      Home: () => move(0),
      End: () => move(this.items.length - 1),
      x: () => this.events.toggle(),
      X: () => this.events.toggle(),
      Delete: () => this.events.toggle(),
      Backspace: () => this.events.toggle(),
      Enter: () => this.events.toggle(),
    };
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.select(0, this.items.length - 1, false);
      return;
    }
    const action = !mod ? keys[e.key] : undefined;
    if (action) {
      e.preventDefault();
      action();
    }
  }
}
