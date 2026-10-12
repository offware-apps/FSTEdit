import type { Range, Word } from './cuts';

/** How far into the edited talk a moment of the original sits, in seconds. */
export function keptBefore(t: number, kept: Range[]): number {
  let s = 0;
  for (const r of kept) {
    if (t <= r.start) break;
    s += Math.min(t, r.end) - r.start;
  }
  return s;
}

/** True while a word the edit keeps is being said at talk time `t`. */
export function speakingAt(t: number, words: Word[]): boolean {
  return words.some((w) => !w.cut && w.start <= t && t < w.end);
}

/** How much the music ducks while someone speaks, matching the render's compressor. */
export const DUCK_GAIN = 0.5;

export type GainInput = {
  /** Seconds into the finished video. */
  at: number;
  /** When the music stops being heard: the video's end, or the music's own end if it does not repeat. */
  heardUntil: number;
  volume: number;
  fade: number;
  duck: boolean;
  speaking: boolean;
};

/** The music's volume at one moment of the preview, 0 to 1. */
export function musicGain({ at, heardUntil, volume, fade, duck, speaking }: GainInput): number {
  if (at < 0 || at >= heardUntil) return 0;
  const ramp = fade > 0 ? Math.min(1, at / fade, (heardUntil - at) / fade) : 1;
  const g = volume * ramp * (duck && speaking ? DUCK_GAIN : 1);
  return Math.max(0, Math.min(1, g));
}
