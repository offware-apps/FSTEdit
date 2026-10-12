import { describe, expect, it } from 'vitest';
import { DUCK_GAIN, keptBefore, musicGain, speakingAt } from '../src/lib/preview';

const kept = [
  { start: 0, end: 2 },
  { start: 5, end: 7 },
];

describe('keptBefore', () => {
  it('counts only the kept seconds before a moment', () => {
    expect(keptBefore(1, kept)).toBe(1);
    expect(keptBefore(3, kept)).toBe(2);
    expect(keptBefore(6, kept)).toBe(3);
    expect(keptBefore(9, kept)).toBe(4);
  });
});

describe('speakingAt', () => {
  const words = [
    { text: 'a', start: 1, end: 1.5, cut: false },
    { text: 'b', start: 2, end: 2.5, cut: true },
  ];
  it('is true inside a kept word only', () => {
    expect(speakingAt(1.2, words)).toBe(true);
    expect(speakingAt(1.7, words)).toBe(false);
    expect(speakingAt(2.2, words)).toBe(false);
  });
});

describe('musicGain', () => {
  const base = { heardUntil: 10, volume: 0.2, fade: 1, duck: true, speaking: false };
  it('rises over the fade, holds, then falls to nothing at the end', () => {
    expect(musicGain({ ...base, at: 0 })).toBe(0);
    expect(musicGain({ ...base, at: 0.5 })).toBeCloseTo(0.1);
    expect(musicGain({ ...base, at: 5 })).toBeCloseTo(0.2);
    expect(musicGain({ ...base, at: 9.75 })).toBeCloseTo(0.05);
    expect(musicGain({ ...base, at: 10 })).toBe(0);
  });
  it('ducks while someone speaks, only when asked to', () => {
    expect(musicGain({ ...base, at: 5, speaking: true })).toBeCloseTo(0.2 * DUCK_GAIN);
    expect(musicGain({ ...base, at: 5, speaking: true, duck: false })).toBeCloseTo(0.2);
  });
});
