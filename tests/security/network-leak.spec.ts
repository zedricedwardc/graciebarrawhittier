/**
 * Network leak scanner.
 * Loads a curated list of pages, captures every outbound network request and response,
 * and persists raw evidence for downstream finding generation.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.resolve(process.cwd(), 'test-results', 'security');

type ReqRecord = {
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  postDataPreview?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  fromPage: string;
  failed?: string;
};

const PAGES = ['/', '/kickstart', '/contact', '/adults-jiu-jitsu', '/kids-martial-arts', '/reviews', '/privacy'];

test.describe.configure({ mode: 'serial' });

for (const route of PAGES) {
  const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/[\/?#]/g, '_');

  test(`capture network on ${route}`, async ({ page }) => {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const records: Map<string, ReqRecord> = new Map();
    const order: string[] = [];

    page.on('request', (req) => {
      const key = `${req.method()} ${req.url()} ${order.length}`;
      order.push(key);
      let postDataPreview: string | undefined;
      try {
        const pd = req.postData();
        if (pd) postDataPreview = pd.length > 2000 ? pd.slice(0, 2000) + '...[truncated]' : pd;
      } catch { /* ignore */ }
      records.set(key, {
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        requestHeaders: req.headers(),
        postDataPreview,
        fromPage: route,
      });
    });

    page.on('response', async (res) => {
      const url = res.url();
      const method = res.request().method();
      // Find latest matching request without a status set
      for (let i = order.length - 1; i >= 0; i--) {
        const k = order[i];
        if (k === undefined) continue;
        if (k.startsWith(`${method} ${url} `)) {
          const rec = records.get(k);
          if (rec && rec.status === undefined) {
            rec.status = res.status();
            rec.statusText = res.statusText();
            try {
              rec.responseHeaders = await res.allHeaders();
            } catch {
              rec.responseHeaders = res.headers();
            }
            break;
          }
        }
      }
    });

    page.on('requestfailed', (req) => {
      for (let i = order.length - 1; i >= 0; i--) {
        const k = order[i];
        if (k === undefined) continue;
        if (k.startsWith(`${req.method()} ${req.url()} `)) {
          const rec = records.get(k);
          if (rec) {
            rec.failed = req.failure()?.errorText ?? 'failed';
            break;
          }
        }
      }
    });

    try {
      await page.goto(route, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      // Some pages keep long-poll connections open; fall back to domcontentloaded
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
    }
    // Allow late beacons (analytics) to fire
    await page.waitForTimeout(3000);

    const out: ReqRecord[] = order.map((k) => records.get(k)!).filter(Boolean);
    const file = path.join(OUT_DIR, `network-${slug}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[network-leak] ${route}: captured ${out.length} requests -> ${file}`);
  });
}
