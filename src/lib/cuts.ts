/** A stretch of the video, in seconds from its start. */
export type Range = { start: number; end: number };

/**
 * Seconds the user moved a cut's edge from where this item puts it, negative
 * for earlier: `startShift` applies when the item opens a cut, `endShift` when it closes one.
 */
export type Shifts = { startShift?: number; endShift?: number };

/** One spoken word, struck from the edit when `cut` is set. */
export type Word = { text: string; start: number; end: number; cut: boolean } & Shifts;

/**
 * A stretch without words: a quiet pause the silence finder reported, or,
 * with a `label`, one the user marked such as the setup before a talk starts.
 * Struck when `cut` is set.
 */
export type Silence = Range & { cut: boolean; label?: string } & Shifts;

/** The item one edge of a cut comes from: a word or a silence, by its place in its list. */
export type EdgeSource = { kind: 'word' | 'silence'; index: number };

/**
 * A stretch the edit removes, with the item each edge comes from. `snap`
 * holds, per edge, the span a word's edge may move in to land in the gap
 * before or after the word; null leaves the edge where it is.
 */
export type Cut = Range & {
  from: EdgeSource;
  to: EdgeSource;
  snap: { start: [number, number] | null; end: [number, number] | null };
};

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

// how far a word's edge may move to find the gap: Whisper places word edges up to a tenth of a second off
const REACH_OUT = 0.15;
const REACH_IN = 0.05;
// into a neighbouring word, the edge goes no further than this, nor past its middle
const INTO_NEIGHBOUR = 0.04;

const middle = (r: Range) => (r.start + r.end) / 2;

/** Every stretch the edit removes, struck words and struck silences, each edge with its item. */
export function cutRanges(words: Word[], silences: Silence[]): Cut[] {
  const raw: Cut[] = [];
  // a run of struck words goes as one stretch, so the pause inside it goes too
  let runStart = -1;
  words.forEach((w, i) => {
    if (w.cut && runStart < 0) runStart = i;
    const runEnds = runStart >= 0 && (!w.cut || i === words.length - 1);
    if (!runEnds) return;
    const a = runStart;
    const b = w.cut ? i : i - 1;
    runStart = -1;
    const first = words[a];
    const last = words[b];
    const before = words[a - 1];
    const after = words[b + 1];
    const start = first.start + (first.startShift ?? 0);
    const end = last.end + (last.endShift ?? 0);
    raw.push({
      start,
      end,
      from: { kind: 'word', index: a },
      to: { kind: 'word', index: b },
      snap: {
        start: first.startShift !== undefined
          ? null
          : [Math.max(start - REACH_OUT, before ? Math.max(before.end - INTO_NEIGHBOUR, middle(before)) : 0), Math.min(start + REACH_IN, middle(first))],
        end: last.endShift !== undefined
          ? null
          : [Math.max(end - REACH_IN, middle(last)), Math.min(end + REACH_OUT, after ? Math.min(after.start + INTO_NEIGHBOUR, middle(after)) : Infinity)],
      },
    });
  });
  silences.forEach((s, i) => {
    if (!s.cut) return;
    // a silence's edges were measured on the sound already
    const edge: EdgeSource = { kind: 'silence', index: i };
    raw.push({ start: s.start + (s.startShift ?? 0), end: s.end + (s.endShift ?? 0), from: edge, to: edge, snap: { start: null, end: null } });
  });
  raw.sort((x, y) => x.start - y.start);
  const out: Cut[] = [];
  for (const r of raw) {
    if (r.end <= r.start) continue;
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) Object.assign(last, { end: r.end, to: r.to, snap: { ...last.snap, end: r.snap.end } });
    } else out.push({ ...r, snap: { ...r.snap } });
  }
  return out;
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
