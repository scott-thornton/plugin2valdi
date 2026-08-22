// RN Java transformer: a ReactMethod module (Java source, extends the RN
// codegen spec base or ReactContextBaseJavaModule) into the Valdi
// conformance - a class implementing the GENERATED Kotlin interface.
//
//   public void getString(Promise promise) { promise.resolve(x); }
//     -> public Promise<String> getString() { ... fulfillSuccess(x); }
//   public void setString(String text) { ... }
//     -> public void setString(SetStringOptions options) { String text = options.getText(); ... }
//   ReactApplicationContext reactContext  -> appContext() (helper inside the class)
//   getJSModule(DeviceEventManagerModule...).emit(CONST, ...) -> listener slot emit
//   RN emitter attach/detach (setListener/removeListener) absorb into the
//   generated setListener(listener) slot.

import fs from 'fs';
import { pascal, camel } from './model.mjs';

function kotlinValueType(r) {
  switch (r) {
    case 'string': return 'String';
    case 'string[]': return 'java.util.List<String>';
    case 'boolean': return 'Boolean';
    case 'number': return 'Double';
    case 'void': return 'kotlin.Unit';
    default: return pascal(r);
  }
}

function successCall(m, expr) {
  switch (m.returns) {
    case 'void': return `valdiPromise.fulfillSuccess(kotlin.Unit.INSTANCE);`;
    default: return `valdiPromise.fulfillSuccess(${expr});`;
  }
}

