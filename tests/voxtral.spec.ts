import { describe, expect, it } from 'vitest';
import { closeWords, tokenWords } from '../src/lib/voxtral';

describe('Voxtral words', () => {
  it('joins pieces into words, timed from their first piece less the delay', () => {
    // steps 7 and 9 write " Hello" and " wor"+"ld.."; the other steps write nothing
    const pieces = ['', '', '', '', '', '', '', ' Hello', '', ' wor', 'ld', '.', '.'];
    const words = tokenWords(pieces, 10);
    expect(words.map((w) => w.text)).toEqual(['Hello', 'world.']);
    expect(words.map((w) => w.start.toFixed(2))).toEqual(['10.08', '10.24']);
  });

  it('never starts a word before its window', () => {
    expect(tokenWords([' Hi'], 5)[0].start).toBe(5);
  });

  it('ends a word where its sound dies away, or where the next starts', () => {
    const rate = 1000;
    // sound from 0 to 0.5 s, silence to 1 s, sound again to 1.5 s
    const audio = new Float32Array(1500).map((_, i) => (i < 500 || i >= 1000 ? Math.sin(i) : 0));
    const words = closeWords(
      [
        { text: 'a', start: 0, end: 0, cut: false },
        { text: 'b', start: 0.3, end: 0, cut: false },
        { text: 'c', start: 1, end: 0, cut: false },
      ],
      audio,
      rate,
    );
    expect(words[0].end).toBe(0.3);
    expect(words[1].end).toBeGreaterThan(0.39);
    expect(words[1].end).toBeLessThanOrEqual(0.5);
    expect(words[2].end).toBe(1.5);
  });
});
