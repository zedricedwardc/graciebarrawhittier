import { describe, it, expect } from 'vitest';
import { homepageFaqs } from './faqs';

describe('homepageFaqs', () => {
  it('contains 8 items', () => {
    expect(homepageFaqs).toHaveLength(8);
  });

  it('every item has a non-empty question and answer', () => {
    for (const item of homepageFaqs) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the four brief-mandated expansion questions', () => {
    const questions = homepageFaqs.map((f) => f.question);
    expect(questions).toContain('How much do classes cost at Gracie Barra Whittier?');
    expect(questions).toContain('What age groups do you offer classes for?');
    expect(questions).toContain('Do I need any experience to start?');
    expect(questions).toContain('Where is Gracie Barra Whittier located?');
  });

  it('preserves the four "keep existing" questions', () => {
    const questions = homepageFaqs.map((f) => f.question);
    expect(questions).toContain('What Makes Gracie Barra Whittier Different?');
    expect(questions).toContain('Is jiu-jitsu safe for beginners?');
    expect(questions).toContain('What should I expect in my first class?');
    expect(questions).toContain('Do you offer programs for both kids & adults?');
  });

  it('orders the four "keep existing" questions before the four new questions', () => {
    const questions = homepageFaqs.map((f) => f.question);
    expect(questions.slice(0, 4)).toEqual([
      'What Makes Gracie Barra Whittier Different?',
      'Is jiu-jitsu safe for beginners?',
      'What should I expect in my first class?',
      'Do you offer programs for both kids & adults?',
    ]);
    expect(questions.slice(4, 8)).toEqual([
      'How much do classes cost at Gracie Barra Whittier?',
      'What age groups do you offer classes for?',
      'Do I need any experience to start?',
      'Where is Gracie Barra Whittier located?',
    ]);
  });
});
