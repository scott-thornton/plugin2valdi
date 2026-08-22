#!/usr/bin/env node
// plugin2valdi - Capacitor plugin -> Valdi polyglot module translator.
//
//   plugin2valdi <plugin-dir> [options]            translate + review manifest
//   plugin2valdi build-valdi <plugin-dir> [opts]   translate + compile through
//                                               the real Valdi toolchain
//
// Options:
//   --out <dir>          output root (default ./out)
//   --android-pkg <p>    android namespace (default com.plugin2valdi.modules)
//   --ios-prefix <p>     Obj-C class prefix (default SC)
//   --scratch <dir>      build-valdi: scratch project (default ./scratch)
//   --timeout <ms>       build-valdi: bazel timeout (default 30 min)
//
// Philosophy: never crash on an unknown shape - degrade to partial output
// with a blocking flag. The manifest is the contract for human review.

import fs from 'fs';
import { translatePlugin } from '../lib/translate.mjs';
import { buildValdi } from '../lib/build-valdi.mjs';
import { survey } from '../lib/survey.mjs';

const argv = process.argv.slice(1); // keep argv[0] = script path for dispatch
const sub = process.argv[2] === 'build-valdi' ? 'build-valdi' : (process.argv[2] === 'survey' ? 'survey' : 'translate');
const rest = sub === 'translate' ? argv.slice(1) : argv.slice(2);

const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i !== -1 ? rest[i + 1] : fallback;
};
const VALUE_FLAGS = ['--out', '--android-pkg', '--ios-prefix', '--scratch', '--timeout'];
const pluginDir = rest.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(rest[i - 1]));
const outRoot = flag('out', './out');
const opts = {
  androidPkg: flag('android-pkg', 'com.plugin2valdi.modules'),
  iosPrefix: flag('ios-prefix', 'SC'),
  scratch: flag('scratch', './scratch'),
  timeout: parseInt(flag('timeout', '1800000'), 10),
};

if (!pluginDir || !fs.existsSync(pluginDir)) {
  console.error('usage: plugin2valdi [build-valdi|survey] <dir> [--out <dir>] [--android-pkg <prefix>] [--ios-prefix <prefix>] [--scratch <dir>] [--timeout <ms>] [--build]');
  process.exit(1);
}

const log = (m) => console.log(m);

if (sub === 'survey') {
  const s = survey(pluginDir, { ...opts, out: outRoot, build: rest.includes('--build') }, log);
  if (s.error) { console.error(s.error); process.exit(1); }
  console.log(`\nsurvey: ${s.summary.plugins} plugins · ${s.summary.compiled}/${s.summary.attempted} contracts compiled · ${s.summary.blocking} hand-work items`);
  for (const [cat, n] of Object.entries(s.summary.byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${cat}`);
  console.log(`\nreport: ${s.reportPath}`);
  process.exit(0);
}

const result = translatePlugin(pluginDir, outRoot, opts, log);

console.log(`\n${result.moduleName}: ${result.model.methods.length} methods, ${result.model.events.length} events, ${result.model.types.length} types`);

if (sub === 'build-valdi') {
  const build = buildValdi(result, opts, log);
  // rewrite the manifest with any compiler findings folded in
  const { flags } = result;
  fs.writeFileSync(`${result.outDir}/FLAGS.md`, flags.render());
  if (build.ok) {
    console.log(`\nbuild-valdi: GREEN - compiled through the real Valdi toolchain`);
    if (build.generated.header) {
      console.log(`  bindings: ${build.generated.header}`);
      console.log(`  interfaces: ${build.generated.interfaces.join(', ') || '(none)'}`);
      console.log(`  protocols: ${build.generated.protocols.join(', ') || '(none)'}`);
      console.log(`  SCValdiPromise methods: ${build.generated.promiseMethods}`);
    }
  } else {
    console.log(`\nbuild-valdi: RED - findings written to ${result.outDir}/FLAGS.md`);
    for (const f of flags.blocking) console.log(`  - [blocking] ${f.id}`);
    process.exit(1);
  }
}

console.log(`flags: ${result.flags.blocking.length} blocking, ${result.flags.warnings.length} warnings -> ${result.outDir}/FLAGS.md`);
for (const f of result.flags.blocking) console.log(`  - ${f.id}`);
