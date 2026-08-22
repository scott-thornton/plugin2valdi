// plugin2valdi build-valdi - the Layer 1 loop, encoded.
//
//   translate -> bootstrap (or reuse) a scratch Valdi project -> install the
//   module (android_class_path aligned) -> wire app deps -> build through the
//   real compiler -> classify compiler errors into named flags -> report
//   generated bindings on success.
//
// Every step degrades into a flag, never a dead end. The scratch project is
// reused across runs - Bazel's cache makes the second module nearly free.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line no-control-regex -- strips ANSI color codes from compiler output
const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => (s || '').replace(ANSI, '');
const tail = (s, n = 400) => strip(s).split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, n);

function walk(dir, pred, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'runfiles' || e.name === '.git') continue;
      walk(p, pred, acc);
    } else if (pred(p)) acc.push(p);
  }
  return acc;
}

// Map raw valdi_compiler errors onto named, actionable flags - the same
// classifications discovered during Layer 1 verification.
function classifyCompilerErrors(out, flags) {
  const seen = new Set();
  const lines = strip(out).split('\n').filter((l) => l.includes('[ERROR]') || /error:/i.test(l));
  let matched = 0;
  for (const line of lines) {
    const clean = line.replace(/\[ERROR\]/g, '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    if (/Unrecognized annotation '\S+'/.test(clean)) {
      flags.add('compiler-annotation-prose', 'blocking', `Valdi compiler rejected the contract: ${clean} - an at-sign word in a comment reads as an annotation. Remove it from comment prose.`);
      matched++;
    } else if (/Only annotated types can be exported|Unrecognized type '\S+'/.test(clean)) {
      flags.add('compiler-annotation-closure', 'blocking', `Valdi compiler: ${clean} - every type referenced by an @ExportModel/@ExportProxy interface must itself be annotated. Inline or define the type locally.`);
      matched++;
    } else if (/Found '(com\/[\w/]+)'.*vs '(com\/[\w/]+)'/i.test(clean)) {
      flags.add('compiler-package-mismatch', 'blocking', `Valdi compiler: ${clean} - single_file_codegen requires one android package per module. Align android_class_path with the @ExportModel android names.`);
      matched++;
    }
  }
  if (!matched && lines.length) {
    flags.add('compiler-error', 'blocking', `Valdi compiler failed: ${tail(out)} - unclassified error; read the full bazel output.`);
  }
  return matched;
}

function findGeneratedHeader(scratchDir, moduleName) {
  const want = `${moduleName}Types.h`;
  const hits = walk(path.join(scratchDir, 'bazel-out'), (p) => p.endsWith(want), [])
    .filter((p) => !p.includes('valdi~'));
  return hits[0] || null;
}

