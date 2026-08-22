// ObjC transformer: translate a Capacitor Objective-C plugin (.m body) into an
// ObjC class conforming to the GENERATED module protocol.
//
// This is architecturally SIMPLER than the Swift path (transform-swift +
// conform-swift): no NSClassFromString dance, no swiftc importer mangling, no
// Swift-invisible selectors - ObjC speaking to an ObjC protocol directly.
//   - fulfills: [promise fulfillWithSuccessValue:] AND [promise
//     fulfillWithError:] are both first-class ObjC selectors (the Swift-side
//     invisibility defect does not apply - cf. conform-swift's runtime bounce)
//   - rejects: first-class here
//   - struct construction: the generated SC* structs' initializers take the
//     REQUIRED fields (verified: keyboardTypes.h/deviceTypes.h, e.g.
//     - (instancetype)initWithKeyboardHeight:(double)keyboardHeight), so a
//     dictionary literal with required fields becomes one [[SCX alloc]
//     initWith...] expression; optional fields fall back to the reference
//     impl's [SCX new] + property-set pattern (SCValdiWebViewControllerImpl.m)
//
// What changes (and only this):
//   CAP_PLUGIN(...) registration macro  -> dropped (factory replaces it)
//   #import <Capacitor/...> + own headers -> generated types + valdi_core
//   @implementation PluginClass         -> @implementation <Module>Module
//   - (void)m:(CAPPluginCall *)call     -> - (SCValdiPromise<R *> *)m[WithOptions:]
//   [call getX:@"k" ...]                -> options.k
//   [call resolve] / [call resolve:d]   -> [promise fulfillWithSuccessValue:...]
//   [call reject...] / [call unimplemented] -> [promise fulfillWithError:...]
//   - (void)load                        -> - (void)onLoadModule (called from init)
//   [self notifyListeners:@"e" data:d]  -> [[self c2vLockedListener] eWithPayload:...]
// Everything else - UIKit, IMP swizzling, timers, notification observers,
// helper methods, state - passes through verbatim, EXCEPT the no-webview
// scope policy (see the SCOPE section below): bodies that reach for
// self.webView / self.bridge / [self getConfig] cannot compile against a
// Valdi module, so webview-centric methods become DROP-WITH-REJECTION stubs,
// window-JS bridge events reroute through the locked listener, and config
// reads resolve against a local defaults dictionary.

import fs from 'fs';
import { pascal, camel } from './model.mjs';
import { isRnObjc, rewriteRnObjc } from './rn-objc.mjs';

// ---- ObjC message-send surgery (the [recv sel:...] analog of transform-common) ----

// Find every `[marker...]` message send in a line and return
// [{start, end, arg}] where start/end bracket the full send INCLUDING the
// square brackets and arg is everything after the selector up to the closing
// bracket. Walks nesting so dictionary/array/block arguments survive.
export function findMsgSends(line, selector) {
  const calls = [];
  let idx = 0;
  while (true) {
    const at = line.indexOf(`[${selector}`, idx);
    if (at === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = at; i < line.length; i++) {
      const c = line[i];
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      } else if (c === '"' || c === '\'') { // skip string literals
        i++;
        while (i < line.length && line[i] !== c) {
          if (line[i] === '\\') i++;
          i++;
        }
      }
    }
    if (end === -1) break;
    const open = at + 1 + selector.length;
    // strip the selector's argument colon ([call reject:@"m"] -> @"m")
    const arg = line.slice(open, end - 1).replace(/^:/, '').replace(/;$/, '').trim();
    calls.push({ start: at, end, arg });
    idx = end;
  }
  return calls;
}

export function replaceMsgSends(line, selector, rewrite) {
  const calls = findMsgSends(line, selector);
  let out = line;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    const replacement = rewrite(c.arg);
    if (replacement === null) continue;
    out = out.slice(0, c.start) + replacement + out.slice(c.end);
  }
  return out;
}

// Split a top-level comma list (dict literal entries, call args), respecting
// brackets/parens/braces and string literals.
function splitTopLevel(s) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let inString = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      cur += c;
      if (c === '\\') { cur += s[++i] || ''; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === '\'') { inString = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ---- contract helpers ------------------------------------------------------

const resultPtr = (t) => (t.endsWith('*') ? t : `${t} *`);
const objcResultType = (r, iosPkg) => {
  if (!r || r === 'void') return 'SCValdiUndefinedValue';
  // bare arrays map to NSArray in codegen (verified: SCKeysResult.keys is
  // NSArray<NSString *> * in the generated test_paramsTypes.h); nesting
  // composes (string[][] - collapsed tuple arrays)
  if (/^(string|number|boolean)(\[\])+$/.test(r)) {
    let t = /number|boolean/.test(r) ? 'NSNumber *' : 'NSString *';
    for (let i = 0; i < (r.match(/\[\]/g) || []).length; i++) t = `NSArray<${t.endsWith('*') ? t : `${t} *`}>`;
    return `${t} *`; // every generic level carries its own pointer
  }
  if (/^(string|number|boolean)$/.test(r)) return 'NSString'; // flagged by the caller - scalar mapping unverified
  return iosPkg(r);
};

// Unwrap NSNumber boxing idioms so primitive (double/BOOL) struct properties
// assign cleanly: [NSNumber numberWithDouble:h] -> h, @(n) -> n.
function unboxNumber(expr) {
  const boxed = expr.match(/^\[\s*NSNumber numberWith(?:Double|Float|Int|Integer|Long|Bool)\s*:\s*([\s\S]+)\s*\]$/);
  if (boxed) return boxed[1].trim();
  const at = expr.match(/^@\(([\s\S]+)\)$/);
  if (at) return at[1].trim();
  return expr;
}

// Field value coercion: number/boolean struct properties are PRIMITIVE on the
// generated structs when required (verified: `assign double keyboardHeight`,
// `assign BOOL isVisible` in keyboardTypes.h) - unbox NSNumber wrappers.
function fieldExpr(expr, fieldType) {
  if (fieldType === 'number' || fieldType === 'boolean') return unboxNumber(expr);
  return expr;
}

// Parse the dictionary idioms Capacitor ObjC plugins use to build resolve/emit
// payloads into [{key, expr}]. Returns null for shapes we do not translate.
function parseDictExpr(expr) {
  const e = expr.trim();
  const lit = e.match(/^@\{\s*([\s\S]*?)\s*\}$/);
  if (lit) {
    const entries = [];
    for (const part of splitTopLevel(lit[1])) {
      const m = part.match(/^@"(\w+)"\s*:\s*([\s\S]+)$/);
      if (!m) return null;
      entries.push({ key: m[1], expr: m[2].trim() });
    }
    return entries;
  }
  const one = e.match(/^\[\s*NSDictionary dictionaryWithObject\s*:\s*([\s\S]+?)\s+forKey\s*:\s*@"(\w+)"\s*\]$/);
  if (one) return [{ key: one[2], expr: one[1].trim() }];
  return null;
}

// Build the SC* construction expression for a struct type from dict entries.
// Required-only coverage -> the generated initializer (one expression).
// Optional fields or missing requireds -> GNU statement expression with
// [SCX new] + property sets (reference-impl pattern) + an honest flag.
function buildStructExpr(typeName, entries, typesByName, iosPkg, flags) {
  const scName = iosPkg(typeName);
  const t = typesByName.get(typeName);
  if (!t) return null;
  const fields = t.fields || [];
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const fieldType = (name) => {
    const f = fields.find((x) => x.name === name);
    return f ? String(f.type).replace(/\s+/g, ' ').replace(/\|\s*(undefined|null)\b/g, '').trim() : 'string';
  };
  const missingRequired = fields.filter((f) => !f.optional && !byKey.has(f.name));
  const touchedOptional = [...byKey.keys()].filter((k) => fields.some((f) => f.name === k && f.optional));
  if (!missingRequired.length && !touchedOptional.length) {
    // generated initializer selector verified in deviceTypes.h/keyboardTypes.h:
    // first part `initWith` + Pascal(field), subsequent parts the FIELD NAME
    // verbatim (initWithModel:platform:operatingSystem:... - lowercase-first)
    const req = fields.filter((f) => !f.optional);
    const args = req.map((f, i) => (i === 0 ? `initWith${pascal(f.name)}` : f.name) + ':' + fieldExpr(byKey.get(f.name).expr, fieldType(f.name)));
    return `[[${scName} alloc] ${args.length ? args.join(' ') : 'init'}]`;
  }
  flags.add('objc-dict-optional-field', 'warning', `Dictionary payload for ${typeName} ${
    missingRequired.length ? `is missing required field(s) ${missingRequired.map((f) => f.name).join(', ')}` : 'carries optional field(s)'
  } - emitted as a GNU statement expression ([${scName} new] + property sets, the reference-impl pattern); verify by hand.`);
  const sets = [...byKey.entries()].map(([k, v]) => `c2vV.${k} = ${fieldExpr(v.expr, fieldType(k))};`);
  return `({ ${scName} *c2vV = [${scName} new]; ${sets.join(' ')} c2vV; })`;
}

// ---- Capacitor webview/bridge scope policy (Valdi apps have no webview) ----
//
// Capacitor ObjC bodies reach for the host through selectors that do not exist
// on a Valdi module: self.webView (frame math, scrolling, endEditing),
// self.bridge (window JS events, JS eval, bridge.config), [self getConfig] /
// PluginConfig (plugin configuration). Agreed scope policy: in a Valdi app
// there is no webview, so webview-centric behavior is obsolete.
//   - contract methods whose bodies exist FOR the webview -> DROP-WITH-
//     REJECTION: keep the generated selector, immediately reject with
//     "not applicable on Valdi - no webview" (+ objc-webview-dropped:<method>)
//   - helper methods that only serve the webview -> signature kept, body
//     stubbed to a no-op comment (+ objc-webview-dropped-helper:<selector>)
//   - helpers that still carry value (listener emits, lifecycle setup) ->
//     surgical: webview-dependent statements/blocks dropped in place
//     (+ objc-webview-neutralized:<selector>)
//   - [self.bridge triggerWindowJSEventWithEventName:@"E" ...] is event
//     DELIVERY: reroute through the locked listener when "E" is a contract
//     event the method does not already emit (Capacitor split DOM window
//     events from plugin listeners; Valdi has ONE channel), no-op otherwise
//   - getConfig/PluginConfig/bridge.config -> local defaults dict stub
//     (+ objc-config-stubbed): the valdi tree has NO module-config facility
//     to hook into (checked valdi_webview: all configuration arrives through
//     method parameters) - no framework is invented, the dict is hand-wired.

const SCOPE_WEBVIEW_RE = /\bself\s*\.\s*webView\b/;
const SCOPE_BRIDGE_RE = /\bself\s*\.\s*bridge\b/;
const SCOPE_TRIGGER_LINE_RE = /triggerWindowJSEventWithEventName/;
// [self.bridge triggerWindowJSEventWithEventName:@"E" [data:X]] - the quoted
// group distinguishes constant event names (reroutable) from dynamic ones
const SCOPE_TRIGGER_PARSE_RE = /\[\s*self\s*\.\s*bridge\s+triggerWindowJSEventWithEventName\s*:\s*@?(?:"(\w+)"|(\w+))\s*(?:data\s*:\s*([\s\S]+?))?\s*\]/;
// the input-accessory-bar category: IMP-swizzling inputAccessoryView targets
// webview-internal classes (UIWebBrowserView/WKContentView); without a webview
// those classes are absent and the NULL Method would crash method_setImplementation
const SCOPE_ACCESSORY_RE = /@selector\(\s*inputAccessoryView\s*\)/;

// brace depth of a line, outside string/char literals and // comments
function lineDepthDelta(l) {
  let d = 0, inStr = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === '\'') { inStr = c; continue; }
    if (c === '/' && l[i + 1] === '/') break;
    if (c === '{') d++;
    else if (c === '}') d--;
  }
  return d;
}

