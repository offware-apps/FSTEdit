import type { Word } from './cuts';
import { fromVtt, groupCues, stamp } from './vtt';

/** An SRT subtitle file, one line per cue; SRT has no time for each word. */
export function toSrt(words: Word[]): string {
  const blocks = groupCues(words).map((c, i) => {
    const at = (t: number) => stamp(t).replace('.', ',');
    return `${i + 1}\n${at(c[0].start)} --> ${at(c[c.length - 1].end)}\n${c.map((w) => w.text).join(' ')}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

/** The words of an SRT file, each cue's words spread evenly across it. */
export function fromSrt(text: string): Word[] {
  if (!/\d+:\d+:\d+,\d+\s*-->/.test(text)) throw new Error('not an SRT file');
  // SRT is WebVTT with commas in its times and HTML-free text
  const vtt = text.replace(/^﻿/, '').replace(/(\d+:\d+:\d+),(\d+)/g, '$1.$2').replace(/<[^>]*>/g, '');
  return fromVtt(`WEBVTT\n\n${vtt}`);
}
