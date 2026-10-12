import { describe, expect, it } from 'vitest';
import { fillerIndexes, isFiller } from '../src/lib/fillers';
import { EditHistory } from '../src/lib/history';
import { cutRanges } from '../src/lib/cuts';
import { snapToQuiet } from '../src/lib/silence';
import { editedWords } from '../src/lib/subtitles';

const w = (text: string, cut = false) => ({ text, start: 0, end: 1, cut });

describe('fillers', () => {
  it('knows hesitations whatever their case and punctuation', () => {
    expect(['Um,', 'uh', 'Euh...', 'hmm?', 'Erm'].every(isFiller)).toBe(true);
  });
  it('leaves words that carry meaning', () => {
    expect(['like', 'so', 'umbrella', 'here'].some(isFiller)).toBe(false);
  });
  it('lists only the fillers still kept', () => {
    expect(fillerIndexes([w('Um,'), w('hello'), w('uh', true), w('euh')])).toEqual([0, 3]);
  });
});

describe('EditHistory', () => {
  it('undoes and redoes one change as a whole', () => {
    const h = new EditHistory([w('a'), w('b')], [{ start: 1, end: 2, cut: false }]);
    h.change('strike', () => {
      h.words[0].cut = true;
      h.silences[0].cut = true;
    });
    expect(h.undo()).toBe('strike');
    expect(h.words.map((x) => x.cut)).toEqual([false, false]);
    expect(h.silences[0].cut).toBe(false);
    expect(h.redo()).toBe('strike');
    expect(h.words[0].cut).toBe(true);
    expect(h.silences[0].cut).toBe(true);
  });

  it('drops the redo once a new change is made', () => {
    const h = new EditHistory([w('a')]);
    h.change('one', () => (h.words[0].cut = true));
    h.undo();
    h.change('two', () => (h.words[0].cut = true));
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('two');
    expect(h.undo()).toBeNull();
  });

  it('brings back silences that a change replaced', () => {
    const h = new EditHistory([w('a')], []);
    h.change('find', () => (h.silences = [{ start: 3, end: 4, cut: false }]));
    h.undo();
    expect(h.silences).toEqual([]);
  });
});

describe('snapToQuiet', () => {
  const rate = 16000;
  // three voiced words, a beat every 10 ms dying out over 4 ms, over room noise, with gaps at 1.0 to 1.06 s and 1.5 to 1.6 s
  const voice = () => {
    const s = new Float32Array(rate * 2.2).map((_, i) => 0.001 * Math.sin(i * 1.7));
    for (const [a, b] of [[0.5, 1.0], [1.06, 1.5], [1.6, 2.0]]) {
      for (let i = Math.round(a * rate); i < b * rate; i++) {
        s[i] += 0.5 * Math.exp(-((i / rate) % 0.01) / 0.004) * Math.sin(2 * Math.PI * 500 * (i / rate));
      }
    }
    return s;
  };
  // Whisper's times for the middle word, 80 ms late at its start and 20 ms early at its end
  const words = (shift?: number) => [
    { text: 'recording.', start: 0.5, end: 1.0, cut: false },
    { text: 'Are', start: 1.14, end: 1.48, cut: true, startShift: shift },
    { text: 'next', start: 1.6, end: 2.0, cut: false },
  ];

  it('moves a late edge back into the gap before the word, and an early one past its end', () => {
    const [r] = snapToQuiet(cutRanges(words(), []), voice(), rate);
    expect(r.start).toBeGreaterThanOrEqual(1.0);
    expect(r.start).toBeLessThanOrEqual(1.06);
    expect(r.end).toBeGreaterThanOrEqual(1.5);
    expect(r.end).toBeLessThanOrEqual(1.6);
  });
  it('leaves an edge the user moved where they put it', () => {
    const [r] = snapToQuiet(cutRanges(words(0.01), []), voice(), rate);
    expect(r.start).toBeCloseTo(1.15, 6);
  });
  it('leaves an edge alone in silence', () => {
    const [r] = snapToQuiet(cutRanges(words(), []), new Float32Array(rate * 2.2), rate);
    expect([r.start, r.end]).toEqual([1.14, 1.48]);
  });
});

describe('editedWords', () => {
  it('drops struck words and moves later ones earlier, after the intro', () => {
    const words = [
      { text: 'a', start: 0, end: 1, cut: false },
      { text: 'um', start: 1, end: 2, cut: true },
      { text: 'b', start: 2, end: 3, cut: false },
    ];
    const out = editedWords(words, [{ start: 0, end: 1 }, { start: 2, end: 3 }], 5);
    expect(out.map((w) => [w.text, w.start, w.end])).toEqual([
      ['a', 5, 6],
      ['b', 6, 7],
    ]);
  });
});