export function transformRnJava(javaPath, model, moduleClass, flags) {
  const moduleName = camel(moduleClass.replace(/Module$/, ''));
  let src;
  try { src = fs.readFileSync(javaPath, 'utf8').replace(/\r\n/g, '\n'); } catch (err) {
    flags.add('rn-java-read-failed', 'blocking', `Could not read ${javaPath}: ${err.message}`);
    return null;
  }
  const lines = src.split('\n');
  const events = model.events || [];

  // ---- pass 1: collect method spans (annotation lines included) ----
  const spans = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^\s*(?:public|protected|private)?\s*(?:static\s+)?(?:\w+(?:<[^>]*>)?\s+)?(\w+)\s*\(([^)]*)\)\s*\{?\s*$/);
    if (!m || /^(if|for|while|switch|catch|return|new|super|this)$/.test(m[1])) { i++; continue; }
    const start = i;
    let depth = 0, opened = false, end = start;
    for (let j = start; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; opened = true; }
        else if (ch === '}') depth--;
      }
      if (opened && depth <= 0) { end = j; break; }
      if (!opened && j > start + 2) break;
    }
    if (!opened) { i++; continue; }
    let s = start;
    while (s > 0 && /^\s*@\w+/.test(lines[s - 1])) s--;
    spans.push({ name: m[1], params: m[2], start: s, end, body: lines.slice(start, end + 1).join('\n') });
    i = end + 1;
  }
  const spanByName = new Map();
  for (const s of spans) if (!spanByName.has(s.name)) spanByName.set(s.name, s);

  // ---- body translation: strip signature/outer braces, rewrite line by line ----
  const rewriteBody = (span, method) => {
    const inner = span.body.split('\n');
    let opened = false, depth = 0;
    const bodyLines = [];
    for (const l of inner) {
      if (!opened) {
        if (l.includes('{')) {
          opened = true; depth = 1;
          const rest = l.replace(/^[^{]*\{/, '');
          if (rest.trim()) bodyLines.push(rest);
          continue;
        }
        continue;
      }
      for (const ch of l) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth <= 0) {
        const stripped = l.replace(/\}[;]?\s*$/, '');
        if (stripped.trim()) bodyLines.push(stripped);
        break;
      }
      bodyLines.push(l);
    }
    const outLines = [];
    for (let l of bodyLines) {
      let ln = l;
      // event emission FIRST (its pattern names reactContext verbatim)
      ln = ln.replace(/.*getJSModule\(DeviceEventManagerModule\.RCTDeviceEventEmitter\.class\).*?\.emit\s*\(\s*\w+\s*,[^)]*\)\s*;.*/, () => {
        if (!events.length) return `/* plugin2valdi: RN event emission dropped - no listener in the contract */`;
        return events.map((e) => `if (valdiListener != null) valdiListener.${e.name}("");`).join(' ');
      });
      // host surface
      ln = ln.replace(/\breactContext\b/g, 'appContext()');
      // promise blocks
      if (method && method.isPromise) {
        ln = ln.replace(/promise\.resolve\(\s*\)\s*;/g, successCall(method, ''));
        ln = ln.replace(/promise\.resolve\((.+)\)\s*;/g, (_w, expr) => successCall(method, expr.trim()));
        // RN void bodies early-return; a promise method must hand back the
        // (still-pending) promise instead
        ln = ln.replace(/^(\s*)return\s*;\s*$/, '$1return valdiPromise;');
      } else {
        ln = ln.replace(/promise\.resolve\([^;]*\)\s*;/g, '/* plugin2valdi: resolve dropped - void function */;');
      }
      ln = ln.replace(/promise\.reject\(\s*([\w.":/]+)\s*(?:,\s*([\w.":/\s]+?))?\)\s*;/g, (_w, a, b) => {
        const msg = b !== undefined ? b.trim() : a.trim();
        return `valdiPromise.fulfillFailure(new RuntimeException(String.valueOf(${msg})));`;
      });
      outLines.push(ln);
    }
    // multi-line emission: appContext()\n  .getJSModule(...)\n  .emit(CONST, x);
    // spans lines - rewrite on the joined body, then re-split
    const joined = outLines.join('\n');
    const fixed = joined.replace(/appContext\(\)\s*\.?\s*getJSModule\(DeviceEventManagerModule\.RCTDeviceEventEmitter\.class\)\s*\.?\s*\.emit\s*\(\s*\w+\s*,[^)]*\)\s*;/g, () => (
      events.length ? events.map((e) => `if (valdiListener != null) valdiListener.${e.name}("");`).join(' ') : `/* plugin2valdi: RN event emission dropped */`
    ));
    return fixed.split('\n');
  };

  // ---- options bindings: RN positional params -> generated accessors ----
  const optionBinds = (m, span) => {
    const opts = (m.params || []).find((p) => /\w+Options$/.test(p.type || ''));
    if (!opts) return [];
    const optType = model.types.find((t) => t.name === opts.type);
    const rnParams = span.params.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => !/^Promise\s/.test(s));
    return (optType?.fields || []).map((f, idx) => {
      const rnName = (rnParams[idx] || f.name).split(/\s+/).pop() || f.name;
      const cap = camel(f.name).replace(/^./, (c) => c.toUpperCase());
      const kt = kotlinValueType(f.type);
      return `        ${kt} ${rnName} = ${opts.name}.get${cap}();`;
    });
  };

  const out = [];
  const methodNames = new Set(model.methods.map((m) => m.name));
  out.push(`package com.plugin2valdi.modules.${moduleName};`);
  out.push('');
  out.push('import com.snap.valdi.promise.Promise;');
  out.push('import com.snap.valdi.promise.ResolvablePromise;');
  // carry the source's non-React imports (android.*, java.*) - the bodies
  // use them verbatim
  for (const l of lines) {
    const im = l.match(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/);
    if (im && !im[1].startsWith('com.facebook.react')) out.push(`import ${im[1]};`);
  }
  out.push('');
  out.push(`// RN source: ${javaPath.split('/').pop()} - translated by the plugin2valdi RN intake.`);
  out.push(`// @ReactModule registration replaced by ${moduleName}_factory.kt; Promise`);
  out.push('// params became ResolvablePromise bodies; ReactApplicationContext became');
  out.push('// the appContext() helper (Valdi runtimes carry the app Context).');
  out.push(`class ${moduleClass}Impl implements ${moduleClass} {`);
  out.push('');
  if (events.length) {
    out.push(`    private ${pascal(moduleName)}Listener valdiListener = null;`);
    out.push('');
  }
  // source fields and constants the bodies need (skip RN host types); a
  // modifier keyword is required so constructor-body locals do not match
  for (const l of lines) {
    const fm = l.match(/^\s*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w.<>[]$]\w*[.\w<>[]$]*\s+\w+\s*=\s*[^;]+;\s*$/);
    if (fm && !/ReactApplicationContext|reactContext|final String NAME/.test(l)) out.push(`    ${fm[0].trim()}`);
  }
  out.push('');

  for (const m of model.methods) {
    const span = spanByName.get(m.name);
    const ret = m.isPromise ? `Promise<${kotlinValueType(m.returns)}>` : 'void';
    const params = (m.params || []).map((p) => `${/\w+Options$/.test(p.type) ? pascal(p.type) : kotlinValueType(p.type)} ${p.name}`).join(', ');
    out.push('    @Override');
    out.push(`    public ${ret} ${m.name}(${params}) {`);
    if (!span) {
      if (m.isPromise) {
        out.push(`        ResolvablePromise<${kotlinValueType(m.returns)}> valdiPromise = new ResolvablePromise<>();`);
        out.push(`        valdiPromise.fulfillFailure(new RuntimeException("${m.name}: not translated - no RN body found"));`);
        out.push('        return valdiPromise;');
      }
      out.push('    }');
      out.push('');
      flags.add(`rn-java-missing-body:${m.name}`, 'warning', `No RN Java body found for ${m.name}() - emitted as an honest rejection.`);
      continue;
    }
    if (m.isPromise) out.push(`        ResolvablePromise<${kotlinValueType(m.returns)}> valdiPromise = new ResolvablePromise<>();`);
    out.push(...optionBinds(m, span));
    out.push(...rewriteBody(span, m).map((l) => (l.trim() ? `        ${l.replace(/^\s{8}/, '')}` : '')));
    if (m.isPromise) out.push('        return valdiPromise;');
    out.push('    }');
    out.push('');
  }

  // helper methods the contract bodies call (private utilities, minus RN
  // boilerplate) - carried verbatim with only the host-surface rewrites
  const droppedHelpers = new Set(['getName', 'setListener', 'removeListener', 'addListener', 'removeListeners', 'constructor']);
  const rnClassName = (src.match(/^\s*public\s+class\s+(\w+)/m) || [])[1] || '\u0000';
  const rewriteHelperLine = (l) => {
    let ln = l.replace(/.*getJSModule\(DeviceEventManagerModule\.RCTDeviceEventEmitter\.class\).*?\.emit\s*\(\s*\w+\s*,[^)]*\)\s*;.*/, () => (
      events.length ? events.map((e) => `if (valdiListener != null) valdiListener.${e.name}("");`).join(' ') : `/* plugin2valdi: RN event emission dropped */`
    ));
    ln = ln.replace(/\breactContext\b/g, 'appContext()');
    return ln;
  };
  for (const s of spans) {
    if (methodNames.has(s.name) || droppedHelpers.has(s.name)) continue;
    // constructors (span name == class name) and React-typed signatures are
    // host surface, not helpers
    if (s.name === rnClassName || /ReactApplicationContext|ReactContext/.test(s.params)) continue;
    out.push(...s.body.split('\n').map((l) => rewriteHelperLine(l)));
    out.push('');
  }

  // generated listener slot: storage + RN attach/detach absorption
  if (events.length) {
    const attach = spanByName.get('setListener');
    const detach = spanByName.get('removeListener');
    const attachLines = attach ? rewriteBody(attach, null).filter((l) => l.trim()) : [];
    const detachLines = detach ? rewriteBody(detach, null).filter((l) => l.trim()) : [];
    out.push('    @Override');
    out.push(`    public void setListener(${pascal(moduleName)}Listener listenerSlot) {`);
    out.push('        this.valdiListener = listenerSlot;');
    if (attachLines.length) {
      out.push('        if (listener != null) {');
      out.push(...attachLines.map((l) => `        ${l.replace(/^\s{8}/, '')}`));
      out.push('        }');
    }
    if (detachLines.length) {
      out.push('        if (listener == null) {');
      out.push(...detachLines.map((l) => `        ${l.replace(/^\s{8}/, '')}`));
      out.push('        }');
    }
    out.push('    }');
    out.push('');
  }

  out.push('    public void onLoad() {');
  out.push(`        // plugin2valdi: RN modules have no load lifecycle - empty anchor for the factory.`);
  out.push('    }');
  out.push('');
  out.push('    // plugin2valdi: Valdi runtime that loaded this module carries the app');
  out.push('    // Context (factories run inside a live runtime by construction).');
  out.push('    private static android.content.Context appContext() {');
  out.push('        java.util.List<com.snap.valdi.ValdiRuntime> runtimes = com.snap.valdi.ValdiRuntimeManager.allRuntimes();');
  out.push('        return runtimes.isEmpty() ? null : runtimes.get(0).getContext();');
  out.push('    }');
  out.push('');
  out.push('    @Override');
  out.push('    public int pushToMarshaller(com.snap.valdi.utils.ValdiMarshaller marshaller) {');
  out.push(`        return ${moduleClass}.DefaultImpls.pushToMarshaller(this, marshaller);`);
  out.push('    }');
  out.push('}');
  out.push('');

  flags.add('rn-java-conformance', 'resolved', `Emitted ${moduleClass}Impl implementing the generated ${moduleClass} Kotlin interface: @ReactMethod Promise params became ResolvablePromise bodies, ReactApplicationContext became appContext() (Valdi runtime Context), RN emitter attach/detach absorbed into the generated setListener slot, event emission rerouted to the @ExportProxy listener, unsupported-on-Android rejections kept as honest failures.`);

  return { impl: out.join('\n') };
}
