import type { Silence, Word } from './cuts';

/** What an undo restores: which words are struck, and the silences with theirs. */
type Snapshot = { cut: boolean[]; silences: Silence[]; label: string };

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
    return { cut: this.words.map((w) => w.cut), silences: this.silences.map((s) => ({ ...s })), label };
  }

  private restore(s: Snapshot) {
    this.words.forEach((w, i) => (w.cut = s.cut[i] ?? false));
    this.silences = s.silences.map((x) => ({ ...x }));
  }

  /** Records the state before `apply` runs, so one undo reverts all of it. */
  change(label: string, apply: () => void): void {
    this.past.push(this.snapshot(label));
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
    apply();
  }

  /** Replaces the transcript itself; the history starts over, since old strikes no longer line up. */
  reset(words: Word[], silences: Silence[] = []): void {
    this.words = words;
    this.silences = silences;
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Undoes the last change and returns its label, or null when there is none. */
  undo(): string | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push(this.snapshot(s.label));
    this.restore(s);
    return s.label;
  }

  redo(): string | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push(this.snapshot(s.label));
    this.restore(s);
    return s.label;
  }
}
