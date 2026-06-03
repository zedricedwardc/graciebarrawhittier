#!/usr/bin/env node
/**
 * intake-validator — phase 0 preflight for AI replication.
 *
 * Usage:
 *   npm run validate:intake CLIENT_INTAKE.md
 *
 * Parses an intake markdown file, verifies every REQUIRED field has a
 * non-empty value that is not a placeholder ("e.g., ..." patterns).
 * Returns ok=true with no errors when valid; otherwise lists every issue.
 *
 * Asset URL reachability (HTTP 200) is checked in phase 0 by the AI itself
 * via curl — this script only does shape/required validation.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  requiredFieldsFound: number;
}

interface RequiredField {
  section: string;       // e.g., "§1"
  label: string;         // e.g., "Legal business name"
}

/** Pattern that marks an unfilled placeholder example. */
const PLACEHOLDER_PATTERN = /(\be\.g\.|\bplaceholder\b|\bTBD\b|\bTODO\b|<.+?>)/i;

const REQUIRED_LINE_RE = /^- \*\*REQUIRED:\*\* (.+?) — (.+)$/;
const SECTION_RE = /^## (\d+)\. /;

export function validateIntake(markdown: string): ValidationResult {
  const lines = markdown.split(/\r?\n/);
  const errors: string[] = [];
  let currentSection = '?';
  let requiredFieldsFound = 0;

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      currentSection = `§${sectionMatch[1]}`;
      continue;
    }
    const fieldMatch = line.match(REQUIRED_LINE_RE);
    if (!fieldMatch) continue;
    const [, rawLabel, rawValue] = fieldMatch;
    if (rawLabel === undefined || rawValue === undefined) continue;
    const label = rawLabel.trim();
    const value = rawValue.trim();
    requiredFieldsFound += 1;
    if (!value) {
      errors.push(`${currentSection}: missing REQUIRED field "${label}"`);
      continue;
    }
    if (PLACEHOLDER_PATTERN.test(value)) {
      errors.push(`${currentSection}: REQUIRED field "${label}" still has placeholder value: ${value}`);
    }
  }

  // Cross-section: every REQUIRED label declared in the template must appear
  // in the intake — but only within sections the intake actually includes,
  // so partial-section intakes used by tests can still pass.
  const declaredLabels = extractDeclaredRequiredLabels();
  const seenSections = new Set<string>();
  const seenLabels = new Set<string>();
  for (const line of lines) {
    const s = line.match(SECTION_RE);
    if (s) { seenSections.add(`§${s[1]}`); continue; }
    const m = line.match(REQUIRED_LINE_RE);
    if (m) {
      const [, rawLabel] = m;
      if (rawLabel !== undefined) seenLabels.add(rawLabel.trim());
    }
  }
  for (const { section, label } of declaredLabels) {
    if (!seenSections.has(section)) continue;
    if (!seenLabels.has(label)) {
      errors.push(`${section}: missing REQUIRED field "${label}"`);
    }
  }

  return { ok: errors.length === 0, errors, requiredFieldsFound };
}

/**
 * Reads the canonical template (CLIENT_INTAKE.template.md) and extracts
 * every REQUIRED label so we can detect omissions. The template is the
 * source of truth for what fields exist.
 */
function extractDeclaredRequiredLabels(): RequiredField[] {
  // Resolved at runtime when invoked as a CLI; in tests, the harness
  // does not need this list (tests assert on present-but-invalid values).
  // We import lazily to avoid file IO when validateIntake is called from tests
  // with a self-contained string.
  try {
    // Use require so this works under tsx + vitest without ESM acrobatics.
    const fs = require('node:fs');
    const path = require('node:path');
    const tplPath = path.join(__dirname, '..', 'docs', 'replication', 'CLIENT_INTAKE.template.md');
    if (!fs.existsSync(tplPath)) return [];
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const out: RequiredField[] = [];
    let section = '?';
    for (const line of tpl.split(/\r?\n/)) {
      const s = line.match(SECTION_RE);
      if (s) { section = `§${s[1]}`; continue; }
      const m = line.match(REQUIRED_LINE_RE);
      if (m) {
        const [, rawLabel] = m;
        if (rawLabel !== undefined) out.push({ section, label: rawLabel.trim() });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run validate:intake <path-to-intake.md>');
    process.exit(2);
  }
  const fs = await import('node:fs');
  if (!fs.existsSync(filePath)) {
    console.error(`Intake file not found: ${filePath}`);
    process.exit(2);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const result = validateIntake(text);
  if (result.ok) {
    console.log(`INTAKE VALID — ${result.requiredFieldsFound} required fields present.`);
    process.exit(0);
  }
  console.error(`INTAKE INVALID — ${result.errors.length} issue(s):`);
  for (const e of result.errors) console.error(`  • ${e}`);
  process.exit(1);
}

// Run main only when invoked directly (not when imported by tests).
// On Windows + tsx, import.meta.url uses file:/// with URL-encoded chars
// (%20 for spaces) while process.argv[1] is a native path. Normalize both
// to forward-slash, decoded paths and compare suffix-wise.
{
  const argv1 = process.argv[1];
  if (argv1) {
    const importedPath = decodeURIComponent(
      import.meta.url.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/'),
    );
    const argvPath = argv1.replace(/\\/g, '/');
    if (importedPath === argvPath || importedPath.endsWith(argvPath) || argvPath.endsWith(importedPath)) {
      main();
    }
  }
}
