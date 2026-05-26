import { describe, it, expect } from 'vitest';
import { validateIntake } from './intake-validator';

describe('validateIntake', () => {
  it('reports missing required field with field path', () => {
    const intake = `# Client Intake — Test

## 1. Identity
- **REQUIRED:** Legal business name — Test LLC
- **REQUIRED:** Brand name (display) — Test Studio
- **REQUIRED:** URL slug (lowercase, hyphens) — test-studio
`;
    const result = validateIntake(intake);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('§1: missing REQUIRED field "Production domain"');
  });

  it('passes when every REQUIRED field has a non-empty value', () => {
    const intake = MINIMAL_VALID_INTAKE;
    const result = validateIntake(intake);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports value left as example placeholder', () => {
    const intake = MINIMAL_VALID_INTAKE.replace(
      'Legal business name — Test LLC',
      'Legal business name — e.g., `Gracie Barra Whittier LLC`',
    );
    const result = validateIntake(intake);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('Legal business name') && e.includes('placeholder'))).toBe(true);
  });
});

// Smallest intake that satisfies every required field. Update when intake template changes.
const MINIMAL_VALID_INTAKE = `# Client Intake — Test

## 1. Identity
- **REQUIRED:** Legal business name — Test LLC
- **REQUIRED:** Brand name (display) — Test Studio
- **REQUIRED:** URL slug (lowercase, hyphens) — test-studio
- **REQUIRED:** Production domain — teststudio.com

## 2. NAP
- **REQUIRED:** Street address + suite — 1 Test St
- **REQUIRED:** City — Testville
- **REQUIRED:** State (2-letter) — CA
- **REQUIRED:** Zip — 90000
- **REQUIRED:** Country (2-letter) — US
- **REQUIRED:** Phone display — (555) 555-0100
- **REQUIRED:** Phone tel: format — +15555550100
- **REQUIRED:** Public email — info@teststudio.com
- **REQUIRED:** Latitude — 34.0
- **REQUIRED:** Longitude — -118.0
- **REQUIRED:** Google Maps URL — https://maps.google.com/?cid=123
- **REQUIRED:** Google Business Profile place ID — ChIJTest
- **REQUIRED:** Hours per day — Mon-Fri 09:00-21:00

## 3. Brand
- **REQUIRED:** Logo SVG — horizontal/wide variant — https://cdn.test/logo-h.svg
- **REQUIRED:** Logo SVG — vertical/stacked variant — https://cdn.test/logo-v.svg
- **REQUIRED:** Logo SVG — icon-only variant — https://cdn.test/logo-i.svg
- **REQUIRED:** Favicon (SVG or PNG ≥192px) — https://cdn.test/favicon.svg
- **REQUIRED:** Primary color hex — #1b2a5e
- **REQUIRED:** Secondary color hex — #cc2200
- **REQUIRED:** Accent color hex — #ef9f27
- **REQUIRED:** Brand voice — welcoming, disciplined, family-first

## 9. GHL workspace
- **REQUIRED:** Sub-account ID (Location ID) — abc123
- **REQUIRED:** Private Integration Token (PIT) — pit-test-token
- **REQUIRED:** Whether pipelines already exist in this sub-account — no

## 10. Deploy
- **REQUIRED:** Vercel team/org name — test-org
- **REQUIRED:** Vercel project name preference — test-project
- **REQUIRED:** Production domain — teststudio.com
- **REQUIRED:** DNS access — operator-handles
- **REQUIRED:** Notification email for deploy events — ops@teststudio.com
`;