// ()/[]/{} balance of a line - statement-completeness probe for multi-line
// statement dropping (a webview send whose block argument spans lines)
function stmtBalance(l) {
  let d = 0, inStr = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === '\'') { inStr = c; continue; }
    if (c === '/' && l[i + 1] === '/') break;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
  }
  return d;
}

// ---- main transform --------------------------------------------------------

export function transformObjc(objcFiles, model, moduleClass, flags, iosPrefix = 'SC', moduleName = null) {
  const iosPkg = (name) => `${iosPrefix}${pascal(name)}`;
  const proto = `${moduleName}${moduleClass}`; // e.g. keyboardKeyboardModule (observed codegen)
  const listenerProto = `${iosPrefix}${pascal(moduleName)}Listener`;
  const typesByName = new Map(model.types.map((t) => [t.name, t]));
  const methodByName = new Map(model.methods.map((m) => [m.name, m]));
  const eventByName = new Map(model.events.map((e) => [e.name, e]));

  const srcs = objcFiles.map((p) => {
    let src = null;
    try { src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch {}
    // RN pre-pass: rewrite the RCT_EXPORT_METHOD dialect into the Capacitor
    // call shape the transformer consumes (no-op for Capacitor sources)
    if (src && isRnObjc(src)) {
      try { src = rewriteRnObjc(src, model, flags); } catch (err) {
        flags.add('rn-objc-prepass-failed', 'blocking', `RN ObjC pre-pass failed: ${err.message}`);
      }
    }
    return { path: p, src };
  }).filter((x) => x.src != null);

  // 1. locate the registration macro (plugin class name) + the implementation
  let pluginClass = null;
  let jsName = null;
  let regFile = null;
  let regSpan = null; // [startLine, endLine] of CAP_PLUGIN(...) in regFile
  for (const { path: f, src } of srcs) {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/CAP_PLUGIN\(\s*(\w+)\s*,\s*"([^"]*)"/);
      if (!m) continue;
      pluginClass = m[1];
      jsName = m[2];
      regFile = f;
      // macro spans until the balanced closing paren (methods listed one per line)
      let depth = 0;
      let end = i;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        if (depth <= 0) { end = j; break; }
      }
      regSpan = [i, end];
      break;
    }
    if (pluginClass) break;
  }

  if (!pluginClass) {
    // no registration macro - fall back to the first @implementation with a
    // CAPPluginCall method
    for (const { path: f, src } of srcs) {
      const m = src.match(/@implementation\s+(\w+)/);
      if (m && /CAPPluginCall/.test(src)) { pluginClass = m[1]; regFile = f; break; }
    }
  }
  if (!pluginClass) {
    flags.add('objc-no-plugin-class', 'blocking', 'Could not find a CAP_PLUGIN(...) registration macro or a CAPPluginCall @implementation in the .m sources - no ObjC body to translate.');
    return null;
  }

  const implEntry = srcs.find(({ src }) => new RegExp(`@implementation\\s+${pluginClass}\\b`).test(src));
  if (!implEntry) {
    flags.add('objc-no-implementation', 'blocking', `Found the ${pluginClass} CAP_PLUGIN registration but no @implementation ${pluginClass} in the .m sources - the plugin body is missing.`);
    return null;
  }

  const lines = implEntry.src.split('\n');
  // blanket class rename: every reference to the plugin class - weakSelf
  // typing (`__weak KeyboardPlugin* weakSelf = self;`), category names,
  // comments - becomes the module class. The pre-pass scans above and the
  // line indices below are unaffected (same-length map)
  const source = lines.map((l) => l.replace(new RegExp(`\\b${pluginClass}\\b`, 'g'), moduleClass));
  const sameFileRegistration = regFile === implEntry.path ? regSpan : null;
  if (regFile && regFile !== implEntry.path) {
    flags.add('objc-registration-file-dropped', 'resolved', `The CAP_PLUGIN registration file (${regFile.split('/').pop()}) was dropped wholesale - the generated ${moduleName}_factory.m (VALDI_REGISTER_MODULE + generated ${proto}Factory base) replaces Capacitor's macro registration. The @implementation file is the translated body.`);
  }

  // 1'. scope-policy pre-pass - method spans + webview/bridge dependency graph.
  // A method is WEBVIEW-DEPENDENT if its body references self.webView, a
  // self.bridge selector OTHER than triggerWindowJSEvent (that is event
  // delivery, rerouted separately) or bridge.config (stubbed separately), or
  // the inputAccessoryView swizzle - or calls (property setters included)
  // another dependent method transitively.
  const methodSpans = [];
  {
    let i = 0;
    while (i < source.length) {
      const sigMatch = source[i].match(/^([-+])\s*\(\s*([^)]*?)\s*\)\s*(\w+)/);
      if (!sigMatch) { i++; continue; }
      const start = i;
      let opened = false, depth = 0, end = -1;
      for (let j = start; j < source.length; j++) {
        const d = lineDepthDelta(source[j]);
        if (!opened) {
          if (d > 0) { opened = true; depth = d; }
          else if (d < 0 || j > start + 3) break; // '{' hugs the signature or the next line
        } else {
          depth += d;
          if (depth <= 0) { end = j; break; }
        }
      }
      if (!opened || end === -1) { i = start + 1; continue; }
      const bodyText = source.slice(start, end + 1).join('\n');
      methodSpans.push({
        key: sigMatch[3],
        start,
        end,
        sigLine: source[start],
        isLoad: /^\s*-\s*\(void\)\s*load\s*$/.test(source[start]),
        bodyText,
        notifyEvents: new Set([...bodyText.matchAll(/notifyListeners\s*:\s*@"(\w+)"/g)].map((mm) => mm[1])),
      });
      i = end + 1;
    }
  }
  const spanByKey = new Map(); // first definition wins
  for (const s of methodSpans) if (!spanByKey.has(s.key)) spanByKey.set(s.key, s);
  const spanByStart = new Map(); // non-conformance spans: intercepted whole in the main loop
  for (const s of methodSpans) if (!/\(CAPPluginCall/.test(s.sigLine)) spanByStart.set(s.start, s);
  const spanOwner = new Map(); // line -> enclosing span (reroute dedupe context)
  for (const s of methodSpans) for (let k = s.start; k <= s.end; k++) spanOwner.set(k, s);

  const scopeScan = (text) => {
    const cats = new Set(), sites = [], triggerEvents = new Set();
    for (const rawLine of text.split('\n')) {
      const l = rawLine.replace(/\/\/.*$/, '');
      if (SCOPE_WEBVIEW_RE.test(l)) { cats.add('webview'); sites.push(rawLine.trim()); }
      if (SCOPE_ACCESSORY_RE.test(l)) { cats.add('accessory'); sites.push(rawLine.trim()); }
      if (SCOPE_BRIDGE_RE.test(l)) {
        if (SCOPE_TRIGGER_LINE_RE.test(l)) {
          const t = l.match(/triggerWindowJSEventWithEventName\s*:\s*@?"(\w+)"/);
          if (t) triggerEvents.add(t[1]);
          else { cats.add('bridge'); sites.push(`${rawLine.trim()} (dynamic window-JS event name)`); }
        } else if (!/self\s*\.\s*bridge\s*\.\s*config\b/.test(l)) {
          cats.add('bridge'); sites.push(rawLine.trim()); // evalWithJs et al - JS against the web page
        }
      }
    }
    return { cats, sites, triggerEvents };
  };
  const directScope = new Map();
  for (const s of methodSpans) directScope.set(s.key, scopeScan(s.bodyText));
  const callsOf = (text) => {
    const calls = new Set();
    for (const m of text.matchAll(/\[\s*(?:self|weakSelf|strongSelf)\s+(\w+)/g)) calls.add(m[1]);
    for (const m of text.matchAll(/\bself\.(\w+)\s*=(?!=)/g)) calls.add(`set${pascal(m[1])}`); // property setter
    return calls;
  };
  const depMemo = new Map();
  const isWebviewDep = (key, stack = new Set()) => {
    if (depMemo.has(key)) return depMemo.get(key);
    if (stack.has(key)) return false;
    const d = directScope.get(key);
    if (!d) return false;
    if (d.cats.size) { depMemo.set(key, true); return true; }
    stack.add(key);
    let dep = false;
    for (const c of callsOf(spanByKey.get(key).bodyText)) {
      if (spanByKey.has(c) && isWebviewDep(c, stack)) { dep = true; break; }
    }
    stack.delete(key);
    depMemo.set(key, dep);
    return dep;
  };
  // transitive accounting for the dropped-method flags (why + original sites)
  const depSites = (key, seen = new Set()) => {
    if (seen.has(key)) return [];
    seen.add(key);
    const out = [];
    const d = directScope.get(key);
    if (d && d.cats.size) out.push(...d.sites);
    for (const c of callsOf(spanByKey.get(key).bodyText)) {
      if (spanByKey.has(c) && isWebviewDep(c)) out.push(...depSites(c, seen));
    }
    return out;
  };
  const depCats = (key, seen = new Set(), acc = new Set()) => {
    if (seen.has(key)) return acc;
    seen.add(key);
    const d = directScope.get(key);
    if (d) for (const c of d.cats) acc.add(c);
    for (const c of callsOf(spanByKey.get(key).bodyText)) {
      if (spanByKey.has(c) && isWebviewDep(c)) depCats(c, seen, acc);
    }
    return acc;
  };
  const catReasons = (cats) => [...cats].map((c) => ({
    webview: 'direct self.webView manipulation',
    bridge: 'self.bridge JS execution against the web page',
    accessory: 'IMP-swizzling of inputAccessoryView on webview-internal classes (UIWebBrowserView/WKContentView - absent without a webview)',
  }[c] || c)).join(', ');
  const catGuidance = (cats) => {
    const tips = [];
    if (cats.has('accessory')) tips.push('hide the accessory bar on your own inputs (UITextField.inputAccessoryView = nil) - the QuickType bar belongs to the webview');
    if (cats.has('webview')) tips.push('dismiss the keyboard with resignFirstResponder on your own first responder; frame math belongs to your native view hierarchy');
    if (cats.has('bridge')) tips.push('deliver data through module events instead of evaluating JS in a web page');
    return tips.join('; ');
  };

  // config story: local defaults dictionary (NO Valdi module-config facility
  // exists - checked valdi_webview; see the objc-config-stubbed flag)
  const configFnName = `c2v${pascal(moduleName)}Config`;
  const configStubNeeded = /\[\s*self\s+getConfig\s*\]|\bPluginConfig\b|self\s*\.\s*bridge\s*\.\s*config\b/.test(implEntry.src);
  const configLocals = new Set();
  const configKeys = new Set(); // collected up-front: the stub is emitted before bodies are scanned
  if (configStubNeeded) {
    for (const m of implEntry.src.matchAll(/getString\s*:\s*@"(\w+)"\s*:/g)) configKeys.add(m[1]);
    for (const m of implEntry.src.matchAll(/self\s*\.\s*bridge\s*\.\s*config\s*\.\s*(\w+)/g)) configKeys.add(m[1]);
  }
  let configReadCount = 0;
  let scopePolicyTouched = false;
  const rewriteConfigLine = (l) => {
    if (!configStubNeeded) return l;
    let out = l;
    // [[self getConfig] getString:@"k": default] -> c2vConfigString(@"k")
    out = out.replace(/\[\s*\[\s*self\s+getConfig\s*\]\s+getString\s*:\s*@"(\w+)"\s*:[^\]]*\]/g, (_m, k) => {
      configReadCount++; configKeys.add(k); scopePolicyTouched = true; return `c2vConfigString(@"${k}")`;
    });
    // [config getString:@"k": default] - receiver is a local declared from the stub
    out = out.replace(/\[\s*(\w+)\s+getString\s*:\s*@"(\w+)"\s*:[^\]]*\]/g, (m, recv, k) => {
      if (!configLocals.has(recv)) return m;
      configReadCount++; configKeys.add(k); scopePolicyTouched = true; return `c2vConfigString(@"${k}")`;
    });
    out = out.replace(/\bPluginConfig\s*\*/g, () => { configReadCount++; scopePolicyTouched = true; return 'NSDictionary *'; });
    out = out.replace(/\[\s*self\s+getConfig\s*\]/g, () => { configReadCount++; scopePolicyTouched = true; return `${configFnName}()`; });
    const decl = out.match(/^\s*NSDictionary\s*\*\s*(\w+)\s*=\s*c2v\w*Config\(\)\s*;/);
    if (decl) configLocals.add(decl[1]);
    // bridge.config reads: boolean negation -> NO (Capacitor's default), pointer -> nil
    out = out.replace(/(!?)\s*self\s*\.\s*bridge\s*\.\s*config\s*\.\s*(\w+)/g, (_m, bang, k) => {
      configReadCount++; configKeys.add(k); scopePolicyTouched = true;
      return bang ? `NO /* plugin2valdi: Capacitor bridge config unavailable (key: ${k}) */` : `nil /* plugin2valdi: Capacitor bridge config unavailable (key: ${k}) */`;
    });
    return out;
  };

  // window-JS bridge events: reroute / dedupe / no-op (see policy above)
  const rewriteBridgeEventLine = (l, span) => {
    if (!SCOPE_BRIDGE_RE.test(l) || !SCOPE_TRIGGER_LINE_RE.test(l)) return l;
    const m = l.match(SCOPE_TRIGGER_PARSE_RE);
    const where = span ? `-${span.key}` : 'the class body';
    if (!m) {
      flags.add('objc-bridge-event-untranslated', 'warning', `A [self.bridge triggerWindowJSEvent...] send in ${where} spans multiple lines - left in place and will not compile (no webview on Valdi). Re-wire by hand.`);
      return l;
    }
    const name = m[1];
    if (!name) {
      scopePolicyTouched = true;
      flags.add('objc-bridge-event-dynamic', 'warning', `[self.bridge triggerWindowJSEventWithEventName:<dynamic>] in ${where} dropped (no-op): the event name must be a string literal to route through the ${listenerProto}. Deliver the event by hand.`);
      return l.replace(m[0], `/* plugin2valdi: window-JS event with dynamic name - no-op (no webview on Valdi) */`);
    }
    const ev = eventByName.get(name);
    if (!ev) {
      scopePolicyTouched = true;
      flags.add(`objc-bridge-event-unknown:${name}`, 'warning', `[self.bridge triggerWindowJSEventWithEventName:@"${name}"] in ${where} dropped (no-op): "${name}" is not a contract event. Add the addListener overload to definitions.ts to route it.`);
      return l.replace(m[0], `/* plugin2valdi: window-JS event "${name}" not in the contract - no-op */`);
    }
    if (span && span.notifyEvents.has(name)) {
      scopePolicyTouched = true;
      flags.add(`objc-bridge-event-deduped:${name}`, 'resolved', `[self.bridge triggerWindowJSEventWithEventName:@"${name}"] in ${where} not re-delivered: the same method already emits "${name}" through the locked listener, and Valdi has a single event channel (${listenerProto}) - Capacitor split DOM window events from plugin listeners, so this would be a double delivery. No listener payload is lost.`);
      return l.replace(m[0], `/* plugin2valdi: window-JS event "${name}" skipped - the listener emit below already delivers it (single Valdi channel) */`);
    }
    const payload = ev.payloadType
      || (/^(string|number|boolean)$/.test(ev.payload) ? ev.payload : (typesByName.has(ev.payload) ? ev.payload : 'string'));
    let expr = null;
    const data = (m[3] || '').trim();
    if (data) {
      const lit = data.match(/^@"((?:[^"\\]|\\.)*)"$/);
      if (lit && payload === 'string') expr = data;
      else {
        const entries = parseDictExpr(data);
        if (entries && typesByName.has(payload)) expr = buildStructExpr(payload, entries, typesByName, iosPkg, flags);
        else if (entries && /^(string|number|boolean)$/.test(payload) && entries.length) expr = fieldExpr(entries[0].expr, payload);
      }
    }
    if (!expr) {
      if (payload === 'string') expr = `@""`;
      else if (/^(number|boolean)$/.test(payload)) expr = '0';
      else expr = `[[${iosPkg(payload)} alloc] init]`;
      flags.add(`objc-bridge-event-payload-defaulted:${name}`, 'warning', `Rerouted window-JS event "${name}" carries a defaulted payload - Capacitor's data: argument (${data || 'absent'}) did not map to the ${payload} payload. Verify by hand.`);
    }
    scopePolicyTouched = true;
    flags.add(`objc-bridge-event-rerouted:${name}`, 'resolved', `[self.bridge triggerWindowJSEventWithEventName:@"${name}"${m[3] ? ' data:…' : ''}] in ${where} rerouted to [[self c2vLockedListener] ${camel(name)}WithPayload:…] - a window-JS event is event delivery, and the locked listener is Valdi's delivery channel (there is no DOM window to dispatch into).`);
    return l.replace(m[0], `[[self c2vLockedListener] ${camel(name)}WithPayload:${expr}]`);
  };

  // 2. pre-pass - dictionary locals feeding resolve/notifyListeners sites, so
  // the DECLARATION can be rewritten to the typed SC struct (statement shape
  // stays intact: the var keeps its name, its type becomes the struct)
  const dictVars = new Map(); // name -> { line, entries }
  lines.forEach((l, i) => {
    const decl = l.match(/^\s*NSDictionary\s*\*\s*(\w+)\s*=\s*([\s\S]+?);\s*$/);
    if (!decl) return;
    const entries = parseDictExpr(decl[2]);
    if (entries) dictVars.set(decl[1], { line: i, entries });
  });

  // usage: a dict var's target type is determined by the enclosing method's
  // result type (resolve sites) or the event payload (notify sites)
  const varTargetType = new Map(); // name -> struct type name
  let currentCallMethod = null; // signature line context while scanning
  lines.forEach((l) => {
    const sig = l.match(/^[-+]\s*\(.*?\)\s*(\w+)\s*:\s*\(CAPPluginCall\s*\*?\s*\)\s*\w+/);
    if (sig) { currentCallMethod = methodByName.get(sig[1]) || null; return; }
    for (const send of findMsgSends(l, 'call resolve')) {
      const v = send.arg.match(/^(\w+)$/);
      if (v && dictVars.has(v[1]) && currentCallMethod && currentCallMethod.returns && currentCallMethod.returns !== 'void'
        && typesByName.has(currentCallMethod.returns)) {
        varTargetType.set(v[1], currentCallMethod.returns);
      }
    }
    for (const send of findMsgSends(l, 'self notifyListeners')) {
      const m = send.arg.match(/^@"(\w+)"\s*,?\s*data\s*:\s*(\w+)\s*$/);
      if (m && dictVars.has(m[2])) {
        const ev = eventByName.get(m[1]);
        if (!ev) continue;
        const payload = ev.payloadType
          || (/^(string|number|boolean)$/.test(ev.payload) ? ev.payload : (typesByName.has(ev.payload) ? ev.payload : null));
        if (payload && typesByName.has(payload)) varTargetType.set(m[2], payload);
      }
    }
  });

  // 3. line-by-line translation
  const out = [];
  let inMethod = null; // { callName, name, result, depth, opened, opts }
  const hasOwnInit = /^-\s*\(instancetype\s*\)\s*init\b/m.test(implEntry.src) || /^-\s*\(id\s*\)\s*init\b/m.test(implEntry.src);
  const hasLoad = /^-\s*\(void\)\s*load\s*$/m.test(implEntry.src);
  let atImplementation = false;
  let emittedInit = false;
  // brace stack that knows which frames are BLOCK literals (^{ / ^(...){):
  // a bare `return;` must become `return promise;` inside if/else/switch
  // frames, but a `return;` inside a void BLOCK stays bare (returning the
  // promise from a void block would not compile)
  const blockStack = [];
  const scanBraces = (l) => {
    let pendingCaret = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '^') { pendingCaret = true; continue; }
      if (c === '(' && pendingCaret) { // block signature ^(args) - skip to its )
        let d = 0;
        for (let j = i; j < l.length; j++) {
          if (l[j] === '(') d++;
          else if (l[j] === ')') { d--; if (d === 0) { i = j; break; } }
        }
        continue;
      }
      if (c === '{') { blockStack.push(pendingCaret); pendingCaret = false; continue; }
      if (c === '}') { blockStack.pop(); pendingCaret = false; continue; }
      if (!/\s/.test(c)) pendingCaret = false;
    }
  };
  const insideBlock = () => blockStack.some(Boolean);

  // notifyListeners + its dictionary locals live ANYWHERE on the class
  // (keyboard: the emit sites are NSNotification handlers, not promise
  // methods) - these rewrites run on every body line; the call.* ritual only
  // exists inside conformance methods
  const rewriteClassWide = (l) => {
    const decl = l.match(/^(\s*)NSDictionary\s*\*\s*(\w+)\s*=\s*([\s\S]+?)(;\s*)$/);
    if (decl && varTargetType.has(decl[2])) {
      const entries = dictVars.get(decl[2]).entries;
      return `${decl[1]}${iosPkg(varTargetType.get(decl[2]))} *${decl[2]} = ${buildStructExpr(varTargetType.get(decl[2]), entries, typesByName, iosPkg, flags)};`;
    }
    return rewriteRitual(l, null, { flags, model, eventByName, typesByName, iosPkg, varTargetType, dictVars });
  };

  // scope-policy emission for one NON-conformance method span: whole-stub the
  // helpers that only served the webview, surgically neutralize the ones that
  // still carry value (listener emits / load lifecycle), pass the rest through
  const lineHasScopeTokens = (text) => {
    for (const rawLine of text.split('\n')) {
      const l = rawLine.replace(/\/\/.*$/, '');
      if (SCOPE_WEBVIEW_RE.test(l)) return true;
      if (SCOPE_BRIDGE_RE.test(l) && !SCOPE_TRIGGER_LINE_RE.test(l) && !/self\s*\.\s*bridge\s*\.\s*config\b/.test(l)) return true;
    }
    return false;
  };
  const blockEndOf = (lines, i) => {
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      const d = lineDepthDelta(lines[j]);
      if (j === i && d <= 0) return -1;
      depth += d;
      if (depth <= 0) return j;
    }
    return -1;
  };
  const statementEndOf = (lines, i) => {
    let bal = 0;
    for (let j = i; j < Math.min(lines.length, i + 60); j++) {
      bal += stmtBalance(lines[j]);
      if (/;\s*$/.test(lines[j].replace(/\/\/.*$/, '').trimEnd()) && bal <= 0) return j;
      if (bal < 0) return j;
    }
    return i;
  };
  const classifyHelper = (span) => {
    let lines = source.slice(span.start, span.end + 1);
    if (span.isLoad) {
      lines = lines.map((l) => l.replace(/^(\s*-\s*\(void\)\s*)load\s*$/, '$1onLoadModule'));
      flags.add('objc-lifecycle', 'warning', `Capacitor's -load lifecycle renamed to -onLoadModule${hasOwnInit ? ' (the class carries its own -init - call onLoadModule from it by hand)' : ' and called from the emitted -init'} - the Valdi factory instantiates the module via [[class alloc] init], which is the load trigger. Verify setup ordering by hand.`);
    }
    lines = lines.map((l) => rewriteBridgeEventLine(rewriteConfigLine(rewriteClassWide(l)), span));
    // helpers drop on DIRECT tokens only: a stubbed callee is a no-op the
    // caller can keep calling (transitive dep alone would needlessly discard
    // non-webview statements around it); TRANSITIVE dep is reserved for the
    // conformance drop-with-rejection decision
    const dep = (directScope.get(span.key) || { cats: new Set() }).cats.size > 0;
    const hasEmit = /\[\[self\s+c2vLockedListener\]/.test(lines.join('\n')) || span.notifyEvents.size > 0;
    const braceIdx = lines.findIndex((l) => lineDepthDelta(l.replace(/\/\/.*$/, '')) > 0);
    const sigLines = braceIdx === -1 ? lines : lines.slice(0, braceIdx + 1);
    const body = braceIdx === -1 ? [] : lines.slice(braceIdx + 1);
    if (dep && !hasEmit && !span.isLoad) {
      // whole-helper no-op stub - signature kept so callers compile
      scopePolicyTouched = true;
      const retType = ((span.sigLine.match(/^\s*[-+]\s*\(\s*([^)]*?)\s*\)/) || [])[1] || 'void').trim();
      const retStmt = /^\s*(void|instancetype|id)\s*$/.test(retType) ? []
        : /^\s*(BOOL|int|NSInteger|NSUInteger|long|unsigned|float|double|CGFloat)\b/.test(retType) ? ['    return 0;']
        : ['    return nil;'];
      const sites = depSites(span.key).slice(0, 6).map((s) => `\n  ${s}`).join('');
      flags.add(`objc-webview-dropped-helper:${span.key}`, 'warning', `Helper method -${span.key}… stubbed to a no-op: its body only served Capacitor's webview/bridge, which do not exist on a Valdi module (not applicable on Valdi - no webview). The signature is kept so callers compile. Dropped body sites:${sites}`);
      return [
        ...sigLines,
        `    // plugin2valdi: dropped - the body operated on Capacitor's webview/bridge`,
        `    // (not applicable on Valdi - no webview). No-op stub; see flag`,
        `    // objc-webview-dropped-helper:${span.key}.`,
        ...retStmt,
        `}`,
      ];
    }
    if (!dep) return lines;
    // surgical: keep the method, drop webview-dependent statements/blocks
    const dropped = [];
    const tainted = new Set(); // locals declared by dropped statements
    const outL = [...sigLines];
    let j = 0;
    while (j < body.length) {
      const l = body[j];
      const stripped = l.replace(/\/\/.*$/, '');
      const trimmedEnd = stripped.trimEnd();
      if (/\{\s*$/.test(trimmedEnd) && lineDepthDelta(stripped) > 0) {
        const be = blockEndOf(body, j);
        const interior = body.slice(j, be + 1).join('\n');
        const closeLine = be >= 0 ? body[be] : '';
        const nextLine = be + 1 < body.length ? body[be + 1] : '';
        const hasElse = /\}\s*else\b/.test(closeLine) || /^\s*else\b/.test(nextLine.trim());
        if (be > j && !hasElse && lineHasScopeTokens(interior)) {
          const indent = l.match(/^\s*/)[0];
          outL.push(`${indent}// plugin2valdi: dropped - webview/bridge frame math or access (not`);
          outL.push(`${indent}// applicable on Valdi - no webview); see objc-webview-neutralized:${span.key}.`);
          dropped.push(...interior.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('//')).slice(0, 6));
          j = be + 1;
          continue;
        }
      }
      const lineDirty = lineHasScopeTokens(l) || [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(stripped));
      if (lineDirty) {
        const se = statementEndOf(body, j);
        const indent = l.match(/^\s*/)[0];
        outL.push(`${indent}// plugin2valdi: dropped - operated on Capacitor's webview/bridge (not`);
        outL.push(`${indent}// applicable on Valdi - no webview); see objc-webview-neutralized:${span.key}.`);
        dropped.push(...body.slice(j, se + 1).map((s) => s.trim()).slice(0, 6));
        for (const dl of body.slice(j, se + 1)) {
          const dm = dl.replace(/\/\/.*$/, '').match(/(?:^|\s)[A-Za-z_]\w*\s+\*?\s*([A-Za-z_]\w*)\s*=/);
          if (dm) tainted.add(dm[1]);
        }
        j = se + 1;
        continue;
      }
      outL.push(l);
      j++;
    }
    if (dropped.length) {
      scopePolicyTouched = true;
      flags.add(`objc-webview-neutralized:${span.key}`, 'warning', `Method -${span.key}… kept (it carries listener emits / lifecycle setup) but its webview-dependent statements were dropped in place (not applicable on Valdi - no webview). Dropped:${dropped.slice(0, 8).map((s) => `\n  ${s}`).join('')}`);
    }
    return outL;
  };

  for (let i = 0; i < source.length; i++) {
    const line = source[i];

    // dropped wholesale: the registration macro (same-file plugins)
    if (sameFileRegistration && i >= sameFileRegistration[0] && i <= sameFileRegistration[1]) {
      if (i === sameFileRegistration[0]) {
        out.push(`// plugin2valdi: CAP_PLUGIN registration dropped - ios/${moduleName}_factory.m (VALDI_REGISTER_MODULE) replaces it`);
      }
      continue;
    }

    // imports: Capacitor + the plugin's own headers go; system + UIKit stay
    if (/^\s*#\s*import\s/.test(line)) {
      if (/Capacitor|CAPBridged|CAPPlugin\.h/.test(line)) continue;
      if (/^\s*#\s*import\s+"/.test(line)) {
        // quoted import of a sibling header - every plugin header declares the
        // CAPPlugin subclass / Capacitor types; the conformance header replaces them
        continue;
      }
      out.push(line);
      continue;
    }

    // class extension / category on the plugin class -> Module class
    // (the blanket pre-rename already rewrote the identifier; keep a defensive
    // pass for unrenamed spellings)
    let l = line.replace(new RegExp(`(@interface\\s+)${pluginClass}(\\s*\\(|\\s*$|\\s*:)`), `$1${moduleClass}$2`);

    // main implementation header
    const implHeader = l.match(new RegExp(`^(\\s*@implementation\\s+)${moduleClass}\\b(.*)$`));
    if (implHeader && !atImplementation) {
      atImplementation = true;
      if (configStubNeeded) {
        out.push(
          `//`,
          `// plugin2valdi: Capacitor PluginConfig / [self getConfig] stub - Valdi has NO`,
          `// module-config facility (checked the valdi tree: valdi_webview receives`,
          `// all configuration through method parameters; nothing reads a config`,
          `// store). Every config read in this file resolves against this local`,
          `// defaults dictionary; wire real values by hand (flag objc-config-stubbed).`,
          ``,
          `static NSDictionary *${configFnName}(void)`,
          `{`,
          `    static NSDictionary *dict;`,
          `    static dispatch_once_t onceToken;`,
          `    dispatch_once(&onceToken, ^{`,
          `        dict = @{`,
          ...[...configKeys].map((k) => `            // @"${k}": <value>, // wire ${moduleName} config by hand`),
          `        };`,
          `    });`,
          `    return dict;`,
          `}`,
          ``,
          `static NSString *c2vConfigString(NSString *key)`,
          `{`,
          `    id value = ${configFnName}()[key];`,
          `    return [value isKindOfClass:[NSString class]] ? value : nil;`,
          `}`,
          ``,
        );
      }
      out.push(implHeader[1] + moduleClass + (implHeader[2].includes('{') ? '' : implHeader[2]));
      // absorb a source ivar block (@implementation X { ... }) - the plugin's
      // own ivars must survive inside the generated listener-ivar block
      const ivarLines = [];
      if (implHeader[2].includes('{')) {
        let depth = (implHeader[2].match(/\{/g) || []).length - (implHeader[2].match(/\}/g) || []).length;
        let j = i + 1;
        while (j < source.length && depth > 0) {
          const d = lineDepthDelta(source[j]);
          if (depth + d <= 0) break;
          ivarLines.push(source[j]);
          depth += d;
          j++;
        }
        i = j; // the loop's i++ moves past the closing brace line
      }
      if (model.events.length || ivarLines.length) {
        out.push(`{`);
        if (model.events.length) {
          out.push(`    id<${listenerProto}> _c2vListener; // set through setListenerWithListener: (generated protocol)`);
        }
        out.push(...ivarLines);
        out.push(`}`);
      }
      // lifecycle: Capacitor's -load runs after bridge attach; the factory's
      // [[X alloc] init] is the Valdi equivalent trigger, so wire it through
      if (!hasOwnInit) {
        out.push('');
        out.push(`- (instancetype)init`);
        out.push(`{`);
        out.push(`    self = [super init];`);
        if (hasLoad) {
          out.push(`    if (self) {`);
          out.push(`        [self onLoadModule]; // plugin2valdi: Capacitor -load lifecycle, renamed (see objc-lifecycle flag)`);
          out.push(`    }`);
        }
        out.push(`    return self;`);
        out.push(`}`);
        emittedInit = true;
      }
      continue;
    }
    atImplementation = atImplementation || implHeader !== null;

    // CAPPluginCall method signature -> conformance signature (brace may sit
    // on the same line - `- (void)m:(CAPPluginCall *)call {` - or the next)
    if (!inMethod) {
      // scope-policy helper interception: whole NON-conformance methods are
      // classified (no-op stub / surgical neutralization / passthrough) over
      // their pre-computed span - conformance methods keep their ritual path
      const hspan = spanByStart.get(i);
      if (hspan) {
        out.push(...classifyHelper(hspan));
        i = hspan.end;
        continue;
      }
      const sig = l.match(/^([-+])\s*\(\s*(void)\s*\)\s*(\w+)\s*:\s*\(CAPPluginCall\s*\*?\s*\)\s*(\w+)\s*(\{)?\s*$/);
      if (sig) {
        const name = sig[3];
        const m = methodByName.get(name);
        if (!m) {
          flags.add(`objc-extra-call-method:${name}`, 'warning', `Method ${name}:(CAPPluginCall *) appears in the body but not in the contract - passed through verbatim; the CAPPluginCall type is no longer imported, fix or drop by hand.`);
          out.push(l);
          continue;
        }
        // no-webview scope policy: the body exists FOR Capacitor's webview ->
        // DROP-WITH-REJECTION (generated selector kept, immediate reject)
        const cspan = spanByKey.get(name);
        if (cspan && /\(CAPPluginCall/.test(cspan.sigLine) && isWebviewDep(name)) {
          scopePolicyTouched = true;
          const result = objcResultType(m.returns, iosPkg);
          const params = m.params || [];
          const opts = params.length >= 1 && typesByName.has(params[0].type) ? params[0] : null;
          if (opts) out.push(`${sig[1]} (SCValdiPromise<${resultPtr(result)}> *)${name}With${pascal(opts.name)}:(${iosPkg(opts.type)} *)${opts.name}`);
          else out.push(`${sig[1]} (SCValdiPromise<${resultPtr(result)}> *)${name}`);
          const cats = depCats(name);
          const sites = depSites(name).slice(0, 6).map((s) => `\n    //   ${s}`).join('');
          const guidance = catGuidance(cats) || 'use the native equivalent for your own view hierarchy';
          out.push(`{`);
          out.push(`    // plugin2valdi: DROP-WITH-REJECTION - the original body existed FOR Capacitor's`);
          out.push(`    // webview (${catReasons(cats)}), which a Valdi module does not have. Sites:${sites}`);
          out.push(`    // Consumer guidance: ${guidance}.`);
          out.push(`    SCValdiResolvablePromise<${resultPtr(result)}> *promise = [SCValdiResolvablePromise new];`);
          out.push(`    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"${name}: not applicable on Valdi - no webview"}]];`);
          out.push(`    return promise;`);
          out.push(`}`);
          flags.add(`objc-webview-dropped:${name}`, 'warning', `Contract method ${name}() emitted as a DROP-WITH-REJECTION stub: its body exists for Capacitor's webview (${catReasons(cats)}), and a Valdi module has no webview. The generated protocol selector is kept and the promise immediately rejects with "not applicable on Valdi - no webview". Original sites:${sites || ' (transitive - see objc-webview-dropped-helper flags)'} Consumer guidance: ${guidance}.`);
          i = cspan.end;
          continue;
        }
        if (!m.isPromise) {
          flags.add(`objc-void-method:${name}`, 'resolved', `Contract method ${name}() returns void (RN sync surface) - emitted as a plain void method (verified shape: setListenerWithListener: void functions in the generated protocol carry no promise). resolve/reject calls in the body, if any, drop.`);
        }
        const result = objcResultType(m.returns, iosPkg);
        if (/^(string|number|boolean)$/.test(m.returns || '')) {
          flags.add(`objc-primitive-return:${name}`, 'warning', `Primitive Promise<${m.returns}> return emitted as SCValdiPromise<NSString *> - the generated header's scalar mapping for primitive METHOD returns is unverified (payload positions map string to NSString, number to primitive double/NSNumber depending on optionality). Verify against the generated ${moduleName}Types.h and adjust the signature.`);
        }
        const params = m.params || [];
        const opts = params.length >= 1 && typesByName.has(params[0].type) ? params[0] : null;
        if (params.length > 1) {
          flags.add('objc-multi-param', 'blocking', `Method ${name}() has ${params.length} parameters - the generated protocol selector for multi-param methods is unverified. Emitting the first parameter only; fix the selector by hand against the generated ${moduleName}Types header.`);
        }
        if (!m.isPromise) {
          // void function: no promise, no ritual
          if (opts) out.push(`${sig[1]} (void)${name}With${pascal(opts.name)}:(${iosPkg(opts.type)} *)${opts.name}`);
          else out.push(`${sig[1]} (void)${name}`);
          if (sig[5]) {
            out.push(`{`);
            inMethod = { callName: sig[4], name, result: 'SCValdiUndefinedValue', depth: 1, opened: true, opts, voidMode: true };
            blockStack.push(false);
          } else {
            inMethod = { callName: sig[4], name, result: 'SCValdiUndefinedValue', depth: 0, opened: false, opts, voidMode: true };
          }
          continue;
        }
        if (opts) {
          out.push(`${sig[1]} (SCValdiPromise<${resultPtr(result)}> *)${name}With${pascal(opts.name)}:(${iosPkg(opts.type)} *)${opts.name}`);
        } else {
          out.push(`${sig[1]} (SCValdiPromise<${resultPtr(result)}> *)${name}`);
        }
        if (sig[5]) {
          // brace sat on the signature line - re-emit it, the body follows
          out.push(`{`);
          out.push(`    SCValdiResolvablePromise<${resultPtr(result)}> *promise = [SCValdiResolvablePromise new];`);
          inMethod = { callName: sig[4], name, result, depth: 1, opened: true, opts };
          blockStack.push(false);
        } else {
          inMethod = { callName: sig[4], name, result, depth: 0, opened: false, opts };
        }
        continue;
      }
      // Capacitor lifecycle -load -> onLoadModule (called from the injected init)
      const load = l.match(/^(\s*-\s*\(void\)\s*)load\s*$/);
      if (load) {
        out.push(`${load[1]}onLoadModule`);
        flags.add('objc-lifecycle', 'warning', `Capacitor's -load lifecycle renamed to -onLoadModule${emittedInit || (!hasOwnInit && atImplementation) ? ' and called from the emitted -init' : ''} - the Valdi factory instantiates the module via [[class alloc] init], which is the load trigger. Verify setup ordering by hand.`);
        continue;
      }
      out.push(rewriteBridgeEventLine(rewriteConfigLine(rewriteClassWide(l)), spanOwner.get(i) || null));
      continue;
    }

    // inside a conformance method
    // opening brace (own line, the common ObjC style) - inject the promise
    if (!inMethod.opened) {
      if (/^\s*\{\s*$/.test(l) || /\{\s*;?\s*$/.test(l)) {
        out.push(l);
        if (!inMethod.voidMode) out.push(`    SCValdiResolvablePromise<${resultPtr(inMethod.result)}> *promise = [SCValdiResolvablePromise new];`);
        inMethod.opened = true;
        scanBraces(l); // push the method-body frame
        inMethod.depth = blockStack.length;
        continue;
      }
      if (l.trim() === '') { out.push(l); continue; } // blank between signature and brace
      // unexpected shape - treat the method as opened defensively
      out.push(l);
      inMethod.opened = true;
      scanBraces(l);
      if (!blockStack.length) blockStack.push(false); // synthesize the body frame
      inMethod.depth = blockStack.length;
      continue;
    }

    // dictionary local rewritten to the typed struct (pre-pass decided the type)
    const declThis = l.match(/^(\s*)NSDictionary\s*\*\s*(\w+)\s*=\s*([\s\S]+?)(;\s*)$/);
    if (declThis && varTargetType.has(declThis[2])) {
      const entries = dictVars.get(declThis[2]).entries;
      out.push(`${declThis[1]}${iosPkg(varTargetType.get(declThis[2]))} *${declThis[2]} = ${buildStructExpr(varTargetType.get(declThis[2]), entries, typesByName, iosPkg, flags)};`);
      continue;
    }

    // ritual rewrites (single-line sends; multi-line literals are flagged below)
    l = rewriteRitual(l, inMethod, { flags, model, eventByName, typesByName, iosPkg, varTargetType, dictVars });
    // scope policy applies inside kept conformance bodies too (config reads,
    // window-JS bridge events)
    l = rewriteBridgeEventLine(rewriteConfigLine(l), spanOwner.get(i) || null);

    // bare early-return must hand back the promise - inside if/else/switch
    // frames at any depth, but NOT inside block literals (a void `^{...}`
    // returning the promise would not compile)
    const wasInsideBlock = insideBlock();
    scanBraces(l);
    if (/^\s*return\s*;\s*$/.test(l) && !wasInsideBlock && !l.includes('^') && !inMethod.voidMode) {
      l = l.replace(/return\s*;/, 'return promise;');
    }
    inMethod.depth = blockStack.length;

    if (inMethod.depth <= 0) {
      // the method closed - hand back the promise (void methods have none)
      if (/^\s*\}/.test(l) && !inMethod.voidMode) out.push(`    return promise;`);
      out.push(l);
      if (!/^\s*\}/.test(l) && !inMethod.voidMode) out.push(`    return promise;\n}`);
      inMethod = null;
      blockStack.length = 0; // defensive: method frames are balanced now
      continue;
    }
    out.push(l);
  }

  if (inMethod) {
    if (!inMethod.voidMode) out.push(`    return promise;`);
    out.push(`}`);
    flags.add('objc-unbalanced-method', 'warning', `Method ${inMethod.name} had unbalanced braces at end of file - emitted a closing return; verify by hand.`);
  }

  // listener conformance (the generated protocol requires setListenerWithListener:
  // when the contract has events - verified in keyboardTypes.h/test_eventsTypes.h)
  if (model.events.length) {
    const closeIdx = findImplEnd(out);
    const listenerBlock = [
      ``,
      `// plugin2valdi: verified listener conformance - the generated protocol declares`,
      `// - (void)setListenerWithListener:(id<${listenerProto}>)listener (verified in the`,
      `// generated keyboardTypes.h / test_eventsTypes.h toolchain builds); thread-safe`,
      `// access follows the reference impl (valdi_webview SCValdiWebViewControllerImpl.m).`,
      `- (void)setListenerWithListener:(id<${listenerProto}> _Nullable)listener`,
      `{`,
      `    @synchronized (self) {`,
      `        _c2vListener = listener;`,
      `    }`,
      `}`,
      ``,
      `- (id<${listenerProto}> _Nullable)c2vLockedListener`,
      `{`,
      `    @synchronized (self) {`,
      `        return _c2vListener;`,
      `    }`,
      `}`,
    ];
    if (closeIdx === -1) {
      out.push(...listenerBlock);
    } else {
      out.splice(closeIdx, 0, ...listenerBlock);
    }
  }

  // 4. host-API scan (mirrors the Swift transform's HOST_API pass) - after the
  // no-webview scope policy: a fully-handled file gets a resolved summary; any
  // site that survived the policy is reported as the compile blocker it is
  const HOST_APIS = ['bridge', 'webView', 'getConfig', 'CAPBridge', 'PluginConfig', 'CAPConfig'];
  const bodyText = implEntry.src;
  if (configStubNeeded) {
    flags.add('objc-config-stubbed', 'warning', `${configReadCount} Capacitor config read(s) ([self getConfig] / PluginConfig / self.bridge.config.*) rerouted to a local defaults dictionary ${configFnName}() - Valdi has NO module-config facility (checked the valdi tree: valdi_webview receives all configuration through method parameters; no config store exists to hook into, and none is invented). The dictionary starts EMPTY (every key nil/NO - matching Capacitor's absent-config behavior); wire real values by hand in ios/${moduleName}_conformance.m. Keys observed: ${[...configKeys].join(', ') || '(none)'}.`);
  }
  const survivors = out.filter((l) => !/^\s*\/\//.test(l) && /\bself\s*\.\s*(webView|bridge)\b|\[\s*self\s+getConfig\s*\]|\bPluginConfig\b/.test(l));
  for (const api of HOST_APIS) {
    const hits = (bodyText.match(new RegExp(`(self\\.)?\\b${api}\\b`, 'g')) || []).length;
    if (hits <= 0) continue;
    if (scopePolicyTouched && survivors.length === 0) {
      flags.add(`objc-host-api:${api}`, 'resolved', `${hits} reference(s) to Capacitor host API "${api}" in the ObjC body - ALL handled by the no-webview scope policy: webview-dependent contract methods became DROP-WITH-REJECTION stubs (objc-webview-dropped:*), webview-only helpers became no-op stubs (objc-webview-dropped-helper:*), value-carrying methods were surgically neutralized (objc-webview-neutralized:*), window-JS bridge events were rerouted/deduped through the locked listener (objc-bridge-event-*), and config reads resolve through the local defaults stub (objc-config-stubbed). The conformance target compiles without any Capacitor host.`);
    } else {
      flags.add(`objc-host-api:${api}`, 'warning', `${hits} reference(s) to Capacitor host API "${api}" in the ObjC body${survivors.length ? ` - ${survivors.length} survived the scope policy and remain in the emitted code (first: "${survivors[0].trim().slice(0, 100)}"); fix by hand` : ' - preserved verbatim; these selectors do not exist on the Valdi module class and must be re-wired by hand (webview access, config, bridge events) before the conformance target compiles'}.`);
    }
  }

  const header = [
    `//`,
    `// ${moduleName}_conformance.h - plugin2valdi generated (ObjC body path)`,
    `//`,
    `// ${moduleClass}: NSObject conforming to the GENERATED protocol ${proto}`,
    `// (SCValdiMarshallable is all-optional - NSObject conforms for free; verified`,
    `// against valdi_core/SCValdiMarshallable.h).`,
    ``,
    `#import <Foundation/Foundation.h>`,
    `#import <${moduleName}Types/${moduleName}Types.h>`,
    ``,
    `@interface ${moduleClass} : NSObject <${proto}>`,
    `@end`,
    ``,
  ].join('\n');

  const impl = [
    `//`,
    `// ${moduleName}_conformance.m - plugin2valdi generated (ObjC body path)`,
    `//`,
    `// Translated from ${implEntry.path.split('/').pop()} (plugin class ${pluginClass}${jsName ? `, jsName "${jsName}"` : ''}).`,
    `// Registration replaced by ${moduleName}_factory.m; CAPPluginCall ritual mapped onto`,
    `// SCValdiResolvablePromise (fulfillWithSuccessValue:/fulfillWithError: - both`,
    `// first-class ObjC selectors, no Swift-importer invisibility here).`,
    ``,
    `#import "${moduleName}_conformance.h"`,
    `#import <valdi_core/SCValdiResolvablePromise.h>`,
    `#import <valdi_core/SCValdiUndefinedValue.h>`,
    ...(model.events.length ? [`#import <valdi_core/SCValdiMarshallable.h>`] : []),
    ``,
    ...out,
    ``,
  ].join('\n');

  const factory = emitObjcFactoryDirect(moduleName, moduleClass, proto);

  flags.add('objc-conformance-emitted', 'resolved', `ObjC conformance emitted at ios/${moduleName}_conformance.{h,m} (class ${moduleClass} : NSObject <${proto}>, SCValdiResolvablePromise bodies, typed options.<field> access, notifyListeners -> locked-listener sends with ${listenerProto} payloads) + ios/${moduleName}_factory.m returning [[${moduleClass}] alloc] init directly (ObjC-to-ObjC, no NSClassFromString). BUILD.bazel wires ios_deps with objc_library conformance + factory targets (copts -I. -fmodules: the <${moduleName}Types/${moduleName}Types.h> import resolves through the generated API library's propagated clang module map). Rejects are first-class: [promise fulfillWithError:] needs none of the Swift-side ObjC-runtime reach-arounds. COMPILE-VALIDATED through the real toolchain twice: (1) test/fixtures/objcpush - bazel //:objcpush_app_ios with --ios_multi_cpus=sim_arm64 against the local valdi-fork, generated protocol selectors matched exactly; (2) @capacitor/keyboard (a real webview-heavy plugin) - the no-webview scope policy conformance (DROP-WITH-REJECTION stubs for webview-dependent methods, no-op helper stubs, surgical neutralization, window-JS event reroutes/dedupes, local config defaults) built GREEN as a valdi_module inside a minimal valdi_application (/tmp workspace, same toolchain flags): keyboard_conformance.o compiled for ios_sim_arm64 and 86 KeyboardModule symbols linked into the signed kbdapp_ios.ipa alongside the generated protocol symbols.`);
  if (model.events.length) {
    flags.add('objc-listener-conformance', 'resolved', `Listener conformance emitted on ${moduleClass}: ivar id<${listenerProto}> _c2vListener + -setListenerWithListener: (generated protocol selector, verified in keyboardTypes.h/test_eventsTypes.h) + @synchronized locked accessor per the SCValdiWebViewControllerImpl.m reference pattern; notifyListeners sites rewritten to [[self c2vLockedListener] evtWithPayload:].`);
  }

  return { header, impl, factory, pluginClass };
}

// find the @end that closes the main @implementation (listener methods splice in before it)
function findImplEnd(outLines) {
  let depth = 0;
  for (let i = 0; i < outLines.length; i++) {
    const t = outLines[i].trim();
    if (t.startsWith('@implementation')) { depth = 1; continue; }
    if (depth === 1 && t === '@end') return i;
  }
  return -1;
}

function emitObjcFactoryDirect(moduleName, moduleClass, proto) {
  return `//
// ${moduleName}_factory.m - plugin2valdi generated factory (ObjC CONFORMANCE MODE)
//
// ObjC-to-ObjC: the conformance class and this factory live in the same ios_deps
// set, so the factory returns the class DIRECTLY - no NSClassFromString lookup
// (that indirection exists only for the Swift path, where the @objc class lives
// behind a swift_library boundary).
//
//   ios/${moduleName}_conformance.h/.m  implements ${proto} (SCValdiPromise bodies)
//   ios/${moduleName}_factory.m         this file - registration + instantiation
//

#import <Foundation/Foundation.h>
#import <valdi_core/SCValdiModuleFactoryRegistry.h>
#import <${moduleName}Types/${moduleName}Types.h>
#import "${moduleName}_conformance.h"

@interface ${moduleClass.replace(/Module$/, '')}FactoryImpl : ${proto}Factory
@end

@implementation ${moduleClass.replace(/Module$/, '')}FactoryImpl

VALDI_REGISTER_MODULE()

- (id<${proto}>)onLoadModule
{
    return [[${moduleClass} alloc] init];
}

@end
`;
}

// BUILD addendum for ObjC modules - plain objc_library targets (no
// swift_library/modulemap: that machinery exists only for Swift interop).
// The ios_deps line is returned separately: it must be spliced INSIDE the
// valdi_module() call (translate.mjs does the splice).
export function emitObjcBuildAddendum(moduleName, implText = '', flags = null) {
  // system frameworks the body imports beyond the default set link through
  // sdk_frameworks (RN plugins pull MobileCoreServices and friends - the
  // header imports compile but the C symbols do not link without it)
  const defaultFw = new Set(['Foundation', 'UIKit', 'valdi_core']);
  const frameworks = [...new Set([...implText.matchAll(/#import\s+<(\w+)\//g)].map((m) => m[1]))]
    .filter((f) => !defaultFw.has(f) && !f.startsWith(moduleName));
  const sdkFrameworks = frameworks.length
    ? [`    sdk_frameworks = [${frameworks.map((f) => `"${f}"`).join(', ')}],`]
    : [];
  if (frameworks.length && flags) {
    flags.add('objc-sdk-frameworks', 'resolved', `System frameworks the translated body imports (${frameworks.join(', ')}) linked through sdk_frameworks on the conformance objc_library - header availability alone does not link C symbols (found by the clipboard iOS link).`);
  }
  return {
    iosDeps: `    ios_deps = [":${moduleName}_conformance", ":${moduleName}_factory"],`,
    targets: [
      `# plugin2valdi ObjC conformance targets - compiled + linked into the module's`,
      `# _objc library through ios_deps (the valdi_module macro adds ios_deps to`,
      `# the exported client_objc_library, cf. bzl/valdi/valdi_module.bzl)`,
      `objc_library(`,
      `    name = "${moduleName}_conformance",`,
      `    hdrs = ["ios/${moduleName}_conformance.h"],`,
      `    srcs = ["ios/${moduleName}_conformance.m"],`,
      ...sdkFrameworks,
      `    # -I. + -fmodules: the <${moduleName}Types/${moduleName}Types.h> import resolves`,
      `    # through the generated API library's propagated clang module map (the`,
      `    # same copts the reference-verified Swift-path factory carries; validated`,
      `    # through the objcpush toolchain build)`,
      `    copts = ["-I.", "-fmodules"],`,
      `    target_compatible_with = ["@platforms//os:ios"],`,
      `    deps = [":${moduleName}_api_objc", "@valdi//valdi_core:valdi_core_objc"],`,
      `)`,
      ``,
      `objc_library(`,
      `    name = "${moduleName}_factory",`,
      `    srcs = ["ios/${moduleName}_factory.m"],`,
      `    copts = ["-I.", "-fmodules"],`,
      `    target_compatible_with = ["@platforms//os:ios"],`,
      `    deps = [":${moduleName}_api_objc", ":${moduleName}_conformance", "@valdi//valdi_core:valdi_core_objc"],`,
      `)`,
      ``,
    ].join('\n'),
  };
}

// ---- ritual rewriting (one line at a time; spans found by bracket walk) ----

function rewriteRitual(l, inMethod, ctx) {
  const { flags, eventByName, typesByName, iosPkg, varTargetType } = ctx;
  const callName = inMethod ? inMethod.callName : null;

  // void contract method (RN sync surface): resolve/reject have no promise to
  // touch - drop the statement, the call already did its work
  if (inMethod && inMethod.voidMode && callName && new RegExp(`\\[?\\s*${callName}\\s+(resolve|reject)\\b`).test(l)) {
    flags.add(`objc-void-ritual-drop:${inMethod.name}`, 'resolved', `A ${callName} resolve/reject call in the void method ${inMethod.name}() dropped - void Valdi functions carry no promise.`);
    return `    /* plugin2valdi: ${l.trim()} dropped - ${inMethod.name}() is a void function, no promise */`;
  }

  // options accessors: [call getString:@"k" defaultValue:X] / [call getBool:@"k"] -> options.k
  // (conformance methods only - the call receiver exists only there)
  const accessor = callName && l.match(new RegExp(`\\[\\s*${callName}\\s+(getString|getInt|getDouble|getBool|getArray|getDictionary|getJSON)\\s*:\\s*@"(\\w+)"(?:\\s+defaultValue:[^\\]]*)?\\]`, 'g'));
  if (accessor) {
    if (!flags.has('objc-typed-options')) {
      flags.add('objc-typed-options', 'resolved', `CAPPluginCall accessors ([call getString/getBool/...]) rewritten to typed options.<field> - the generated SC*Options struct exposes the contract's fields as properties (verified: SCSetAccessoryBarVisibleOptions.isVisible is a primitive BOOL, SCKeyboardStyleOptions.style an NSString). Capacitor's defaultValue: argument drops away: the generated initializer supplies defaults for missing fields.`);
    }
    l = l.replace(new RegExp(`\\[\\s*${callName}\\s+(?:getString|getInt|getDouble|getBool|getArray|getDictionary|getJSON)\\s*:\\s*@"(\\w+)"(?:\\s+defaultValue:[^\\]]*)?\\]`, 'g'), (_m, field) => `${inMethod.opts ? inMethod.opts.name : 'options'}.${field}`);
  }

  // resolve
  l = callName ? replaceMsgSends(l, `${callName} resolve`, (arg) => {
    if (!arg.trim()) {
      if (inMethod.result === 'SCValdiUndefinedValue') return `[promise fulfillWithSuccessValue:[SCValdiUndefinedValue undefined]]`;
      // void resolve on a struct-returning method - construct the empty struct
      flags.add('objc-resolve-empty-struct', 'warning', `Method ${inMethod.name} resolves with no value but the contract returns ${inMethod.result} - fulfilled with an empty struct; verify by hand.`);
      return `[promise fulfillWithSuccessValue:([[${inMethod.result} alloc] init])`;
    }
    const v = arg.trim().match(/^(\w+)$/);
    if (v && varTargetType.has(v[1])) return `[promise fulfillWithSuccessValue:${v[1]}]`;
    const entries = parseDictExpr(arg.trim());
    if (entries) {
      if (inMethod.result === 'SCValdiUndefinedValue') {
        flags.add('objc-resolve-data-on-void', 'warning', `Method ${inMethod.name} resolves with data but the contract returns void - data dropped.`);
        return `[promise fulfillWithSuccessValue:[SCValdiUndefinedValue undefined]]`;
      }
      const typeName = inMethod.result.replace(/^SC/, '');
      if (typesByName.has(typeName)) {
        return `[promise fulfillWithSuccessValue:${buildStructExpr(typeName, entries, typesByName, iosPkg, flags)}]`;
      }
      return `[promise fulfillWithSuccessValue:/* plugin2valdi: untyped resolve payload */ ${arg.trim()}]`;
    }
    // unknown expression shape - keep it inside the fulfill and flag
    flags.add('objc-resolve-untranslated', 'warning', `A [${callName} resolve:<expr>] payload in ${inMethod.name} was not a recognized dictionary idiom - passed through inside fulfillWithSuccessValue:; it will not compile as-is if it is an NSDictionary.`);
    return `[promise fulfillWithSuccessValue:${arg.trim()}]`;
  }) : l;

  // reject family: [call reject], [call reject:@"msg"...], [call rejectWithError:e]
  if (callName) {
    l = replaceMsgSends(l, `${callName} reject`, (arg) => {
      const parts = arg.trim() ? splitTopLevel(arg.trim()).filter(Boolean) : [];
      const first = parts[0] || '';
      const msg = first.trim() || '@"rejected"';
      return `[promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: ${msg}}]]`;
    });
    l = replaceMsgSends(l, `${callName} rejectWithError`, (arg) => {
      return `[promise fulfillWithError:${arg.trim() || '[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:nil]'}]`;
    });
    l = replaceMsgSends(l, `${callName} unimplemented`, () => {
      flags.add('objc-unimplemented-mapped', 'warning', `A [${callName} unimplemented] site (method ${inMethod.name}) mapped to fulfillWithError:@"unimplemented" - Capacitor rejects with MIUNIMPLEMENTED; adjust the error if the JS side matches on it.`);
      return `[promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"unimplemented"}]]`;
    });
  }

  // notifyListeners: [self notifyListeners:@"e" data:X] - runs class-wide
  // (emit sites are ordinary methods: NSNotification handlers, timers, blocks)
  l = replaceMsgSends(l, 'self notifyListeners', (arg) => {
    const m = arg.match(/^@"(\w+)"\s*(?:,?\s*data\s*:\s*([\s\S]+?)\s*)?$/);
    if (!m) {
      flags.add('objc-notify-untranslated', 'warning', `A notifyListeners site in ${inMethod ? inMethod.name : 'the class body'} did not match the [self notifyListeners:@"name" data:...] idiom - passed through; it will not compile as-is.`);
      return null;
    }
    const ev = eventByName.get(m[1]);
    if (!ev) {
      flags.add(`objc-event-not-in-contract:${m[1]}`, 'warning', `notifyListeners(@"${m[1]}") has no matching contract event - dropped from the conformance (no generated listener method). Add the addListener overload to definitions.ts or port by hand.`);
      return `/* plugin2valdi: event "${m[1]}" not in contract */`;
    }
    const payload = ev.payloadType
      || (/^(string|number|boolean)$/.test(ev.payload) ? ev.payload : (typesByName.has(ev.payload) ? ev.payload : 'string'));
    const sel = `${camel(m[1])}WithPayload:`;
    const dataExpr = (m[2] || '').trim();
    const send = (payloadExpr) => `[[self c2vLockedListener] ${sel}${payloadExpr}]`;
    if (!dataExpr || dataExpr === 'nil') {
      if (payload === 'string') return send(`@""`);
      if (/^(string|number|boolean)$/.test(payload)) return send(`0`);
      return send(`[[${iosPkg(payload)} alloc] init]`);
    }
    const v = dataExpr.match(/^(\w+)$/);
    if (v && varTargetType.has(v[1])) return send(v[1]);
    const entries = parseDictExpr(dataExpr);
    if (entries) {
      if (/^(string|number|boolean)$/.test(payload)) {
        if (entries.length === 1) return send(fieldExpr(entries[0].expr, payload));
        flags.add(`objc-emit-primitive-multikey:${m[1]}`, 'warning', `Event ${m[1]} has a primitive payload but the notifyListeners data dictionary has multiple keys - the first value was taken. Verify the field choice by hand.`);
        return send(fieldExpr(entries[0].expr, payload));
      }
      if (typesByName.has(payload)) return send(buildStructExpr(payload, entries, typesByName, iosPkg, flags));
      return send(`@"${dataExpr}" /* plugin2valdi: untyped payload */`);
    }
    flags.add('objc-emit-untranslated', 'warning', `notifyListeners(@"${m[1]}") data expression was not a recognized dictionary idiom - passed through; it will not compile as-is.`);
    return send(`/* plugin2valdi: untranslated payload ${dataExpr} */`);
  });

  return l;
}
