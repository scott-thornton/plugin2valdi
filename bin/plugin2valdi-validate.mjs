#!/usr/bin/env node
// plugin2valdi validation (Layer 0): prove the translation lost nothing.
//
//   node bin/plugin2valdi-validate.mjs <plugin-dir> <out-module-dir>
//
// Checks:
//   1. ritual coverage  - every notifyListeners/call.resolve/call.reject in
//                         the original maps to a rewritten site in the output
//                         (counts preserved, zero unrewritten survivors)
//   2. body preservation - every non-ritual source line survives, modulo the
//                         documented drop allowlist (registration metadata,
//                         imports, annotations) and token renames
//   3. contract coverage - every contract method + event name appears in both
//                         platform outputs

import fs from 'fs';
import path from 'path';
import { findCalls, replaceCalls } from '../lib/transform-common.mjs';

const [, , pluginDir, outDir] = process.argv;
if (!pluginDir || !outDir) {
  console.error('usage: plugin2valdi-validate.mjs <plugin-dir> <out-module-dir>');
  process.exit(1);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

function countRitual(src) {
  // conformance idiom: call.resolve(x) -> promise.fulfillSuccess(make(x)) /
  // valdiPromise.fulfillSuccess(...) - count both spellings as resolve
  const resolve = findCalls(src, 'call.resolve').length
    + findCalls(src, 'valdiPromise.fulfillSuccess').length
    + findCalls(src, 'promise.fulfill').length;
  const reject = findCalls(src, 'call.reject').length
    + findCalls(src, 'valdiPromise.fulfillFailure').length
    + findCalls(src, 'promise.perform(Selector("fulfillWithError:")').length;
  const notify = findCalls(src, 'notifyListeners').length;
  return { resolve, reject, notify };
}

// Documented drops: registration metadata + imports + annotations that the
// translation is SUPPOSED to remove. Anything else vanishing = failure.
const DROP_ALLOWLIST = [
  /^import\s/,
  /^package\s/,
  /^@objc\(/,
  /^\s*public let (identifier|jsName|pluginMethods)/,
  /^\s*CAPPluginMethod\(name:/,
  /^\s*\]\s*$/,
  /^CAP_PLUGIN\(/,
  /^\s*CAP_PLUGIN_METHOD\(/,
  /^\s*@PluginMethod\s*$/,
  /^\s*@(PermissionCallback|Permission)\b/,
  /^\s*@Override\s*$/,
  /^\s*super\.handleOnResume\(\);/,
  /^\s*public class \w+( extends Plugin|: CAPPlugin, CAPBridgedPlugin)? \{/,
  /^\s*private void runOnMainThread\(Runnable runnable\) \{/,
  /^@CapacitorPlugin\(/,
  /^name = /,
  /^permissions = @Permission/,
  /^permissions = \[?Permission[({]/,
  /^permissions = \{/,
  /^strings = \[/,
  /^strings = \{/,
  /^alias = /,
  /^\)\s*$/,
  /^\), Permission\(/,
  /^\s*\.init\(name:/,
  /^\s*(public )?class \w+[ :(]/,
];

// Mask ritual-call spans to canonical tokens so a rewritten line compares
// equal to its original. Balanced spans mask wholesale; any marker surviving
// that is by definition a multiline opener - truncate from it.
function maskRitual(line) {
  let out = line;
  out = replaceCalls(out, 'notifyListeners', () => '@@NOTIFY@@');
  out = replaceCalls(out, 'call.resolve', () => '@@RESOLVE@@');
  out = replaceCalls(out, 'call.reject', () => '@@REJECT@@');
  out = replaceCalls(out, 'valdiPromise.fulfillSuccess', () => '@@RESOLVE@@');
  out = replaceCalls(out, 'valdiPromise.fulfillFailure', () => '@@REJECT@@');
  out = replaceCalls(out, 'promise.fulfill', () => '@@RESOLVE@@');
  out = out.replace(/\bnotifyListeners\(.*/, '@@NOTIFY@@');
  out = out.replace(/\bemit\w+\(.*/, '@@NOTIFY@@');
  out = out.replace(/call\.resolve\(.*/, '@@RESOLVE@@');
  out = out.replace(/call\.reject\(.*/, '@@REJECT@@');
  out = out.replace(/valdiPromise\.fulfillSuccess\(.*/, '@@RESOLVE@@');
  out = out.replace(/valdiPromise\.fulfillFailure\(.*/, '@@REJECT@@');
  out = out.replace(/promise\.perform\(Selector\("fulfillWithError:"\).*/, '@@REJECT@@');
  out = out.replace(/(@@(?:NOTIFY|RESOLVE|REJECT)@@);+$/, '$1');
  return out;
}

function normalizeSwift(line) {
  let out = maskRitual(line)
    .replace(/CAPPluginCall/g, 'XCall').replace(/ValdiCall/g, 'XCall');
  // typed options access: `call.getString("f")` -> `options.f` /
  // `options.f.rawValue` (enum-typed fields) is a whole-line rewrite -
  // canonicalize both sides to one token (exact shapes asserted in run.mjs)
  if (/\bcall\.get\w+\(/.test(out) || /\boptions\.\w+/.test(out)) return '@@GET-LINE@@';
  return out
    .replace(/public override func load\(\)/, 'FUNC_LOAD')
    .replace(/func onLoadModule\(\)/, 'FUNC_LOAD')
    .replace(/\s+/g, ' ').trim();
}

function normalizeJava(line) {
  let out = maskRitual(line)
    .replace(/\bJSObject\b/g, 'JSONObject')
    .replace(/\bPluginCall\b/g, 'XCall').replace(/\bValdiCall\b/g, 'XCall');
  // typed options access: `call.getX("f", d)` -> `options.getF()` reads
  // (enum-typed fields through .getValue(), guarded/default variants) are a
  // whole-line rewrite - canonicalize both sides to one token. Exact emitted
  // shapes are asserted per-fixture in run.mjs.
  if (/\bcall\.get\w+\(/.test(out) || /\boptions\.get\w+\(/.test(out)) return '@@GET-LINE@@';
  return out
    // conformance signatures: `public Promise<T> name(options)` vs the
    // original `public void name(XCall call)` - canonicalize both to METHOD
    // (unanchored + truncate: a complete one-line method and the same method
    // expanded across lines by the conformance normalize identically)
    .replace(/^(\s*)public (?:void|Promise<[^>]+>) (\w+)\([^)]*\) \{.*$/, '$1METHOD $2 {')
    // injected conformance boilerplate normalizes away entirely
    .replace(/^(\s*)(?:final )?ResolvablePromise<\w+> \w+ = new ResolvablePromise<\w+>\(\);$/, '$1')
    .replace(/^(\s*)return \w+;$/, '$1')
    .replace(/public void load\(\)/, 'FUNC_LOAD')
    .replace(/public void onLoadModule\(\)/, 'FUNC_LOAD')
    .replace(/override fun load\(\)/, 'FUNC_LOAD')
    .replace(/protected void handleOnResume\(\)/, 'FUNC_RESUME')
    .replace(/public void handleOnResume\(\)/, 'FUNC_RESUME')
    .replace(/new android\.os\.Handler\(android\.os\.Looper\.getMainLooper\(\)\)\.post/, 'EXEC_MAIN')
    .replace(/getBridge\(\)\.executeOnMainThread/, 'EXEC_MAIN')
    .replace(/\s+/g, ' ').trim();
}

function lineMultiset(lines, normalize) {
  const map = new Map();
  for (const l of lines) {
    const n = normalize(l);
    // skip empties, brace/bracket-only fragments (multiline literals)
    if (!n || /^[{}[\](),;]+$/.test(n) || n.startsWith('//')) continue;
    map.set(n, (map.get(n) || 0) + 1);
  }
  return map;
}

function diffPreserved(origLines, outLines, normalize, label) {
  const orig = lineMultiset(origLines, normalize);
  const out = lineMultiset(outLines, normalize);
  const missing = [];
  for (const [line, count] of orig) {
    const have = out.get(line) || 0;
    if (have < count) missing.push(line);
  }
  const unaccounted = missing.filter((l) => !DROP_ALLOWLIST.some((re) => re.test(l)));
  check(`${label}: body preservation`, unaccounted.length === 0,
    unaccounted.length ? `${unaccounted.length} line(s) missing beyond allowlist: ${JSON.stringify(unaccounted.slice(0, 3))}` : 'all non-ritual lines preserved or allowlisted');
}

function findFile(dir, pred) {
  const matches = [];
  if (!fs.existsSync(dir)) return matches; // Swift-only / Java-only plugins
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'build' || e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(p)) matches.push(p);
    }
  };
  walk(dir);
  return matches;
}

// Pick the original source the SAME way the translator does: marker scan.
const pickByMarker = (files, marker) => {
  for (const f of files) {
    try { if (fs.readFileSync(f, 'utf8').includes(marker)) return f; } catch {}
  }
  return files[0] || null;
};

// --- Swift ---
const origSwift = pickByMarker(findFile(path.join(pluginDir, 'ios'), (p) => p.endsWith('.swift') && p !== 'Package.swift'), 'CAPBridgedPlugin');
const outSwift = path.join(outDir, 'ios');
if (origSwift && fs.existsSync(outSwift)) {
  const o = fs.readFileSync(origSwift, 'utf8');
  const t = fs.readFileSync(path.join(outSwift, fs.readdirSync(outSwift).find((f) => f.includes('_impl'))), 'utf8');
  const oc = countRitual(o);
  const tc = countRitual(t);
  check('swift: no unrewritten notifyListeners', tc.notify === 0, `original ${oc.notify} -> survivors ${tc.notify}`);
  check('swift: resolve sites preserved', tc.resolve === oc.resolve, `original ${oc.resolve} -> translated ${tc.resolve}`);
  check('swift: reject sites preserved', tc.reject === oc.reject, `original ${oc.reject} -> translated ${tc.reject}`);
  diffPreserved(o.split('\n'), t.split('\n'), normalizeSwift, 'swift');
} else {
  check('swift: inputs found', false, `${origSwift}`);
}

// --- Java/Kotlin ---
const origJava = pickByMarker(findFile(path.join(pluginDir, 'android'), (p) => p.endsWith('.java') || p.endsWith('.kt')), '@CapacitorPlugin');
const outJava = path.join(outDir, 'android');
if (origJava && fs.existsSync(outJava)) {
  const o = fs.readFileSync(origJava, 'utf8');
  const implName = fs.readdirSync(outJava).find((f) => f.endsWith('.java') && f.includes('Module'));
  const t = fs.readFileSync(path.join(outJava, implName), 'utf8');
  const oc = countRitual(o);
  const tc = countRitual(t);
  check('java: no unrewritten notifyListeners', tc.notify === 0, `original ${oc.notify} -> survivors ${tc.notify}`);
  check('java: resolve sites preserved', tc.resolve === oc.resolve, `original ${oc.resolve} -> translated ${tc.resolve}`);
  // java rejects: `>=` - the conformance pass INJECTS catch-block
  // fulfillFailure sites around unguarded throwing calls (additions, not
  // translations of original call.reject sites)
  check('java: reject sites preserved', tc.reject >= oc.reject, `original ${oc.reject} -> translated ${tc.reject}`);
  diffPreserved(o.split('\n'), t.split('\n'), normalizeJava, 'java');
} else {
  check('java: inputs found', false, `${origJava}`);
}

// --- contract coverage ---
const dts = fs.readFileSync(path.join(outDir, 'src', fs.readdirSync(path.join(outDir, 'src'))[0]), 'utf8');
const methods = [...dts.matchAll(/export function (\w+)\(/g)].map((m) => m[1]).filter((n) => !n.startsWith('on'));
const events = [...dts.matchAll(/export function on(\w+)\(/g)].map((m) => m[1]);
const implTexts = [];
for (const dir of [outSwift, outJava]) {
  if (!fs.existsSync(dir)) { implTexts.push([]); continue; } // Swift-only / Java-only plugins
  implTexts.push(
    fs.readdirSync(dir)
      .filter((f) => f.endsWith('.swift') || f.endsWith('.java'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')),
  );
}
// contract satisfied per PLATFORM: at least one file of the platform carries it
for (const m of methods) {
  check(`contract: ${m} in both platforms`, implTexts.every((files) => files.some((t) => t.includes(m))));
}
for (const e of events) {
  check(`contract: emit${e} in both platforms`, implTexts.every((files) => files.some((t) => t.includes(`emit${e}`))));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
