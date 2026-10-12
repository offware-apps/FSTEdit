/** A stretch of the video, in seconds from its start. */
export type Range = { start: number; end: number };

/** One spoken word, struck from the edit when `cut` is set. */
export type Word = { text: string; start: number; end: number; cut: boolean };

/**
 * A stretch without words: a quiet pause the silence finder reported, or,
 * with a `label`, one the user marked such as the setup before a talk starts.
 * Struck when `cut` is set.
 */
export type Silence = Range & { cut: boolean; label?: string };

/** Sorted ranges, with touching or overlapping ones joined. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

/** Every stretch the edit removes: struck words, struck silences. */
export function cutRanges(words: Word[], silences: Silence[]): Range[] {
  const ranges: Range[] = [];
  // a run of struck words goes as one stretch, so the pause inside it goes too
  let runStart = -1;
  words.forEach((w, i) => {
    if (w.cut && runStart < 0) runStart = i;
    const runEnds = runStart >= 0 && (!w.cut || i === words.length - 1);
    if (runEnds) {
      const last = w.cut ? w : words[i - 1];
      ranges.push({ start: words[runStart].start, end: last.end });
      runStart = -1;
    }
  });
  for (const s of silences) if (s.cut) ranges.push({ start: s.start, end: s.end });
  return mergeRanges(ranges);
}

/** The stretches the edit keeps, between 0 and `duration`. */
export function keptRanges(duration: number, cuts: Range[]): Range[] {
  const kept: Range[] = [];
  let t = 0;
  for (const c of mergeRanges(cuts)) {
    if (c.start > t) kept.push({ start: t, end: Math.min(c.start, duration) });
    t = Math.max(t, c.end);
  }
  if (t < duration) kept.push({ start: t, end: duration });
  return kept.filter((r) => r.end > r.start);
}

/** Where playback continues from `t`: past the cut it sits in, if any. */
export function skipCut(t: number, cuts: Range[]): number {
  for (const c of cuts) if (t >= c.start && t < c.end) return c.end;
  return t;
}

/** The parts of `a` that no range of `b` covers. */
export function subtractRanges(a: Range[], b: Range[]): Range[] {
  const minus = mergeRanges(b);
  const out: Range[] = [];
  for (const r of mergeRanges(a)) {
    let t = r.start;
    for (const m of minus) {
      if (m.end <= t || m.start >= r.end) continue;
      if (m.start > t) out.push({ start: t, end: m.start });
      t = Math.max(t, m.end);
    }
    if (t < r.end) out.push({ start: t, end: r.end });
  }
  return out;
}

/**
 * The struck words and silences that reproduce `kept`: a word is struck when
 * its middle falls outside every kept stretch, and what else is removed comes
 * back as struck silences.
 */
export function restoreCuts(
  words: Word[],
  duration: number,
  kept: Range[],
): { words: Word[]; silences: Silence[] } {
  const removed = subtractRanges([{ start: 0, end: duration }], kept);
  const inside = (t: number) => removed.some((r) => t >= r.start && t < r.end);
  const restored = words.map((w) => ({ ...w, cut: inside((w.start + w.end) / 2) }));
  const silences = subtractRanges(removed, cutRanges(restored, [])).map((r) => ({
    ...r,
    cut: true,
  }));
  return { words: restored, silences };
}