export function buildValdi(result, opts = {}, log = () => {}) {
  const { moduleName, outDir, flags } = result;
  const scratchDir = path.resolve(opts.scratch || './scratch');

  // 1. toolchain present?
  if (spawnSync('which', ['valdi'], { encoding: 'utf8' }).status !== 0) {
    flags.add('build-valdi-no-cli', 'blocking', 'valdi CLI not found on PATH - npm install -g @snap/valdi, then valdi dev_setup.');
    return { ok: false };
  }
  if (spawnSync('which', ['bazel'], { encoding: 'utf8' }).status !== 0) {
    flags.add('build-valdi-no-bazel', 'blocking', 'bazel not found on PATH - run valdi dev_setup (installs bazelisk).');
    return { ok: false };
  }

  // 2. scratch project: bootstrap once, reuse forever (Bazel cache)
  if (!fs.existsSync(path.join(scratchDir, 'MODULE.bazel'))) {
    const appName = opts.appName || 'plugin2valdi_scratch';
    log(`build-valdi: bootstrapping scratch project in ${scratchDir} (first run downloads the framework)...`);
    fs.mkdirSync(scratchDir, { recursive: true });
    const boot = spawnSync('valdi', ['bootstrap', '-y', '-t', 'ui_application', '-n', appName], {
      cwd: scratchDir, encoding: 'utf8', timeout: 900000, maxBuffer: 32 * 1024 * 1024,
    });
    if (boot.status !== 0) {
      flags.add('build-valdi-bootstrap-failed', 'blocking', `valdi bootstrap failed: ${tail(boot.stdout + boot.stderr)}`);
      return { ok: false };
    }
  } else {
    log('build-valdi: reusing scratch project');
  }

  // 3. install the module (contract + BUILD with aligned android_class_path)
  // - deterministic: clear any previous install first, or stale .d.ts files
  // accumulate in the glob and trip the single-package rule
  const modDir = path.join(scratchDir, 'modules', moduleName);
  fs.rmSync(modDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(modDir, 'src'), { recursive: true });
  for (const sub of ['src', 'ios', 'android']) {
    const from = path.join(outDir, sub);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.join(modDir, sub), { recursive: true });
    for (const f of fs.readdirSync(from)) {
      if (f.endsWith('.d.ts') || f.endsWith('.ts') || f.endsWith('.swift') || f.endsWith('.m') || f.endsWith('.java') || f.endsWith('.kt')) {
        fs.copyFileSync(path.join(from, f), path.join(modDir, sub, f));
      }
    }
  }
  fs.copyFileSync(path.join(outDir, 'BUILD.bazel'), path.join(modDir, 'BUILD.bazel'));
  log(`build-valdi: installed modules/${moduleName}`);

  // 4. wire the app consumer - module targets are analysis-only without one
  const rootBuildPath = path.join(scratchDir, 'BUILD.bazel');
  let build = fs.readFileSync(rootBuildPath, 'utf8');
  const dep = `//modules/${moduleName}`;
  if (!build.includes(dep)) {
    if (!/deps = \[\n/.test(build)) {
      flags.add('build-valdi-wire-failed', 'blocking', 'Could not find a deps list in the scratch root BUILD.bazel - add the module dependency by hand.');
      return { ok: false };
    }
    build = build.replace(/deps = \[\n/, `deps = [\n        "${dep}",\n`);
    fs.writeFileSync(rootBuildPath, build);
    log(`build-valdi: wired ${dep} into the app`);
  }
  const appMatch = build.match(/valdi_application\(\s*name = "(\w+)"/);
  if (!appMatch) {
    flags.add('build-valdi-wire-failed', 'blocking', 'No valdi_application target found in the scratch root BUILD.bazel.');
    return { ok: false };
  }
  const target = `//:${appMatch[1]}_ios`;

  // 5. build through the real compiler
  log(`build-valdi: bazel build ${target} (first build can take 10+ minutes)...`);
  const r = spawnSync('bazel', ['build', target], {
    cwd: scratchDir, encoding: 'utf8', timeout: opts.timeout || 1800000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;

  // 6. classify + report
  if (r.status === 0) {
    const header = findGeneratedHeader(scratchDir, moduleName);
    if (!header) {
      // Observed Valdi compiler behavior: functions referencing types it
      // can't resolve can be silently dropped - the build stays green but
      // no bindings are generated. Green-with-no-bindings is a failure.
      flags.add('codegen-silent-skip', 'blocking', 'Build exited green but no generated types header was found for this module - the Valdi compiler likely skipped functions with unresolvable type references (observed with unannotated types in signatures). Fix the contract\'s dangling type references (see unresolved-types flag) and rebuild.');
      log('build-valdi: GREEN build but NO bindings generated - flagged codegen-silent-skip');
      return { ok: false };
    }
    const generated = { header, interfaces: [], protocols: [], promiseMethods: 0 };
    const src = fs.readFileSync(header, 'utf8');
    generated.interfaces = [...src.matchAll(/@interface (\w+)/g)].map((m) => m[1]);
    generated.protocols = [...src.matchAll(/@protocol (\w+)/g)].map((m) => m[1]);
    generated.promiseMethods = (src.match(/SCValdiPromise/g) || []).length;
    // Observed compiler behavior: exported functions referencing unknown
    // types silently poison the WHOLE module's codegen - green build, but
    // an empty (or missing) types header. Annotation-closure errors inside
    // @ExportProxy/@ExportModel hard-fail; plain function signatures don't.
    const expectsBindings = (result.model.types || []).some((t) => t.kind === 'object');
    if (expectsBindings && generated.interfaces.length === 0) {
      flags.add('codegen-silent-skip', 'blocking', 'Build exited green but the generated types header is empty - the Valdi compiler silently skipped this module\'s codegen (observed when exported functions reference unresolvable types; contrast: annotation-closure errors in @ExportProxy hard-fail). Fix dangling type references (see unresolved-types flag) and rebuild. Worth reporting upstream.');
      log('build-valdi: GREEN build but EMPTY bindings - flagged codegen-silent-skip');
      return { ok: false };
    }
    flags.add('build-valdi-green', 'resolved', `Contract compiled through the real Valdi toolchain (${target}). Generated bindings: ${path.relative(scratchDir, header)}`);
    return { ok: true, target, generated };
  }

  const classified = classifyCompilerErrors(out, flags);
  if (r.error && r.error.code === 'ETIMEDOUT') {
    flags.add('build-valdi-timeout', 'blocking', `bazel build exceeded timeout - rerun with --timeout <ms>; Bazel resumes from cache.`);
  }
  log(`build-valdi: build failed (${classified} error(s) classified) - see FLAGS.md`);
  return { ok: false };
}
