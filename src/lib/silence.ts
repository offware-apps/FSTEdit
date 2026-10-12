import type { Range } from './cuts';

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
 * Moves each edge of each range to the quietest instant within `window`
 * seconds of it, so a cut lands in the gap between two words rather than on
 * the consonant a word timestamp misplaced by a few milliseconds.
 */
export function snapToQuiet(ranges: Range[], samples: Float32Array, rate: number, window = 0.04): Range[] {
  const hop = Math.max(1, Math.round(rate * 0.002));
  const span = Math.round(window * rate);
  const quietest = (t: number) => {
    const centre = Math.round(t * rate);
    let best = centre;
    let bestEnergy = Infinity;
    for (let c = Math.max(hop, centre - span); c <= Math.min(samples.length - hop, centre + span); c += hop) {
      let e = 0;
      for (let i = c - hop; i < c + hop; i++) e += samples[i] * samples[i];
      // ties keep the nearest instant, so silence leaves the edge where it was
      if (e < bestEnergy - 1e-9 || (Math.abs(e - bestEnergy) <= 1e-9 && Math.abs(c - centre) < Math.abs(best - centre))) {
        bestEnergy = e;
        best = c;
      }
    }
    return best / rate;
  };
  return ranges.map((r) => {
    const start = r.start <= 0 ? 0 : quietest(r.start);
    const end = r.end * rate >= samples.length ? r.end : quietest(r.end);
    return end > start ? { start, end } : r;
  });
}
