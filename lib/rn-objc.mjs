// RN ObjC(.mm) pre-pass: rewrite the RCT_EXPORT_METHOD dialect into the
// Capacitor ObjC shape transform-objc already consumes.
//
//   RCT_EXPORT_METHOD(getString:(RCTPromiseResolveBlock)resolve
//                     reject:(RCTPromiseRejectBlock)reject) { ... }
//     -> - (void)getString:(CAPPluginCall *)call { ... }
//        with resolve(X) -> [call resolve:X], reject(c,m,e) -> [call reject:m]
//   RCT_EXPORT_METHOD(setString:(NSString *)content) { ... }
//     -> - (void)setString:(CAPPluginCall *)call {
//          NSString *content = [call getString:@"content" defaultValue:@""];
//          ... }
//   RN attach/detach (setListener/removeListener bodies) survive as
//   c2vRnAttach/c2vRnDetach - the conformance calls them when the Valdi
//   listener slot changes.
//   sendEventWithName:CONST body:X -> [[self c2vLockedListener] <m>WithPayload:@""]
//   (event constants mapped through model.events[].fromConstant)

export function isRnObjc(src) {
  return /RCT_EXPORT_METHOD/.test(src);
}

// Vendor-class detection: receivers that are neither system-prefixed
// (NS/UI/CF/CG/UT - the ObjC convention), declared in this file, nor
// literal self/super references name the plugin's engine dependencies
// (AsyncStorage: RNStorage, StorageRegistry, RNCAsyncStorage - classes
// living in Swift files or sibling engines the module does not carry).
// Bodies depending on them become honest rejections.
const SYSTEM_PREFIXES = /^(NS|UI|CF|CG|UT|CA|MK|CL|WK|AV|MP|CN|SK|SCN|MDL|CT)/;
function findVendorClasses(src, body) {
  const declared = new Set([...src.matchAll(/@(?:implementation|interface)\s+(\w+)/g)].map((m) => m[1]));
  const suspects = new Set();
  for (const m of body.matchAll(/\[\s*([A-Z]\w+)[\s.]/g)) suspects.add(m[1]); // [Cls msg] / [Cls.prop msg]
  for (const m of body.matchAll(/(^|[^\w.])([A-Z]\w+)\.[A-Z]\w/g)) suspects.add(m[2]); // Cls.prop
  for (const m of body.matchAll(/(?:^|\n)\s*([A-Z]\w+)\s*\*\s*\w+\s*=/g)) suspects.add(m[1]); // Cls *x =
  const vendors = [];
  for (const s of suspects) {
    if (declared.has(s) || SYSTEM_PREFIXES.test(s)) continue;
    if (s === 'Self' || s === 'YES' || s === 'NO') continue;
    vendors.push(s);
  }
  return vendors;
}

const DROPPED_METHODS = new Set(['requiresMainQueueSetup', 'methodQueue', 'supportedEvents', 'startObserving', 'stopObserving']);
const ATTACH_METHODS = new Set(['setListener']);
const DETACH_METHODS = new Set(['removeListener']);
// RN emitter boilerplate that carries no body worth keeping
const BOILERPLATE = new Set(['addListener', 'removeListeners']);

function balancedEnd(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// split "a, b, c" on top-level commas (reject(code, msg, err) args)
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// parse "name:(T1)p1 label:(T2)p2" selector parts (spaced colons tolerated);
// a trailing bare identifier is a zero-arg selector
function parseSelector(sig) {
  const parts = [];
  const re = /(\w+)\s*:\s*\(([^)]+)\)\s*(?:__unused\s+)?(\w+)|(\w+)\s*$/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(sig)) !== null) {
    if (m.index < consumed) continue;
    if (m[4] !== undefined && m[4] !== null && !sig.slice(0, m.index).trim().endsWith(':') && parts.length === 0) {
      // bare selector (no colon at all) - only valid as the whole signature
      if (!sig.slice(re.lastIndex).trim()) return { bare: m[4], parts: [] };
      continue;
    }
    parts.push({ sel: m[1], type: (m[2] || '').replace(/\s+/g, ' ').replace(/\b(nonnull|null|__unused|nullable|_Nullable|_Nonnull)\s*/g, '').replace(/\s+/g, ' ').trim(), param: m[3] });
    consumed = re.lastIndex;
  }
  return { bare: null, parts };
}

const ACCESSORS = {
  'NSString *': (n, k) => `NSString *${n} = [call getString:@"${k}" defaultValue:@""]`,
  'NSString*': (n, k) => `NSString *${n} = [call getString:@"${k}" defaultValue:@""]`,
  'NSArray<NSString *> *': (n, k) => `NSArray<NSString *> *${n} = [call getArray:@"${k}"]`,
  'NSArray<NSDictionary *> *': (n, k) => `NSArray<NSDictionary *> *${n} = [call getArray:@"${k}"]`,
  'NSArray *': (n, k) => `NSArray *${n} = [call getArray:@"${k}"]`,
  'NSArray*': (n, k) => `NSArray *${n} = [call getArray:@"${k}"]`,
  'double': (n, k) => `double ${n} = [call getDouble:@"${k}"]`,
  'int': (n, k) => `int ${n} = [call getInt:@"${k}"]`,
  'BOOL': (n, k) => `BOOL ${n} = [call getBool:@"${k}"]`,
};

