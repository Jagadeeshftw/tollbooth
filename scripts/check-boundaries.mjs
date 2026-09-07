#!/usr/bin/env node
/**
 * Enforces the dependency seams between packages.
 *
 * @tollbooth/core is the model. If it ever imports a payment provider or MCP,
 * adding a second provider stops being a matter of writing a new package and
 * starts being a refactor of the model. That is the whole reason the seam
 * exists, so it is checked in CI rather than left to reviewer memory.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/** @type {{pkg: string, allow: 'node-and-relative-only' | string[], reason: string}[]} */
const RULES = [
  {
    pkg: 'core',
    allow: 'node-and-relative-only',
    reason:
      'core is the model: no payment provider, no MCP, no third-party runtime dependency',
  },
  {
    pkg: 'store-sqlite',
    allow: ['@tollbooth/core', 'better-sqlite3'],
    reason: 'a store binds the model to one database and nothing else',
  },
  {
    pkg: 'store-postgres',
    allow: ['@tollbooth/core', 'pg'],
    reason: 'a store binds the model to one database and nothing else',
  },
  {
    pkg: 'store-conformance',
    allow: ['@tollbooth/core'],
    reason: 'the conformance suite tests the model contract, not any one backend',
  },
  {
    pkg: 'mcp',
    allow: ['@tollbooth/core', '@modelcontextprotocol/sdk', 'zod'],
    reason:
      'the MCP binding must not depend on a payment provider; it talks to a PaymentProvider',
  },
  {
    pkg: 'moove',
    allow: ['@tollbooth/core'],
    reason: 'a provider binding must not depend on MCP; it is reusable over plain HTTP',
  },
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|mts|js|mjs)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * Strip comments before scanning. Without this, prose containing the word
 * `from` followed by a quoted phrase reads as an import and trips the check.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function specifiersIn(source) {
  const code = stripComments(source);
  const found = new Set();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) found.add(m[1]);
  }
  return [...found];
}

function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../');
}

function isNodeBuiltin(spec) {
  return spec.startsWith('node:');
}

const violations = [];

for (const rule of RULES) {
  const srcDir = join(ROOT, 'packages', rule.pkg, 'src');
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, 'utf8');
    for (const spec of specifiersIn(source)) {
      if (isRelative(spec) || isNodeBuiltin(spec)) continue;
      const allowed = rule.allow === 'node-and-relative-only' ? [] : rule.allow;
      const ok = allowed.some((a) => spec === a || spec.startsWith(a + '/'));
      if (!ok) {
        violations.push({
          pkg: rule.pkg,
          file: relative(ROOT, file),
          spec,
          reason: rule.reason,
        });
      }
    }
  }

  // A clean import graph is easy to undo via package.json, so check that too.
  try {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages', rule.pkg, 'package.json'), 'utf8')
    );
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      const allowed = rule.allow === 'node-and-relative-only' ? [] : rule.allow;
      if (!allowed.includes(dep)) {
        violations.push({
          pkg: rule.pkg,
          file: `packages/${rule.pkg}/package.json`,
          spec: dep,
          reason: rule.reason,
        });
      }
    }
  } catch {
    // package not present yet
  }
}

if (violations.length > 0) {
  console.error('Dependency boundary violations:\n');
  for (const v of violations) {
    console.error(`  @tollbooth/${v.pkg}  ${v.file}`);
    console.error(`    imports ${JSON.stringify(v.spec)}`);
    console.error(`    rule: ${v.reason}\n`);
  }
  process.exit(1);
}

console.log(`Dependency boundaries OK (${RULES.length} packages checked).`);
