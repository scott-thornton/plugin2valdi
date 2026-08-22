// plugin2valdi survey - fleet assessment for a Capacitor app.
//
//   plugin2valdi survey <app-dir> [--out <dir>] [--scratch <dir>] [--build]
//
// The masses' question is not "translate plugin X" - it's "how much of MY
// app can move to Valdi?" One command: discover every Capacitor plugin in
// the app (package deps, file: links, plugins/ convention), translate each,
// validate each body, optionally compile each contract through the real
// toolchain, and emit a single MIGRATION-REPORT.md with per-plugin hand-work
// classified in plain English.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { translatePlugin } from './translate.mjs';
import { buildValdi } from './build-valdi.mjs';

// flag id -> plain-English work category (masses read the report, not our ids)
const CATEGORIES = [
  [/^swift-factory$|^java-call-class$|^factory-/, 'Factory + promise conformance wiring'],
  [/^compiler-/, 'Contract fixes (compiler findings)'],
  [/^codegen-silent-skip$/, 'Dangling type references in contract'],
  [/^callback-aliases$/, 'Callback/watch redesign to listener pattern'],
  [/^unresolved-types$/, 'Type inlining or local definitions'],
  [/^java-permissions$/, 'Android permission flow rebuild'],
  [/retain-until-consumed/, 'Event queue design (pre-listener events)'],
  [/resolve-wrap-assumption/, 'Per-method result mapping'],
  [/^objc-unsupported$/, 'Obj-C body translation (manual)'],
  [/transform-failed|parse-failed|emit-failed/, 'Translator gap - file an issue'],
];

function categorize(flagId) {
  for (const [re, label] of CATEGORIES) if (re.test(flagId)) return label;
  return 'Review (unclassified)';
}

function discoverPlugins(appDir) {
  const found = new Map(); // name -> dir
  const pkgPath = path.join(appDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const depEntries = Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });

  const isCapacitorish = (name) =>
    /^@capacitor\b/.test(name) ||
    /^@capacitor-(community|firebase|awesome|troo)\//.test(name) ||
    /^capacitor-/.test(name);
  const isCoreTooling = (name) =>
    ['@capacitor/core', '@capacitor/cli', '@capacitor/ios', '@capacitor/android'].includes(name);

  for (const [name, spec] of depEntries) {
    if (isCoreTooling(name)) continue;
    if (!isCapacitorish(name) && !spec.startsWith('file:')) continue;
    if (spec.startsWith('file:')) {
      const local = path.resolve(appDir, spec.replace(/^file:/, ''));
      if (fs.existsSync(path.join(local, 'package.json'))) { found.set(name, local); continue; }
    }
    const nm = path.join(appDir, 'node_modules', name);
    if (fs.existsSync(nm)) found.set(name, nm);
  }
  // local plugins/ convention (no package.json reference)
  const pluginsDir = path.join(appDir, 'plugins');
  if (fs.existsSync(pluginsDir)) {
    for (const e of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const d = path.join(pluginsDir, e.name);
      if (fs.existsSync(path.join(d, 'package.json')) && !fs.existsSync(path.join(d, 'package.json.dev'))) {
        const name = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name || `local-${e.name}`;
        if (!name.startsWith('vite-')) found.set(name, d);
      }
    }
  }
  return [...found.entries()].map(([name, dir]) => ({ name, dir }));
}

function runValidator(pluginDir, outDir, root) {
  const r = spawnSync('node', [path.join(root, 'bin', 'plugin2valdi-validate.mjs'), pluginDir, outDir], { encoding: 'utf8', cwd: root });
  const m = (r.stdout || '').match(/(\d+)\/(\d+) checks passed/);
  return m ? { passed: +m[1], total: +m[2] } : { passed: 0, total: 0 };
}

