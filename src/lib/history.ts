import type { Silence, Word } from './cuts';

/** What an undo restores: which words are struck and where their cuts' edges sit, and the silences with theirs. */
type Snapshot = { words: Pick<Word, 'cut' | 'startShift' | 'endShift'>[]; silences: Silence[]; label: string };

const LIMIT = 200;

/** The edit's strikes, with undo and redo over every change made through `change`. */
export class EditHistory {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  constructor(
    public words: Word[] = [],
    public silences: Silence[] = [],
  ) {}

  private snapshot(label: string): Snapshot {
    return {
      words: this.words.map(({ cut, startShift, endShift }) => ({ cut, startShift, endShift })),
      silences: this.silences.map((s) => ({ ...s })),
      label,
    };
  }

  private restore(s: Snapshot) {
    this.words.forEach((w, i) => {
      const was = s.words[i];
      w.cut = was?.cut ?? false;
      w.startShift = was?.startShift;
      w.endShift = was?.endShift;
    });
    this.silences = s.silences.map((x) => ({ ...x }));
  }

  private lastKey: string | null = null;

  /**
   * Records the state before `apply` runs, so one undo reverts all of it.
   * Changes in a row with the same `key`, one edge nudged ten times, undo as one.
   */
  change(label: string, apply: () => void, key?: string): void {
    if (!key || key !== this.lastKey) {
      this.past.push(this.snapshot(label));
      if (this.past.length > LIMIT) this.past.shift();
    }
    this.lastKey = key ?? null;
    this.future = [];
    apply();
  }

  /** Replaces the transcript itself; the history starts over, since old strikes no longer line up. */
  reset(words: Word[], silences: Silence[] = []): void {
    this.words = words;
    this.silences = silences;
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Undoes the last change and returns its label, or null when there is none. */
  undo(): string | null {
    this.lastKey = null;
    const s = this.past.pop();
    if (!s) return null;
    this.future.push(this.snapshot(s.label));
    this.restore(s);
    return s.label;
  }

  redo(): string | null {
    this.lastKey = null;
    const s = this.future.pop();
    if (!s) return null;
    this.past.push(this.snapshot(s.label));
    this.restore(s);
    return s.label;
  }
}
