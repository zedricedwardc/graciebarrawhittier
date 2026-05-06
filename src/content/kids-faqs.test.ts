import { describe, it, expect } from 'vitest';
import { kidsFaqs } from './kids-faqs';

describe('kidsFaqs', () => {
  it('contains exactly 4 items', () => {
    expect(kidsFaqs).toHaveLength(4);
  });

  it('every item has a non-empty question and answer', () => {
    for (const item of kidsFaqs) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains the four brief-mandated kids questions in order', () => {
    expect(kidsFaqs.map((f) => f.question)).toEqual([
      'Is jiu-jitsu safe for young children?',
      'What if my child is shy or nervous?',
      'Will my child get hurt?',
      "How do I know which program is right for my child's age?",
    ]);
  });

  it('answers reference the program names where appropriate', () => {
    expect(kidsFaqs[0]!.answer).toMatch(/Tiny Champions|Little Champions/);
    expect(kidsFaqs[3]!.answer).toMatch(/Tiny Champions|Little Champions|Juniors/);
  });
});