export function survey(appDir, opts = {}, log = () => {}) {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const outRoot = path.resolve(opts.out || './out');
  const plugins = discoverPlugins(appDir);
  if (!plugins.length) return { error: 'No Capacitor plugins discovered - is this a Capacitor app?' };

  log(`survey: ${plugins.length} plugin(s) discovered`);
  const results = [];

  // Survey isolation: every verdict must reflect THIS plugin alone. Snapshot
  // the scratch root BUILD, restore it after each attempt, and remove the
  // installed module - one survey module exists at a time. (Stale modules
  // from earlier runs otherwise poison every subsequent verdict via the
  // shared app target.)
  const scratchDir = path.resolve(opts.scratch || './scratch');
  const rootBuildPath = path.join(scratchDir, 'BUILD.bazel');
  const rootBuildSnapshot = fs.existsSync(rootBuildPath) ? fs.readFileSync(rootBuildPath, 'utf8') : null;
  const restoreScratch = (moduleName) => {
    fs.rmSync(path.join(scratchDir, 'modules', moduleName), { recursive: true, force: true });
    if (rootBuildSnapshot != null) fs.writeFileSync(rootBuildPath, rootBuildSnapshot);
  };

  for (const p of plugins) {
    const entry = { name: p.name, dir: p.dir };
    try {
      const t = translatePlugin(p.dir, outRoot, opts, () => {});
      entry.methods = t.model.methods.length;
      entry.events = t.model.events.length;
      entry.types = t.model.types.length;
      entry.flags = t.flags.items;
      entry.outDir = t.outDir;
      entry.moduleName = t.moduleName;

      // contract closure: does it reference undefined types?
      entry.contractClosed = !t.flags.has('unresolved-types') && !t.flags.has('parse-failed') && !t.flags.has('dts-emit-failed');

      const v = runValidator(p.dir, t.outDir, root);
      entry.bodyChecks = v;

      if (opts.build) {
        const b = buildValdi(t, { ...opts, scratch: opts.scratch }, () => {});
        entry.compiles = b.ok === true;
        entry.verdict = b.ok ? 'compiled' : (t.flags.has('codegen-silent-skip') ? 'silent-skip' : 'rejected');
        restoreScratch(t.moduleName);
      } else {
        entry.compiles = null;
      }
    } catch (err) {
      entry.error = err.message;
      entry.flags = [];
      entry.methods = 0;
      entry.events = 0;
      entry.types = 0;
      entry.bodyChecks = { passed: 0, total: 0 };
      entry.contractClosed = false;
      entry.compiles = null;
    }
    results.push(entry);
  }

  // ---- report ----
  const lines = [];
  const totalBlocking = results.flatMap((r) => (r.flags || []).filter((f) => f.severity === 'blocking'));
  const compiled = results.filter((r) => r.compiles === true).length;
  const attempted = results.filter((r) => r.compiles !== null).length;

  lines.push(`# plugin2valdi migration survey - ${path.basename(appDir)}`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString().slice(0, 10)} · ${results.length} plugins · contracts are skeleton targets; bodies need review regardless of verdict._`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **${results.length}** Capacitor plugin(s) discovered`);
  lines.push(`- **${results.filter((r) => r.contractClosed).length}** translate to closed contracts (no dangling type references)`);
  if (attempted) lines.push(`- **${compiled}/${attempted}** contracts compiled through the real Valdi toolchain`);
  lines.push(`- **${totalBlocking.length}** hand-work items across the fleet, by category:`);
  lines.push('');
  const byCat = {};
  for (const f of totalBlocking) byCat[categorize(f.id)] = (byCat[categorize(f.id)] || 0) + 1;
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) lines.push(`  - ${cat}: **${n}**`);
  lines.push('');
  lines.push('## Fleet');
  lines.push('');
  lines.push('| Plugin | Methods | Events | Contract | Toolchain | Body checks | Hand-work |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const contract = r.contractClosed ? 'closed' : 'gaps';
    const tool = r.compiles === null ? '-' : (r.compiles ? '✅ compiled' : `❌ ${r.verdict}`);
    const body = r.bodyChecks.total ? `${r.bodyChecks.passed}/${r.bodyChecks.total}` : '-';
    const work = (r.flags || []).filter((f) => f.severity === 'blocking').length;
    lines.push(`| ${r.name} | ${r.methods} | ${r.events} | ${contract} | ${tool} | ${body} | ${work} |`);
  }
  lines.push('');
  lines.push('## Per-plugin hand-work');
  lines.push('');
  for (const r of results) {
    const blocking = (r.flags || []).filter((f) => f.severity === 'blocking');
    if (!blocking.length && !r.error) continue;
    lines.push(`### ${r.name}`);
    lines.push('');
    if (r.error) lines.push(`- Translator error: ${r.error}`);
    const seen = new Set();
    for (const f of blocking) {
      const cat = categorize(f.id);
      if (seen.has(cat)) continue;
      seen.add(cat);
      lines.push(`- **${cat}** - ${f.message.split('.')[0]}.`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('_Verified grammar: Valdi beta-0.1.1 toolchain. Flag meanings: see plugin2valdi FLAGS.md documentation._');

  const reportPath = path.join(outRoot, 'MIGRATION-REPORT.md');
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(reportPath, lines.join('\n'));
  return { results, reportPath, summary: { plugins: results.length, compiled, attempted, blocking: totalBlocking.length, byCat } };
}
