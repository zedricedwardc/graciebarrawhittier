/**
 * Post-capture analyzer. Reads test-results/security/network-*.json and writes analysis.json.
 * Implemented as a Playwright test so it runs through the existing tooling.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('analyze captured network data', async () => {
  const DIR = path.resolve(process.cwd(), 'test-results', 'security');
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith('network-') && f.endsWith('.json'));

  const all: any[] = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const r of arr) all.push(r);
  }

  const findings: any[] = [];
  const origins = new Set<string>();
  const tokenLike = /(bearer\s+[\w.\-]+|pit-[\w.\-]+|^eyJ[\w.\-]{10,}|sk_[\w]{6,}|pk_live[\w_]{6,})/i;
  const piiKeys = ['email', 'phone', 'firstname', 'lastname', 'first_name', 'last_name', 'fullname', 'tel'];

  for (const r of all) {
    let url: URL;
    try { url = new URL(r.url); } catch { continue; }
    origins.add(url.origin);

    const sensitiveHeaders = ['authorization', 'x-api-key', 'pit', 'x-pit', 'x-auth', 'x-token'];
    for (const [hk, hv] of Object.entries(r.requestHeaders ?? {})) {
      const lk = hk.toLowerCase();
      if (sensitiveHeaders.includes(lk)) {
        findings.push({ sev: 'HIGH', cat: 'auth-header', msg: `Request header ${hk} sent from browser`, ev: `${r.method} ${r.url} | ${hk}: ${String(hv).slice(0, 30)}...`, page: r.fromPage });
      }
      if (typeof hv === 'string' && tokenLike.test(hv) && !['user-agent','cookie','sec-ch-ua','referer'].includes(lk) && !lk.startsWith(':')) {
        findings.push({ sev: 'HIGH', cat: 'token-shape', msg: `Token-shaped value in request header ${hk}`, ev: `${r.method} ${r.url} | ${hk}: ${String(hv).slice(0, 40)}...`, page: r.fromPage });
      }
    }

    if (url.hostname.endsWith('leadconnectorhq.com')) {
      if (/(\/calendars\/|\/contacts\/|\/conversations\/|\/locations\/[^/]+\/(contacts|conversations|appointments))/.test(url.pathname)) {
        findings.push({ sev: 'HIGH', cat: 'ghl-server-api', msg: 'GHL server-only API path called from browser', ev: `${r.method} ${r.url}`, page: r.fromPage });
      }
    }

    if (url.protocol === 'http:') {
      findings.push({ sev: 'HIGH', cat: 'mixed-content', msg: 'Non-HTTPS request (mixed content)', ev: `${r.method} ${r.url}`, page: r.fromPage });
    }

    const isThirdParty = !/graciebarrawebsite\.vercel\.app$/.test(url.hostname) && !url.hostname.endsWith('graciebarrawhittier.com');
    if (isThirdParty) {
      const params = url.searchParams;
      for (const k of piiKeys) {
        if (params.has(k) && params.get(k)) {
          findings.push({ sev: 'MEDIUM', cat: 'pii-in-url', msg: `PII parameter "${k}" sent to third-party`, ev: `${r.method} ${url.origin}${url.pathname}?${k}=...`, page: r.fromPage });
        }
      }
      if (/[\w.+-]+@[\w.-]+\.\w{2,}/.test(r.url)) {
        findings.push({ sev: 'MEDIUM', cat: 'pii-in-url', msg: 'Email-shaped string in third-party URL', ev: r.url.slice(0, 200), page: r.fromPage });
      }
    }
  }

  const expected = [
    /graciebarrawebsite\.vercel\.app$/,
    /graciebarrawhittier\.com$/,
    /^vercel\.com$/, /vercel\.app$/, /vercel-insights\.com$/, /\.vercel-scripts\.com$/, /vercel-scripts\.com$/,
    /googletagmanager\.com$/, /google-analytics\.com$/, /doubleclick\.net$/,
    /gstatic\.com$/, /googleapis\.com$/, /google\.com$/,
    /leadconnectorhq\.com$/, /msgsndr\.com$/, /gohighlevel\.com$/, /\.cloudfront\.net$/, /cloudfront\.net$/,
    /facebook\.com$/, /facebook\.net$/, /fbcdn\.net$/,
    /gocdn\.in$/, // common GHL CDN
  ];
  const unexpectedOrigins: string[] = [];
  for (const o of origins) {
    try {
      const h = new URL(o).hostname;
      if (!expected.some((re) => re.test(h))) unexpectedOrigins.push(o);
    } catch { /* ignore */ }
  }
  for (const o of unexpectedOrigins) {
    findings.push({ sev: 'MEDIUM', cat: 'unexpected-origin', msg: 'Third-party origin not on expected allowlist', ev: o, page: 'multiple' });
  }

  // Find the main HTML document for each page
  const seenPages = new Set<string>();
  const sortedDocs = all.filter((r) => r.resourceType === 'document').sort((a: any, b: any) => 0);
  for (const d of sortedDocs) {
    if (seenPages.has(d.fromPage)) continue;
    let u: URL; try { u = new URL(d.url); } catch { continue; }
    const expectedPath = d.fromPage === '/' ? '/' : d.fromPage;
    if (u.pathname !== expectedPath && u.pathname !== expectedPath + '/') continue;
    if (!u.hostname.endsWith('graciebarrawebsite.vercel.app')) continue;
    seenPages.add(d.fromPage);
    const rh: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.responseHeaders ?? {})) rh[k.toLowerCase()] = v as string;
    const checks: [string, string][] = [
      ['strict-transport-security', 'HSTS (Strict-Transport-Security)'],
      ['x-content-type-options', 'X-Content-Type-Options: nosniff'],
      ['referrer-policy', 'Referrer-Policy'],
      ['content-security-policy', 'Content-Security-Policy'],
      ['x-frame-options', 'X-Frame-Options'],
      ['permissions-policy', 'Permissions-Policy'],
    ];
    for (const [hk, label] of checks) {
      if (!rh[hk]) {
        findings.push({ sev: 'LOW', cat: 'missing-header', msg: `Missing ${label} on ${d.fromPage}`, ev: `${d.url} (status ${d.status})`, page: d.fromPage });
      }
    }
  }

  // Dedupe
  const seen = new Set<string>();
  const dedup: any[] = [];
  for (const f of findings) {
    const k = `${f.sev}|${f.cat}|${f.msg}|${f.ev}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(f);
  }

  const output = {
    totalRequests: all.length,
    origins: [...origins].sort(),
    unexpectedOrigins,
    pages: [...new Set(all.map((r) => r.fromPage))],
    findings: dedup,
  };

  fs.writeFileSync(path.join(DIR, 'analysis.json'), JSON.stringify(output, null, 2));
  console.log('[analysis] total=' + all.length + ' findings=' + dedup.length + ' origins=' + origins.size);
  console.log('ORIGINS:', JSON.stringify([...origins].sort()));
  console.log('FINDINGS:', JSON.stringify(dedup, null, 2));
});
