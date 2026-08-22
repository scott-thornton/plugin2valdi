// React Native TurboModule intake.
//
// RN plugins expose their contract through a codegen Spec (a TypeScript
// interface consumed by the RN code generator), not through Capacitor's
// definitions.ts. The native sides speak the RN host surface
// (RCT_EXPORT_METHOD, RCTPromiseResolveBlock, @ReactMethod,
// ReactApplicationContext, DeviceEventManagerModule) instead of the
// Capacitor one. This module normalizes the Spec into the same internal
// model the rest of the pipeline consumes, and scans the native sources
// for the RN event-emission points so the contract gets a Valdi listener.

import fs from 'fs';
import path from 'path';
import { pascal } from './model.mjs';

// codegen scalar types (react-native/Libraries/Types/CodegenTypes) map onto
// plain TS scalars; the Valdi compiler sees number/string either way
export const CODEGEN_TYPE_MAP = {
  Int32: 'number',
  Double: 'number',
  Float: 'number',
  Int: 'number',
};

export function findRnSpec(pluginDir, flags) {
  // 1. codegenConfig.jsSrcsDir in package.json is the canonical location
  let jsDirs = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
    if (pkg.codegenConfig?.jsSrcsDir) jsDirs.push(pkg.codegenConfig.jsSrcsDir);
  } catch {}
  jsDirs.push('src');
  const seen = new Set();
  const candidates = [];
  for (const raw of jsDirs) {
    const d = raw.replace(/^\.\//, '');
    if (seen.has(d)) continue;
    seen.add(d);
    // specs can nest (AsyncStorage: src/native-module/NativeAsyncStorage.ts) -
    // walk the jsSrcsDir, skipping build output and tests
    const queue = [path.join(pluginDir, d)];
    while (queue.length) {
      const dir = queue.shift();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (/^(node_modules|dist|__tests__|__mocks__)$/.test(e.name)) continue;
          queue.push(path.join(dir, e.name));
        } else if (/^Native[A-Z]\w*\.(ts|tsx|js)$/.test(e.name)) {
          const p = path.join(dir, e.name);
          try {
            if (fs.readFileSync(p, 'utf8').includes('TurboModuleRegistry')) candidates.push(p);
          } catch {}
        }
      }
    }
  }
  if (!candidates.length) return null;
  if (candidates.length > 1) {
    flags.add('rn-multiple-specs', 'warning', `Multiple TurboModule spec files found (${candidates.map((c) => path.basename(c)).join(', ')}) - using ${path.basename(candidates[0])}.`);
  }
  return candidates[0];
}

// The RN event-emitter boilerplate every Spec carries. Capacitor's parser
// drops removeListener/checkPermissions; RN's setListener/removeListener
// pair carries native attach/detach semantics that the Valdi listener
// machinery replaces wholesale.
const RN_EVENT_BOILERPLATE = new Set(['addListener', 'removeListeners']);

export function isRnEventBoilerplate(method) {
  if (RN_EVENT_BOILERPLATE.has(method.name)) return true;
  // setListener(): void / removeListener(): void with zero params are the
  // attach/detach pair (a setListener(listener: X) from a Capacitor-style
  // contract is NOT boilerplate)
  if ((method.name === 'setListener' || method.name === 'removeListener') && !(method.params || []).length) return true;
  return false;
}

