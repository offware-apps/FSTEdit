import type { Range, Word } from './cuts';
import { keptBefore } from './preview';

/**
 * The words the edit keeps, timed as they play in the finished video: struck
 * words dropped, every later word moved earlier by what was cut before it,
 * and all of them after the intro.
 */
export function editedWords(words: Word[], kept: Range[], offset = 0): Word[] {
  return words
    .filter((w) => !w.cut && kept.some((r) => w.start < r.end && w.end > r.start))
    .map((w) => ({
      ...w,
      start: offset + keptBefore(w.start, kept),
      end: offset + keptBefore(w.end, kept),
    }));
}
