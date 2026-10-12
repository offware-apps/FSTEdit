import type { Word } from './cuts';

const MAX_WORDS_PER_CUE = 12;
const MAX_GAP = 1;

export function stamp(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

function parseStamp(s: string): number {
  const parts = s.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) throw new Error(`bad WebVTT timestamp: ${s}`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * A WebVTT file whose cues carry a timestamp before and after every word, so a
 * player shows subtitles and FSTEdit reads back each word's start and end.
 */
export function toVtt(words: Word[]): string {
  const blocks = groupCues(words).map((c, i) => {
    const text = c.map((w) => `<${stamp(w.start)}>${escape(w.text)}<${stamp(w.end)}>`).join(' ');
    return `${i + 1}\n${stamp(c[0].start)} --> ${stamp(c[c.length - 1].end)}\n${text}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

/** Words grouped into subtitle lines: at most 12, split at a sentence end or a pause over 1 s. */
export function groupCues(words: Word[]): Word[][] {
  const cues: Word[][] = [];
  let cue: Word[] = [];
  for (const w of words) {
    const prev = cue[cue.length - 1];
    const split =
      cue.length >= MAX_WORDS_PER_CUE ||
      (prev && (w.start - prev.end > MAX_GAP || /[.?!]$/.test(prev.text)));
    if (split) {
      cues.push(cue);
      cue = [];
    }
    cue.push(w);
  }
  if (cue.length) cues.push(cue);
  return cues;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The words of a WebVTT file, timed by its inline timestamps where present. */
export function fromVtt(text: string): Word[] {
  if (!/^\uFEFF?WEBVTT/.test(text)) throw new Error('not a WebVTT file');
  const words: Word[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split('-->').map((s) => parseStamp(s.trim().split(/\s/)[0]));
    const body = lines.slice(timing + 1).join(' ');
    // pieces alternate text and stamp; a stamp followed by no word ends the word before it
    const pieces = body.split(/<(\d[\d:.]*)>/);
    const cueWords: Word[] = [];
    let at = from;
    pieces.forEach((piece, i) => {
      if (i % 2 === 1) {
        at = parseStamp(piece);
        return;
      }
      const tokens = unescape(piece.replace(/<[^>]*>/g, '')).split(/\s+/).filter(Boolean);
      const last = cueWords[cueWords.length - 1];
      if (!tokens.length && last && Number.isNaN(last.end)) last.end = at;
      for (const t of tokens) cueWords.push({ text: t, start: at, end: NaN, cut: false });
    });
    // words sharing one stamp, as in a plain subtitle, split its stretch evenly
    for (let i = 0; i < cueWords.length; ) {
      let j = i;
      while (j + 1 < cueWords.length && cueWords[j + 1].start === cueWords[i].start) j++;
      const until = j + 1 < cueWords.length ? cueWords[j + 1].start : to;
      const step = (until - cueWords[i].start) / (j - i + 1);
      for (let k = i; k <= j; k++) {
        cueWords[k].start = cueWords[i].start + step * (k - i);
        if (Number.isNaN(cueWords[k].end)) cueWords[k].end = cueWords[k].start + step;
      }
      i = j + 1;
    }
    words.push(...cueWords);
  }
  return words;
}
