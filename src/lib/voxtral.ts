import type { Word } from './cuts';

// Voxtral reads 80 ms of sound per text token, and writes a word's first token
// the delay it was trained to after the word starts, 480 ms
export const STEP_S = 0.08;
const LAG_S = 0.48;
// a word ends where the next starts, or sooner, where its sound stays this far under the loudest for a tenth of a second
const QUIET = 0.03;

/**
 * The words in Voxtral's output, one text piece per step, `''` for a step
 * that wrote nothing; a piece opening on a space starts a word. Each word
 * starts where its first piece came out, less the delay, from `offset` seconds.
 */
export function tokenWords(pieces: string[], offset: number): Word[] {
  const words: Word[] = [];
  pieces.forEach((piece, k) => {
    if (!piece) return;
    const at = Math.max(offset, offset + k * STEP_S - LAG_S);
    const open = words.at(-1);
    if (!open || /^\s/.test(piece)) words.push({ text: piece.trim(), start: at, end: at + STEP_S, cut: false });
    else open.text += piece;
  });
  return words.filter((w) => w.text).map((w) => ({ ...w, text: w.text.replace(/([.,!?])\1+/g, '$1') }));
}

/** Where the sound starting at `from` dies away, by `cap` at the latest, in seconds. */
function soundEnd(audio: Float32Array, rate: number, from: number, cap: number, quiet: number): number {
  const span = Math.round(0.1 * rate);
  const loudness = (at: number) => {
    let e = 0;
    for (let i = at; i < Math.min(audio.length, at + span); i++) e += audio[i] * audio[i];
    return Math.sqrt(e / span);
  };
  for (let n = 0, t = from + STEP_S; t < cap; t = from + STEP_S + ++n / 100) if (loudness(Math.round(t * rate)) < quiet) return t;
  return cap;
}

/** Ends each word where the next starts, or sooner where its sound dies away. */
export function closeWords(words: Word[], audio: Float32Array, rate: number): Word[] {
  let loudest = 0;
  for (let i = 0; i < audio.length; i += 160) loudest = Math.max(loudest, Math.abs(audio[i]));
  return words.map((w, i) => ({ ...w, end: soundEnd(audio, rate, w.start, words[i + 1]?.start ?? audio.length / rate, loudest * QUIET) }));
}
