/**
 * blog-pagination — pure helpers for the /blog index: query-param parsing,
 * sort direction, and page slicing. No I/O; fully unit-testable.
 *
 * Input posts are expected newest-first (the lib/ghl-blog contract for
 * listAllPublishedPosts), so 'newest' is a passthrough and 'oldest' is a
 * reversed copy (never mutates the input array).
 */

export type BlogSort = 'newest' | 'oldest';

export interface PaginatedPosts<T> {
  pagePosts: T[];
  page: number;
  totalPages: number;
  sort: BlogSort;
}

/** Posts per blog index page. */
export const BLOG_PER_PAGE = 9;

/**
 * Parse ?sort= and ?page= from the blog index URL.
 * - sort: 'oldest' only when the param is exactly 'oldest'; anything else → 'newest'.
 * - page: positive integer, else 1 (missing/NaN/0/negative/garbage all → 1).
 */
export function parseBlogListParams(searchParams: URLSearchParams): {
  sort: BlogSort;
  page: number;
} {
  const sort: BlogSort = searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';

  const rawPage = searchParams.get('page');
  const parsed = rawPage === null ? NaN : Number(rawPage);
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;

  return { sort, page };
}

/**
 * Sort (by direction) and slice a newest-first post list into one page.
 * totalPages is always >= 1 (an empty list still renders "page 1 of 1"),
 * and the requested page is clamped into [1, totalPages].
 */
export function paginatePosts<T extends { publishedAt: string }>(
  posts: T[],
  opts: { sort: BlogSort; page: number; perPage?: number }
): PaginatedPosts<T> {
  const perPage = opts.perPage ?? BLOG_PER_PAGE;
  const ordered = opts.sort === 'oldest' ? [...posts].reverse() : posts;

  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
  const page = Math.min(Math.max(1, opts.page), totalPages);

  const start = (page - 1) * perPage;
  const pagePosts = ordered.slice(start, start + perPage);

  return { pagePosts, page, totalPages, sort: opts.sort };
}
