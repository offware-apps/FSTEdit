import { describe, expect, it } from 'vitest';
import { fillerIndexes, isFiller } from '../src/lib/fillers';
import { EditHistory } from '../src/lib/history';
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
  it('moves an edge onto the gap between two sounds', () => {
    const rate = 1000;
    const s = new Float32Array(1000).map((_, i) => (i >= 480 && i < 500 ? 0 : Math.sin(i)));
    const [r] = snapToQuiet([{ start: 0.47, end: 0.8 }], s, rate, 0.04);
    expect(r.start).toBeGreaterThanOrEqual(0.48);
    expect(r.start).toBeLessThanOrEqual(0.5);
  });
  it('leaves an edge alone in silence', () => {
    const s = new Float32Array(1000);
    expect(snapToQuiet([{ start: 0.3, end: 0.6 }], s, 1000)).toEqual([{ start: 0.3, end: 0.6 }]);
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
