import { describe, it, expect } from 'vitest';
import {
  parseBlogListParams,
  paginatePosts,
  BLOG_PER_PAGE,
  type BlogSort,
} from './blog-pagination';

/** Build n fake posts, newest-first: p1 is the newest, pn the oldest. */
function makePosts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    publishedAt: new Date(Date.UTC(2026, 0, n - i)).toISOString(),
  }));
}

describe('parseBlogListParams', () => {
  const parse = (qs: string) => parseBlogListParams(new URLSearchParams(qs));

  it('defaults to newest / page 1 with no params', () => {
    expect(parse('')).toEqual({ sort: 'newest', page: 1 });
  });

  it("accepts sort=oldest only when it is exactly 'oldest'", () => {
    expect(parse('sort=oldest').sort).toBe('oldest');
    expect(parse('sort=Oldest').sort).toBe('newest');
    expect(parse('sort=oldest ').sort).toBe('newest');
    expect(parse('sort=asc').sort).toBe('newest');
    expect(parse('sort=newest').sort).toBe('newest');
    expect(parse('sort=').sort).toBe('newest');
  });

  it('parses a positive integer page', () => {
    expect(parse('page=1').page).toBe(1);
    expect(parse('page=7').page).toBe(7);
  });

  it('falls back to page 1 on garbage, zero, negative, and non-integer values', () => {
    expect(parse('page=banana').page).toBe(1);
    expect(parse('page=0').page).toBe(1);
    expect(parse('page=-3').page).toBe(1);
    expect(parse('page=2.5').page).toBe(1);
    expect(parse('page=NaN').page).toBe(1);
    expect(parse('page=').page).toBe(1);
  });

  it('parses both params together', () => {
    expect(parse('sort=oldest&page=3')).toEqual({ sort: 'oldest', page: 3 });
  });
});

describe('paginatePosts — sort direction', () => {
  it('keeps newest-first order for sort=newest', () => {
    const posts = makePosts(3);
    const { pagePosts } = paginatePosts(posts, { sort: 'newest', page: 1 });
    expect(pagePosts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('reverses to oldest-first for sort=oldest', () => {
    const posts = makePosts(3);
    const { pagePosts } = paginatePosts(posts, { sort: 'oldest', page: 1 });
    expect(pagePosts.map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
  });

  it('does not mutate the input array when reversing', () => {
    const posts = makePosts(3);
    const before = posts.map((p) => p.id);
    paginatePosts(posts, { sort: 'oldest', page: 1 });
    expect(posts.map((p) => p.id)).toEqual(before);
  });

  it('echoes the sort back in the result', () => {
    for (const sort of ['newest', 'oldest'] as BlogSort[]) {
      expect(paginatePosts(makePosts(2), { sort, page: 1 }).sort).toBe(sort);
    }
  });
});

describe('paginatePosts — slicing', () => {
  it('defaults to 9 per page (BLOG_PER_PAGE)', () => {
    expect(BLOG_PER_PAGE).toBe(9);
    const { pagePosts } = paginatePosts(makePosts(27), { sort: 'newest', page: 1 });
    expect(pagePosts).toHaveLength(9);
    expect(pagePosts[0]!.id).toBe('p1');
    expect(pagePosts[8]!.id).toBe('p9');
  });

  it('slices the middle page correctly', () => {
    const { pagePosts, page } = paginatePosts(makePosts(27), { sort: 'newest', page: 2 });
    expect(page).toBe(2);
    expect(pagePosts.map((p) => p.id)).toEqual([
      'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16', 'p17', 'p18',
    ]);
  });

  it('returns a partial final page', () => {
    const { pagePosts, totalPages } = paginatePosts(makePosts(10), { sort: 'newest', page: 2 });
    expect(totalPages).toBe(2);
    expect(pagePosts.map((p) => p.id)).toEqual(['p10']);
  });

  it('respects a custom perPage', () => {
    const { pagePosts, totalPages } = paginatePosts(makePosts(5), {
      sort: 'newest',
      page: 2,
      perPage: 2,
    });
    expect(totalPages).toBe(3);
    expect(pagePosts.map((p) => p.id)).toEqual(['p3', 'p4']);
  });

  it('slices pages of the reversed list for sort=oldest', () => {
    const { pagePosts } = paginatePosts(makePosts(10), { sort: 'oldest', page: 2 });
    expect(pagePosts.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('paginatePosts — clamping', () => {
  it('clamps an out-of-range high page to the last page', () => {
    const { page, pagePosts, totalPages } = paginatePosts(makePosts(10), {
      sort: 'newest',
      page: 99,
    });
    expect(totalPages).toBe(2);
    expect(page).toBe(2);
    expect(pagePosts.map((p) => p.id)).toEqual(['p10']);
  });

  it('clamps page below 1 up to 1', () => {
    const { page, pagePosts } = paginatePosts(makePosts(10), { sort: 'newest', page: 0 });
    expect(page).toBe(1);
    expect(pagePosts).toHaveLength(9);
  });
});

describe('paginatePosts — totalPages', () => {
  it.each([
    [0, 1],
    [1, 1],
    [9, 1],
    [10, 2],
    [27, 3],
  ])('%i posts → %i total pages', (count, expected) => {
    const { totalPages } = paginatePosts(makePosts(count), { sort: 'newest', page: 1 });
    expect(totalPages).toBe(expected);
  });

  it('returns an empty page 1 of 1 for zero posts', () => {
    const result = paginatePosts([], { sort: 'newest', page: 5 });
    expect(result).toEqual({ pagePosts: [], page: 1, totalPages: 1, sort: 'newest' });
  });
});
