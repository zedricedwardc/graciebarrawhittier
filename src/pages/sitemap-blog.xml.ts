/**
 * /sitemap-blog.xml — dynamic sitemap for blog posts.
 *
 * Blog posts are created at runtime through /admin/blog, so the build-time
 * sitemap (@astrojs/sitemap → sitemap-index.xml) can never include them; this
 * SSR route fills the gap and is referenced from public/robots.txt as a second
 * `Sitemap:` line. Backed by the tag-invalidated blog cache, so a publish or
 * delete shows up here in realtime; the CDN may serve it up to an hour stale
 * (s-maxage), which is well within sitemap freshness expectations.
 */
import type { APIRoute } from 'astro';
import { listAllPublishedForSitemap } from '../lib/ghl-blog';

export const prerender = false;

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
}

export const GET: APIRoute = async ({ site }) => {
  const origin = (site?.href ?? 'https://www.graciebarrawhittier.com/').replace(/\/$/, '');
  let posts: Array<{ slug: string; publishedAt: string }> = [];
  try {
    posts = await listAllPublishedForSitemap();
  } catch {
    posts = []; // an empty (valid) sitemap beats a 500 for crawlers
  }

  const urls = posts
    .map((p) => {
      const d = p.publishedAt ? new Date(p.publishedAt) : null;
      const lastmod = d && !Number.isNaN(d.getTime()) ? `<lastmod>${d.toISOString()}</lastmod>` : '';
      return `<url><loc>${origin}/blog/${xmlEscape(p.slug)}/</loc>${lastmod}</url>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
