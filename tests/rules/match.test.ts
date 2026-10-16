import { describe, expect, it } from 'vitest';
import { lineScoreInnings, ordinal } from '../../src/rules/match';

describe('line score columns', () => {
  it('shows the regulation innings until the game goes past them', () => {
    expect(lineScoreInnings(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(lineScoreInnings(9, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('grows a column for each extra inning', () => {
    expect(lineScoreInnings(11, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keeps the latest innings once past the column limit', () => {
    expect(lineScoreInnings(14, 9, 12)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(lineScoreInnings(5, 9, 12)).toHaveLength(9);
  });
});

describe('ordinal', () => {
  it('names innings as a broadcaster would', () => {
    expect([1, 2, 3, 4, 9, 10, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '9th',
      '10th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '111th',
    ]);
  });
});