// Normalize a parsed Spec model into the Capacitor-shaped model the
// emitters expect: primitive params wrapped in synthesized options types
// (the codegen-verified contract shape), codegen scalars mapped, event
// boilerplate absorbed.
export function normalizeRnModel(model, flags) {
  const dropped = [];
  const kept = [];
  for (const m of model.methods) {
    if (isRnEventBoilerplate(m)) { dropped.push(m.name); continue; }
    for (const p of m.params || []) {
      if (CODEGEN_TYPE_MAP[p.type]) p.type = CODEGEN_TYPE_MAP[p.type];
    }
    if (CODEGEN_TYPE_MAP[m.returns]) m.returns = CODEGEN_TYPE_MAP[m.returns];
    // wrap non-object params in a synthesized options type: the verified
    // contract shape is fn(options: XOptions) - bare scalars in param
    // position are an unverified codegen position (and multi-param
    // functions do not exist in the Capacitor shape at all). Inline
    // object literals (and literal arrays) are wrappable too - the d.ts
    // emitter synthesizes named types for them at emission.
    if ((m.params || []).length) {
      const wrappable = (t) => /^(string|number|boolean)(\[\])*$/.test(t || '') || (t || '').trim().startsWith('{');
      if (m.params.every((p) => wrappable(p.type))) {
        const name = pascal(m.name) + 'Options';
        model.types.push({
          name,
          kind: 'object',
          synthesized: true,
          fields: m.params.map((p) => ({ name: p.name, optional: false, type: p.type })),
        });
        m.params = [{ name: 'options', type: name }];
      } else {
        flags.add(`rn-param-shape:${m.name}`, 'blocking', `${m.name}() has params that are neither scalars nor known interfaces (${m.params.map((p) => `${p.name}: ${p.type}`).join(', ')}). RN codegen types (ReadableMap/ReadableArray and friends) have no Valdi mapping - restructure the params by hand.`);
      }
    }
    kept.push(m);
  }
  model.methods = kept;
  if (dropped.length) {
    flags.add('rn-event-boilerplate', 'resolved', `RN emitter boilerplate (${dropped.join(', ')}) absorbed into the Valdi listener machinery: attach/detach bodies from the native sources power the generated setListener, and the TEXT_CHANGED emission reroutes to the @ExportProxy listener.`);
  }
  return model;
}

// Scan native sources for RN event emission and map the emitted constants
// to Valdi listener method names:
//   sendEventWithName:CLIPBOARD_TEXT_CHANGED body:...   (iOS)
//   .emit(CLIPBOARD_TEXT_CHANGED, ...)                  (Android)
// Only constants USED at an emission site count - a screaming-snake string
// alone is not an event (AsyncStorage's RCTAsyncLocalStorage_V1 is a legacy
// storage key prefix, not an emission).
// RNCClipboard_TEXT_CHANGED -> textChanged (module prefix dropped, snake
// segments camel-cased). Payload stays void for emit sites we cannot type.
export function scanRnEvents(natives, moduleName, flags) {
  const modules = [...natives.objc, ...natives.swift, ...natives.java, ...natives.kotlin];
  const emitted = new Set();
  for (const f of modules) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const resolve = (ident) => {
      if (/^".*"$/.test(ident)) return ident.slice(1, -1);
      const m = src.match(new RegExp(`(?:NSString\\s+\\*const|String)\\s+${ident}\\s*=\\s*@"?([A-Za-z0-9_:]+)"?`));
      return m ? m[1] : null;
    };
    for (const m of src.matchAll(/sendEventWithName\s*:\s*(\w+)\s/g)) {
      const v = resolve(m[1]);
      if (v) emitted.add(v);
    }
    for (const m of src.matchAll(/\.emit\s*\(\s*(\w+|"[^"]*")/g)) {
      const v = resolve(m[1]);
      if (v) emitted.add(v);
    }
  }
  const events = [];
  for (const c of emitted) {
    // MODULE_NAME style: a module-ish prefix segment followed by
    // SCREAMING_SNAKE segments (RNCClipboard_TEXT_CHANGED), or a plain
    // screaming-snake name
    if (!/^[\w:]+(_[A-Z0-9]+)+$/.test(c) && !/^[a-z]+:[a-z]+$/i.test(c)) continue;
    const jsName = constantToMethodName(c, moduleName);
    if (events.some((e) => e.name === jsName)) continue;
    events.push({ name: jsName, payload: 'void', fromConstant: c });
  }
  if (events.length) {
    flags.add('rn-events-scanned', 'resolved', `RN event constants mapped to Valdi listener methods: ${events.map((e) => `${e.fromConstant} -> ${e.name}()`).join(', ')}. Emission sites reroute to the @ExportProxy listener. RN emits carry no typed payload unless the body says otherwise - payloads stay void until ported.`);
  }
  return events;
}

function constantToMethodName(c, moduleName) {
  const segments = c.split('_');
  // drop a leading module-ish prefix: RNCClipboard_TEXT_CHANGED or
  // Clipboard_TEXT_CHANGED -> [TEXT, CHANGED]. The test-suite module prefix
  // (test_clipboard) is tolerated on the module side.
  const moduleUpper = moduleName.replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/^TEST/, '');
  if (segments.length > 1 && new RegExp(`^R?N?C?${moduleUpper}$`, 'i').test(segments[0])) segments.shift();
  const rest = segments.map((s) => s.toLowerCase());
  return rest.map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1))).join('');
}
