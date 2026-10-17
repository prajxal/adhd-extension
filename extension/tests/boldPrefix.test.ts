import { describe, expect, it } from 'vitest';
import { boldLength, boldPrefix, type Segment } from '@/src/modes/boldPrefix';

const I = 0.45;

/** Renders segments as "**bold**plain" for readable assertions. */
function show(segments: Segment[]): string {
  return segments.map((s) => (s.bold ? `**${s.text}**` : s.text)).join('');
}

describe('boldLength', () => {
  it('bolds one letter for words of 3 or fewer', () => {
    expect(boldLength(1, I)).toBe(1);
    expect(boldLength(2, I)).toBe(1);
    expect(boldLength(3, I)).toBe(1);
  });

  it('uses ceil(n * intensity) for longer words', () => {
    expect(boldLength(7, I)).toBe(4);
    expect(boldLength(13, I)).toBe(6);
  });

  it('never bolds the whole word when n >= 2', () => {
    for (const intensity of [0.3, 0.45, 0.6]) {
      for (let n = 2; n <= 40; n++) {
        expect(boldLength(n, intensity)).toBeLessThan(n);
      }
    }
  });
});

describe('boldPrefix', () => {
  it('handles short words', () => {
    expect(show(boldPrefix('a cat sat', I))).toBe('**a** **c**at **s**at');
  });

  it('handles long words', () => {
    expect(show(boldPrefix('reading extraordinary', I))).toBe('**read**ing **extrao**rdinary');
  });

  it('keeps apostrophes inside the word', () => {
    expect(show(boldPrefix("don't", I))).toBe("**don**'t");
    expect(show(boldPrefix('it’s', I))).toBe('**it**’s');
  });

  it('treats hyphenated words as one word', () => {
    expect(show(boldPrefix('well-known', I))).toBe('**well-**known');
  });

  it('handles non-English letters', () => {
    expect(show(boldPrefix('café naïve', I))).toBe('**ca**fé **naï**ve');
    expect(show(boldPrefix('Größe', I))).toBe('**Grö**ße');
  });

  it('keeps combining marks with their letter', () => {
    const decomposed = 'cafe\u0301'; // "café" with a combining acute accent
    const segments = boldPrefix(decomposed, I);
    expect(segments[0]).toEqual({ text: 'ca', bold: true });
    expect(segments.map((s) => s.text).join('')).toBe(decomposed);
  });

  it('leaves numbers and symbols untouched', () => {
    expect(boldPrefix('123 4.5% $20', I)).toEqual([{ text: '123 4.5% $20', bold: false }]);
    expect(show(boldPrefix('in 2024, 45% rose', I))).toBe('**i**n 2024, 45% **ro**se');
  });

  it('respects intensity', () => {
    expect(show(boldPrefix('understanding', 0.3))).toBe('**unde**rstanding');
    expect(show(boldPrefix('understanding', 0.6))).toBe('**understa**nding');
  });

  it('round-trips any input exactly', () => {
    const samples = ['', '   ', 'Hello, world!', "l'été — 3 o’clock", 'x\ny\tz', '日本語 text', '🙂 emoji ok'];
    for (const text of samples) {
      expect(boldPrefix(text, I).map((s) => s.text).join('')).toBe(text);
    }
  });

  it('returns a single plain segment when there are no letters', () => {
    expect(boldPrefix('  42  ', I)).toEqual([{ text: '  42  ', bold: false }]);
    expect(boldPrefix('', I)).toEqual([]);
  });
});
