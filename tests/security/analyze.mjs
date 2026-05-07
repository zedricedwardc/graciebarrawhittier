import * as fs from 'fs';
import * as path from 'path';

const DIR = path.resolve('test-results/security');
const files = fs.readdirSync(DIR).filter((f) => f.startsWith('network-') && f.endsWith('.json'));

const all = [];
for (const f of files) {
  const arr = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const r of arr) all.push(r);
}

const findings = [];
const origins = new Set();
const tokenLike = /(bearer\s+[\w.\-]+|pit-[\w.\-]+|^eyJ[\w.\-]{10,}|sk_[\w]{6,}|pk_[\w]{6,})/i;
const piiKeys = ['email', 'phone', 'firstname', 'lastname', 'first_name', 'last_name', 'fullname', 'tel'];

for (const r of all) {
  let url;
  try { url = new URL(r.url); } catch { continue; }
  origins.add(url.origin);

  // HIGH: Auth/token headers from browser
  const sensitiveHeaders = ['authorization', 'x-api-key', 'pit', 'x-pit', 'x-auth', 'x-token'];
  for (const [hk, hv] of Object.entries(r.requestHeaders ?? {})) {
    const lk = hk.toLowerCase();
    if (sensitiveHeaders.includes(lk)) {
      findings.push({ sev: 'HIGH', cat: 'auth-header', msg: `Request header ${hk} sent from browser`, ev: `${r.method} ${r.url} | ${hk}: ${String(hv).slice(0, 30)}...`, page: r.fromPage });
    }
    if (typeof hv === 'string' && tokenLike.test(hv) && lk !== 'user-agent' && lk !== 'cookie' && lk !== 'sec-ch-ua' && lk !== 'referer' && !lk.startsWith(':')) {
      findings.push({ sev: 'HIGH', cat: 'token-shape', msg: `Token-shaped value in request header ${hk}`, ev: `${r.method} ${r.url} | ${hk}: ${String(hv).slice(0, 40)}...`, page: r.fromPage });
    }
  }

  // HIGH: GHL server-only API paths from browser
  if (url.hostname.endsWith('leadconnectorhq.com')) {
    if (/(\/calendars\/|\/contacts\/|\/conversations\/|\/locations\/[^/]+\/(contacts|conversations|appointments))/.test(url.pathname)) {
      findings.push({ sev: 'HIGH', cat: 'ghl-server-api', msg: 'GHL server-only API path called from browser', ev: `${r.method} ${r.url}`, page: r.fromPage });
    }
  }

  // HIGH: HTTP (non-HTTPS) request
  if (url.protocol === 'http:') {
    findings.push({ sev: 'HIGH', cat: 'mixed-content', msg: 'Non-HTTPS request (mixed content)', ev: `${r.method} ${r.url}`, page: r.fromPage });
  }

  // MEDIUM: PII in querystring/path of third-party request
  const isThirdParty = !/graciebarrawebsite\.vercel\.app$/.test(url.hostname) && !url.hostname.endsWith('graciebarrawhittier.com');
  if (isThirdParty) {
    const params = url.searchParams;
    for (const k of piiKeys) {
      if (params.has(k) && params.get(k)) {
        findings.push({ sev: 'MEDIUM', cat: 'pii-in-url', msg: `PII parameter "${k}" sent to third-party`, ev: `${r.method} ${url.origin}${url.pathname}?${k}=...`, page: r.fromPage });
      }
    }
    // Heuristic: email-shaped in URL
    if (/[\w.+-]+@[\w.-]+\.\w{2,}/.test(r.url)) {
      findings.push({ sev: 'MEDIUM', cat: 'pii-in-url', msg: 'Email-shaped string in third-party URL', ev: r.url.slice(0, 200), page: r.fromPage });
    }
    // Heuristic: phone digits in path
    if (/\b\d{10,}\b/.test(url.pathname)) {
      findings.push({ sev: 'LOW', cat: 'digits-in-path', msg: 'Long digit run in third-party URL path (possible phone/id)', ev: r.url.slice(0, 200), page: r.fromPage });
    }
  }
}

// MEDIUM: third-party origins not on expected list
const expected = [
  /graciebarrawebsite\.vercel\.app$/,
  /graciebarrawhittier\.com$/,
  /^vercel\.com$/, /vercel\.app$/, /vercel-insights\.com$/, /\.vercel-scripts\.com$/,
  /googletagmanager\.com$/, /google-analytics\.com$/, /\.g\.doubleclick\.net$/, /doubleclick\.net$/,
  /gstatic\.com$/, /googleapis\.com$/, /fonts\.googleapis\.com$/,
  /leadconnectorhq\.com$/, /msgsndr\.com$/, /gohighlevel\.com$/, /\.cloudfront\.net$/,
  /facebook\.com$/, /facebook\.net$/,
];
const unexpectedOrigins = [...origins].filter((o) => {
  try {
    const h = new URL(o).hostname;
    return !expected.some((re) => re.test(h));
  } catch { return false; }
});
for (const o of unexpectedOrigins) {
  findings.push({ sev: 'MEDIUM', cat: 'unexpected-origin', msg: 'Third-party origin not on expected allowlist', ev: o, page: 'multiple' });
}

// LOW: missing security headers on main page document
const mainDocs = all.filter((r) => r.resourceType === 'document' && (r.url.endsWith(r.fromPage) || r.url.endsWith(r.fromPage + '/') || (r.fromPage === '/' && new URL(r.url).pathname === '/')));
const seenPages = new Set();
for (const d of mainDocs) {
  if (seenPages.has(d.fromPage)) continue;
  seenPages.add(d.fromPage);
  const rh = Object.fromEntries(Object.entries(d.responseHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const checks = [
    ['strict-transport-security', 'HSTS'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['referrer-policy', 'Referrer-Policy'],
    ['content-security-policy', 'CSP'],
    ['x-frame-options', 'X-Frame-Options'],
  ];
  for (const [hk, label] of checks) {
    if (!rh[hk]) {
      findings.push({ sev: 'LOW', cat: 'missing-header', msg: `Missing ${label} on ${d.fromPage}`, ev: `${d.url} (status ${d.status})`, page: d.fromPage });
    }
  }
}

// Dedupe
const seen = new Set();
const dedup = [];
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
  findings: dedup,
  pages: [...new Set(all.map((r) => r.fromPage))],
};

fs.writeFileSync(path.join(DIR, 'analysis.json'), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
