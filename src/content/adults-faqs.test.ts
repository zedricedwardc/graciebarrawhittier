import { describe, it, expect } from 'vitest';
import { adultsFaqs } from './adults-faqs';

describe('adultsFaqs', () => {
  it('contains exactly 9 items', () => {
    expect(adultsFaqs).toHaveLength(9);
  });

  it('every item has a non-empty question and answer', () => {
    for (const item of adultsFaqs) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains the four brief-mandated adults questions in order', () => {
    expect(adultsFaqs.slice(0, 4).map((f) => f.question)).toEqual([
      'Am I too old to start BJJ?',
      'Do I need to be fit to start?',
      'Is adult BJJ dangerous?',
      'How quickly will I progress?',
    ]);
  });
});
