import type { Silence, Word } from '../lib/cuts';
import type { Additions } from '../lib/otio';

const PREFIX = 'fstedit:';
const INDEX = 'fstedit-index';
const VERSION = 2;
// a one-hour transcript takes about a sixth of the storage a browser gives a site, so a few edits are kept
const KEEP = 4;

export type Saved = {
  words: Word[];
  silences: Silence[];
  transcriptName: string | null;
  /** The intro, outro and music by name, with the music settings; the files themselves are opened again. */
  additions: Additions | null;
};

/** The key for one recording; the name, size and date together tell one file from another without reading it. */
export const keyOf = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

function index(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** The edit last made on this recording in this browser, or null. */
export function load(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Saved & { v: number };
    if (data.v > VERSION || !Array.isArray(data.words) || !Array.isArray(data.silences)) return null;
    return { words: data.words, silences: data.silences, transcriptName: data.transcriptName ?? null, additions: data.additions ?? null };
  } catch {
    return null;
  }
}

let pending = 0;

/**
 * Keeps the edit in this browser, half a second after the last change. The
 * oldest edits go first when storage fills; `failed` hears when even that fails.
 */
export function save(key: string, data: Saved, failed: (why: string) => void) {
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    const text = JSON.stringify({ v: VERSION, ...data });
    let keys = [key, ...index().filter((k) => k !== key)];
    for (;;) {
      try {
        for (const old of keys.slice(KEEP)) localStorage.removeItem(PREFIX + old);
        keys = keys.slice(0, KEEP);
        localStorage.setItem(PREFIX + key, text);
        localStorage.setItem(INDEX, JSON.stringify(keys));
        return;
      } catch {
        if (keys.length <= 1) {
          failed('this browser has no room left to keep the edit; save the project to keep it');
          return;
        }
        localStorage.removeItem(PREFIX + keys.pop()!);
      }
    }
  }, 500);
}
