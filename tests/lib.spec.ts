import { describe, expect, it } from 'vitest';
import {
  cutRanges,
  keptRanges,
  mergeRanges,
  restoreCuts,
  skipCut,
  subtractRanges,
  type Word,
} from '../src/lib/cuts';
import { fromOtio, toOtio } from '../src/lib/otio';
import { findSilences } from '../src/lib/silence';
import { fromSrt, toSrt } from '../src/lib/srt';
import { fromVtt, toVtt } from '../src/lib/vtt';

const w = (text: string, start: number, end: number, cut = false): Word => ({
  text,
  start,
  end,
  cut,
});

describe('ranges', () => {
  it('joins touching and overlapping ranges', () => {
    expect(mergeRanges([{ start: 3, end: 4 }, { start: 0, end: 1 }, { start: 1, end: 2 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it('keeps what no cut covers', () => {
    expect(keptRanges(10, [{ start: 2, end: 3 }, { start: 9, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 9 },
    ]);
  });

  it('subtracts', () => {
    expect(subtractRanges([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 6 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 10 },
    ]);
  });

  it('skips past the cut a time sits in', () => {
    const cuts = [{ start: 2, end: 3 }];
    expect(skipCut(2.5, cuts)).toBe(3);
    expect(skipCut(1, cuts)).toBe(1);
  });
});

describe('cutRanges', () => {
  const plain = (cuts: { start: number; end: number }[]) => cuts.map(({ start, end }) => ({ start, end }));

  it('takes a run of struck words as one stretch, pause included', () => {
    const words = [w('a', 0, 1), w('b', 1.2, 2, true), w('c', 2.5, 3, true), w('d', 3.2, 4)];
    expect(plain(cutRanges(words, []))).toEqual([{ start: 1.2, end: 3 }]);
  });

  it('closes a run on the last word', () => {
    const words = [w('a', 0, 1), w('b', 1.2, 2, true)];
    expect(plain(cutRanges(words, [{ start: 5, end: 6, cut: true }, { start: 7, end: 8, cut: false }]))).toEqual([
      { start: 1.2, end: 2 },
      { start: 5, end: 6 },
    ]);
  });

  it('moves an edge by its shift, and names the item each edge comes from', () => {
    const words = [w('a', 0, 1), { ...w('b', 1.2, 2, true), startShift: -0.1 }, w('c', 2.5, 3)];
    const [cut] = cutRanges(words, [{ start: 1.9, end: 2.4, cut: true, endShift: 0.05 }]);
    expect([cut.start, cut.end].map((t) => t.toFixed(3))).toEqual(['1.100', '2.450']);
    expect(cut).toMatchObject({ from: { kind: 'word', index: 1 }, to: { kind: 'silence', index: 0 } });
    // the edge the user moved, and the silence's, are not moved again
    expect(cut.snap).toEqual({ start: null, end: null });
  });

  it('restores the same strikes from the kept stretches', () => {
    const words = [w('a', 0, 1), w('b', 1.2, 2, true), w('c', 2.5, 3), w('d', 3.2, 4)];
    const silences = [{ start: 4.2, end: 5, cut: true }];
    const kept = keptRanges(6, cutRanges(words, silences));
    const back = restoreCuts(words.map((x) => ({ ...x, cut: false })), 6, kept);
    expect(back.words.map((x) => x.cut)).toEqual([false, true, false, false]);
    expect(back.silences).toEqual(silences);
  });
});

describe('findSilences', () => {
  it('reports a quiet stretch, shrunk by the margin', () => {
    const rate = 1000;
    const samples = new Float32Array(3 * rate);
    for (let i = 0; i < rate; i++) samples[i] = Math.sin(i);
    for (let i = 2 * rate; i < 3 * rate; i++) samples[i] = Math.sin(i);
    const found = findSilences(samples, rate, { thresholdDb: -40, minDuration: 0.5, margin: 0.1 });
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeCloseTo(1.1, 2);
    expect(found[0].end).toBeCloseTo(1.9, 2);
  });

  it('ignores a pause shorter than the minimum', () => {
    const rate = 1000;
    const samples = new Float32Array(rate).map((_, i) => (i > 400 && i < 600 ? 0 : Math.sin(i)));
    expect(findSilences(samples, rate, { thresholdDb: -40, minDuration: 0.5, margin: 0 })).toEqual([]);
  });
});

describe('WebVTT', () => {
  it('round-trips every word with its start and end', () => {
    const words = [w('Hello', 0.5, 0.9), w('<world>', 1, 1.4), w('again.', 1.5, 2), w('Next', 4, 4.3)];
    const vtt = toVtt(words);
    expect(vtt).toContain('<00:00:00.500>Hello<00:00:00.900>');
    expect(vtt).toContain('&lt;world&gt;');
    expect(vtt.match(/-->/g)).toHaveLength(2);
    expect(fromVtt(vtt)).toEqual(words);
  });

  it('reads a plain subtitle file, its words spread evenly over the cue', () => {
    const words = fromVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nhi there\n');
    expect(words.map((x) => [x.text, x.start, x.end])).toEqual([
      ['hi', 1, 1.5],
      ['there', 1.5, 2],
    ]);
  });

  it('refuses a file that is not WebVTT', () => {
    expect(() => fromVtt('1\n00:00:01,000 --> 00:00:02,000\nhi\n')).toThrow('not a WebVTT file');
  });
});

describe('OpenTimelineIO', () => {
  it('round-trips a project', () => {
    const p = {
      name: 'talk',
      media: 'talk.mp4',
      transcript: 'talk.vtt',
      duration: 12.5,
      kept: [
        { start: 0, end: 2 },
        { start: 3.25, end: 12.5 },
      ],
      additions: null,
    };
    expect(fromOtio(toOtio(p))).toEqual(p);
  });

  it('round-trips the intro, the outro and the music, which never count as talk', () => {
    const p = {
      name: 'talk',
      media: 'talk.mp4',
      transcript: 'talk.vtt',
      duration: 10,
      kept: [{ start: 1, end: 4 }],
      additions: {
        intro: { name: 'intro.mp4', duration: 2 },
        outro: { name: 'outro.mp4', duration: 1.5 },
        music: { name: 'music.mp3', duration: 60 },
        musicVolume: 0.2,
        fade: 1,
        loop: false,
        duck: true,
      },
    };
    const json = JSON.parse(toOtio(p));
    const [v1, , music] = json.tracks.children;
    expect(v1.children.map((c: { name: string }) => c.name)).toEqual(['intro.mp4', 'talk.mp4 1', 'outro.mp4']);
    expect(music.children[0].source_range.duration.value).toBe(6500);
    expect(fromOtio(toOtio(p))).toEqual(p);
  });

  it('refuses JSON that is not a timeline', () => {
    expect(() => fromOtio('{"OTIO_SCHEMA":"Clip.2"}')).toThrow('not an OpenTimelineIO timeline');
  });
});

describe('SRT', () => {
  it('writes cues with comma times and reads them back spread evenly', () => {
    const words = [w('Hello', 0, 0.5), w('there.', 0.5, 1), w('Next', 3, 4)];
    const srt = toSrt(words);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000\nHello there.');
    expect(fromSrt(srt).map((x) => [x.text, x.start, x.end])).toEqual([
      ['Hello', 0, 0.5],
      ['there.', 0.5, 1],
      ['Next', 3, 4],
    ]);
  });

  it('refuses a file that is not SRT', () => {
    expect(() => fromSrt('hello')).toThrow('not an SRT file');
  });
});
