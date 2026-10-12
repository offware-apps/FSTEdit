import type { Word } from './cuts';

// hesitations a talk loses nothing without, in English and French; words that also carry meaning, like "like" or "so", stay
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'hm', 'mm', 'mhm', 'euh', 'heu', 'bah', 'ben', 'hein', 'hum']);

/** True for a hesitation such as "Um," or "euh...", whatever its case and punctuation. */
export function isFiller(text: string): boolean {
  return FILLERS.has(text.toLowerCase().replace(/[^\p{L}]/gu, ''));
}

/** The indexes of the filler words the edit still keeps. */
export function fillerIndexes(words: Word[]): number[] {
  return words.flatMap((w, i) => (!w.cut && isFiller(w.text) ? [i] : []));
}
