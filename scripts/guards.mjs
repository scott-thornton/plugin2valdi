#!/usr/bin/env node
// Repo guards: conventions that are cheap to enforce mechanically.
// Each guard maps to a rule in CONTRIBUTING.md - rule and guard travel
// together.
//
//   1. em-dash ban      - Simplified Technical English uses a hyphen, and
//                         an em dash renders badly in some terminals.
//                         Scans tracked docs plus the flag text in lib/
//                         and bin/ (lib flag text becomes the generated
//                         FLAGS.md content).
//   2. tarball contents - npm pack must ship runtime surface only
//                         (bin/, lib/, README, LICENSE). Guards against
//                         test output and screenshots leaking in.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const fail = (msg) => {
  console.error(`guard FAILED: ${msg}`);
  process.exitCode = 1;
};

// ---- guard 1: em dashes ----
{
  const files = execFileSync('git', ['ls-files', '*.md', 'lib/*.mjs', 'bin/*.mjs'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.startsWith('example/'));
  let hit = false;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, idx) => {
      if (/\u2014/.test(l)) {
        hit = true;
        console.error(`  ${f}:${idx + 1} contains an em dash - use a hyphen`);
      }
    });
  }
  if (hit) fail('em dash found (see lines above). Simplified Technical English requires a hyphen.');
  else console.log('guard 1 ok: no em dashes in docs or flag text');
}

// ---- guard 2: tarball contents ----
{
  // npm writes the manifest to stdout when piped, to stderr in a TTY -
  // accept either
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
  const files = [];
  for (const stream of [res.stdout, res.stderr]) {
    try {
      const parsed = JSON.parse(stream);
      for (const entry of parsed) {
        for (const f of entry.files || []) files.push(f.path);
      }
      break;
    } catch { /* try the other stream */ }
  }
  if (!files.length) {
    fail('npm pack produced no file list - guard could not run');
  } else {
    const bad = files.filter((p) =>
      p.startsWith('test/') || p.startsWith('docs/') || p.startsWith('example/') ||
      p.startsWith('scripts/') || p.endsWith('.png') || p.includes('bazel-'));
    if (bad.length) fail(`tarball must not contain: ${bad.join(', ')}`);
    else console.log(`guard 2 ok: tarball is runtime surface only (${files.length} files)`);
  }
}
