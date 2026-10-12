import type { Cut, Range } from './cuts';

export type SilenceOptions = {
  /** Loudness under which a window counts as quiet, in dBFS. */
  thresholdDb: number;
  /** Shortest quiet stretch worth reporting, in seconds. */
  minDuration: number;
  /** Quiet kept on each side of a stretch, so a cut never clips a breath. */
  margin: number;
  /** Length of one loudness window, in seconds. */
  window?: number;
};

/** The quiet stretches of mono `samples`, each already shrunk by `margin`. */
export function findSilences(
  samples: Float32Array,
  sampleRate: number,
  { thresholdDb, minDuration, margin, window = 0.02 }: SilenceOptions,
): Range[] {
  const size = Math.max(1, Math.round(window * sampleRate));
  const threshold = 10 ** (thresholdDb / 20);
  const out: Range[] = [];
  let quietFrom = -1;
  const close = (endSample: number) => {
    const start = quietFrom / sampleRate;
    const end = endSample / sampleRate;
    if (end - start >= minDuration && end - start > 2 * margin) {
      out.push({ start: start + margin, end: end - margin });
    }
    quietFrom = -1;
  };
  for (let i = 0; i < samples.length; i += size) {
    const n = Math.min(size, samples.length - i);
    let sum = 0;
    for (let j = i; j < i + n; j++) sum += samples[j] * samples[j];
    const quiet = Math.sqrt(sum / n) < threshold;
    if (quiet && quietFrom < 0) quietFrom = i;
    if (!quiet && quietFrom >= 0) close(i);
  }
  if (quietFrom >= 0) close(samples.length);
  return out;
}

/**
 * Moves each edge of each cut to the quietest instant inside its `snap` span,
 * so the cut lands in the gap between two words rather than on the sound a
 * word time misplaced. Loudness is taken over 20 ms, longer than one beat of a
 * speaking voice, so the quiet between two beats inside a word never wins.
 */
export function snapToQuiet<T extends Cut>(cuts: T[], samples: Float32Array, rate: number): T[] {
  const half = Math.round(rate * 0.01);
  const hop = Math.max(1, Math.round(rate * 0.002));
  const quietest = (t: number, [lo, hi]: [number, number]) => {
    const from = Math.max(half, Math.round(lo * rate));
    const to = Math.min(samples.length - half, Math.round(hi * rate));
    if (from > to) return t;
    // a running sum of squares, so each step of the search costs two samples
    let e = 0;
    for (let i = from - half; i < from + half; i++) e += samples[i] * samples[i];
    const centre = Math.round(t * rate);
    let best = centre;
    let bestEnergy = Infinity;
    for (let c = from; c <= to; c++) {
      if (c > from) e += samples[c + half - 1] ** 2 - samples[c - half - 1] ** 2;
      if ((c - from) % hop) continue;
      // ties keep the nearest instant, so silence leaves the edge where it was
      if (e < bestEnergy - 1e-9 || (Math.abs(e - bestEnergy) <= 1e-9 && Math.abs(c - centre) < Math.abs(best - centre))) {
        bestEnergy = e;
        best = c;
      }
    }
    return best / rate;
  };
  return cuts.map((r) => {
    const start = r.snap.start && r.start > 0 ? quietest(r.start, r.snap.start) : r.start;
    const end = r.snap.end && r.end * rate < samples.length ? quietest(r.end, r.snap.end) : r.end;
    return end > start ? { ...r, start, end } : r;
  });
}