// rewrite resolve(X) -> [call resolve:X] and reject(c, m, e) -> [call reject:m]
// with paren-balanced argument capture
function rewritePromiseCalls(body) {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const m = /(?<![\w.])resolve\s*\(/g.exec(body.slice(i));
    const r = /(?<![\w.])reject\s*\(/g.exec(body.slice(i));
    const pick = (a, b) => {
      if (!a) return b;
      if (!b) return a;
      return a.index <= b.index ? a : b;
    };
    const hit = pick(m, r);
    if (!hit) { out += body.slice(i); break; }
    const abs = i + hit.index;
    const kind = hit[0].startsWith('resolve') ? 'resolve' : 'reject';
    out += body.slice(i, abs);
    const open = abs + hit[0].length - 1;
    const close = balancedEnd(body, open);
    if (close === -1) { out += body.slice(abs); break; }
    const argsRaw = body.slice(open + 1, close);
    if (kind === 'resolve') {
      out += argsRaw.trim() ? `[call resolve:${argsRaw.trim()}]` : '[call resolve]';
    } else {
      const args = splitArgs(argsRaw);
      const msg = args.length >= 2 ? args[1] : (args[0] || '@""');
      out += `[call reject:${msg}]`;
    }
    i = close + 1;
  }
  return out;
}

export function rewriteRnObjc(src, model, flags) {
  const eventsByConstant = new Map((model.events || []).filter((e) => e.fromConstant).map((e) => [e.fromConstant, e]));
  let out = src;

  // 1. RCT event emission -> locked listener call
  out = out.replace(/\[\s*self\s+sendEventWithName\s*:\s*(\w+)\s+body\s*:[^;\n]*\]|sendEventWithName\s*:\s*(\w+)\s+body\s*:[^;\n]*/g, (whole, a, b) => {
    const ident = a || b;
    // resolve the constant through the source text
    const cm = out.match(new RegExp(`NSString\\s*\\*const\\s+${ident}\\s*=\\s*@"([A-Za-z0-9_]+)"`));
    const ev = cm && eventsByConstant.get(cm[1]);
    if (!ev) return `/* plugin2valdi: RN event ${ident} dropped - not in the scanned event set */`;
    return `[[self c2vLockedListener] ${ev.name}WithPayload:@""]`;
  });

  // 2. React imports and the new-arch block drop wholesale; platform
  // conditionals the Valdi module does not model (#if !TARGET_OS_VISION)
  // unwrap (contents kept); RCT_EXPORT_MODULE may carry a js-name argument;
  // Swift-header include probes are RN pod packaging - the Swift engine is
  // a hand port on Valdi, so the probes (and their framework imports) drop
  out = out.replace(/#import\s+<React\/[^>]+>\n?/g, '');
  out = out.replace(/#\s*(?:ifdef|ifndef|if)\s+RCT_NEW_ARCH_ENABLED[\s\S]*?#\s*endif\n?/g, '');
  out = out.replace(/#\s*if\s+__has_include[\s\S]*?#\s*endif\n?/g, '');
  out = out.replace(/RCT_EXPORT_MODULE\s*\([^)]*\)\s*;?\n?/g, '');
  out = out.replace(/^#\s*if\s+(!TARGET_OS_VISION|TARGET_OS_VISION|DEBUG).*\n/gm, '');
  {
    // strip the matching #endif for each unwrapped conditional: count every
    // #if/#ifdef still present in order and remove #endif lines that have
    // no opener
    const lines = out.split('\n');
    let open = 0;
    const kept = [];
    for (const l of lines) {
      if (/^#\s*(if|ifdef|ifndef)\b/.test(l)) open++;
      else if (/^#\s*endif/.test(l)) {
        if (open === 0) continue; // closes an unwrapped conditional
        open--;
      }
      kept.push(l);
    }
    out = kept.join('\n');
  }

  // 3. RCT_EXPORT_METHOD macros -> plain -(void)sel:(CAPPluginCall *)call methods
  let unresolved = false;
  for (;;) {
    const idx = out.indexOf('RCT_EXPORT_METHOD');
    if (idx === -1) break;
    const open = out.indexOf('(', idx);
    const close = balancedEnd(out, open);
    if (close === -1) { unresolved = true; break; }
    const sigRaw = out.slice(open + 1, close);
    const parsed = parseSelector(sigRaw.replace(/\s+/g, ' '));
    const methodName = parsed.bare || (parsed.parts[0] ? parsed.parts[0].sel : null);
    if (!methodName) { unresolved = true; break; }

    // find the body: '{' after the macro close (skipping whitespace)
    const after = out.slice(close + 1);
    const braceRel = after.indexOf('{');
    if (braceRel === -1 || after.slice(0, braceRel).trim() !== '') { unresolved = true; break; }
    const bodyOpen = close + 1 + braceRel;
    let depth = 0, bodyClose = -1;
    for (let i = bodyOpen; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') { depth--; if (depth === 0) { bodyClose = i; break; } }
    }
    if (bodyClose === -1) { unresolved = true; break; }
    let body = out.slice(bodyOpen + 1, bodyClose);

    // body rewrites: promise blocks -> Capacitor call form. A balanced scan
    // (not regex) because resolver args nest: resolve((clipboard.string ?: @""))
    body = rewritePromiseCalls(body);

    let replacement;
    if (BOILERPLATE.has(methodName)) {
      replacement = `/* plugin2valdi: RN emitter boilerplate ${methodName} absorbed into the Valdi listener machinery */`;
    } else if (ATTACH_METHODS.has(methodName) && !parsed.parts.length) {
      body = `isObserving = YES;\n${body}`;
      replacement = `- (void)c2vRnAttach\n{${body}\n}`;
    } else if (DETACH_METHODS.has(methodName) && !parsed.parts.length) {
      body = `isObserving = NO;\n${body}`;
      replacement = `- (void)c2vRnDetach\n{${body}\n}`;
    } else if (DROPPED_METHODS.has(methodName)) {
      replacement = `/* plugin2valdi: RN lifecycle surface ${methodName} dropped - no RCT bridge on Valdi */`;
    } else {
      // contract method: regular typed params become option reads keyed by
      // the SPEC's field names (the RN ObjC param name can differ from the
      // codegen Spec param name - e.g. setStrings(array:) vs content)
      const modelMethod = (model.methods || []).find((mm) => mm.name === methodName);
      const optType = modelMethod && (modelMethod.params || []).find((p) => /\w+Options$/.test(p.type || ''));
      const optFields = optType ? ((model.types || []).find((t) => t.name === optType.type)?.fields || []) : [];
      const reads = [];
      let unsupported = false;
      let fieldIdx = 0;
      for (const p of parsed.parts) {
        if (/RCTPromise(Resolve|Reject)Block/.test(p.type)) continue;
        const field = optFields[fieldIdx++];
        const acc = ACCESSORS[p.type];
        if (acc && field) reads.push(`    ${acc(p.param, field.name)};`);
        else unsupported = true;
      }
      if (unsupported) {
        flags.add(`rn-objc-param:${methodName}`, 'blocking', `${methodName}() has an RN ObjC param type the pre-pass does not map - port by hand.`);
      }
      // engine/vendor dependency: receivers that are not system-prefixed and
      // not declared in this file (RNStorage, StorageRegistry, RNCAsyncStorage
      // - the storage engines live in Swift / sibling sources the module does
      // not carry). The body becomes an honest reject; the selector survives.
      const vendors = findVendorClasses(src, body);
      if (vendors.length) {
        flags.add(`rn-objc-vendor-drop:${methodName}`, 'warning', `${methodName}() depends on ${vendors.join(', ')} - classes from the plugin's engine sources (Swift storage / legacy modules) that the Valdi module does not carry. Emitted as a rejection; port the engine by hand (wire it through ios_deps) to restore the body.`);
        replacement = `- (void)${methodName}:(CAPPluginCall *)call\n{\n    [call reject:@"${methodName}: storage engine not ported - see the rn-objc-vendor-drop flag"];\n}`;
      } else {
        replacement = `- (void)${methodName}:(CAPPluginCall *)call\n{${reads.length ? '\n' + reads.join('\n') : ''}${body}\n}`;
      }
    }
    out = out.slice(0, idx) + replacement + out.slice(bodyClose + 1);
  }

  if (unresolved) {
    flags.add('rn-objc-macro-parse', 'blocking', 'An RCT_EXPORT_METHOD macro did not parse (unbalanced parens or missing body) - the RN pre-pass stopped; port the remaining methods by hand.');
  }

  // 4. non-macro RN lifecycle methods (plain ObjC methods in the impl)
  for (const name of DROPPED_METHODS) {
    out = out.replace(new RegExp(`[-+]\\s*\\([^)]*\\)\\s*${name}\\s*[\\s\\S]*?\\n\\}\\s*\\n`, 'g'), `/* plugin2valdi: RN lifecycle surface ${name} dropped */\n`);
  }

  flags.add('rn-objc-prepass', 'resolved', 'RCT_EXPORT_METHOD macros rewritten to the Capacitor call dialect (promise blocks -> [call resolve:]/[call reject:], typed params -> [call getX:] option reads), React imports and the new-arch block dropped, RN emitter boilerplate absorbed, attach/detach bodies preserved as c2vRnAttach/c2vRnDetach for the Valdi listener slot.');
  return out;
}
