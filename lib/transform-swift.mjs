// Swift transformer: rewrite the Capacitor ritual, preserve the logic.
//
// What changes (and only this):
//   class header / registration metadata  -> plain module class
//   load()                                -> onLoadModule()
//   notifyListeners("e", data: d)         -> emit<E>(make<Payload>(d))
//   call.resolve(d)                       -> call.resolve(make<Primary>(d))
//   CAPPluginCall                         -> ValdiCall (generated shim)
// Everything else - the state machine, the evaluate/emit split, the dedup
// keys, the UIKit calls - passes through byte-for-byte.
//
// Output split (reference-verified on the @capacitor/device end-to-end proof):
//   impl       - the module body + ValdiCall/listener shims (reference file,
//                NOT compiled by BUILD.bazel)
//   support    - typed bridges ONLY (make<>() -> SC* structs), compiled
//                alongside the conformance file via swift_library
//   helpers    - sibling implementation classes (e.g. Device in Device.swift),
//                CAPPlugin conformance stripped, appended to the conformance
//                file so `implementation = X()` links

import fs from 'fs';
import path from 'path';
import { pascal, camel } from './model.mjs';
import { replaceCalls, banner, netBraces, netParens } from './transform-common.mjs';

const HOST_API = ['bridge', 'viewController', 'capacitor', 'CAPConfig'];

// module imports that are NOT vendor SDKs (Foundation etc. + Capacitor).
// Everything else (StripePaymentSheet, IONGeolocationLib, ...) is a vendor
// dependency: helpers importing them cannot compile without the SDK.
const SDK_IMPORTS = new Set(['Foundation', 'UIKit', 'CoreLocation', 'CoreGraphics', 'SafariServices', 'UserNotifications', 'Capacitor', 'valdi_core', 'WebKit', 'AuthenticationServices', 'Stripe', 'StripeCore', 'StripeUICore', 'Combine', 'SwiftUI', 'MapKit', 'StoreKit', 'Contacts', 'Photos', 'AVFoundation', 'CoreMotion', 'CoreBluetooth', 'Security', 'LocalAuthentication', 'BackgroundTasks', 'WidgetKit']);

// The .d.ts textual type of a field, normalized for primitive matching.
// Unions of string literals / enum aliases coerce to string (matches the
// emitted contract, where unions collapse to string).
function baseTypeOf(ts) {
  const t = ts.replace(/\s+/g, ' ').trim().replace(/\|\s*(undefined|null)\b/g, '').trim();
  return t;
}

// Typed-bridge emitter (reference pattern: required fields are constructor args
// with `as? T ?? default` coercion; optional .d.ts fields are assigned after
// init as nullable NSNumber/String; types with no required fields use a bare
// init). Driven entirely by the parsed contract's optionality.
// ENUM PATH (probe-verified, see enum-grammar-verified in emit-dts): the
// toolchain generates `typedef NSString * _Nonnull SCMode NS_STRING_ENUM`
// (+ SCMode_Nullable) - a DISTINCT RawRepresentable type in Swift, NOT String
// - so enum-typed fields construct through SCMode(rawValue:) and read back
// via .rawValue. Unknown strings fall back to the first declared value.
function emitMakeFunctions(model, moduleName, flags = null, prefix = 'SC') {
  const enumOf = new Map(model.types.filter((t) => t.kind === 'union' && t.fromEnum && t.members)
    .map((t) => [t.name, t.members[0][1]]));
  // array element -> Swift array type: string[] -> [String], number[]/
  // boolean[] -> [NSNumber], named types -> [<prefix><Type>] (codegen emits
  // NSArray<SCFoo*> for those - preferences E2E: KeysResult.keys is string[])
  const arrayTypeOf = (base) => {
    if (!base.endsWith('[]')) return null;
    const el = base.slice(0, -2).trim();
    if (el === 'string') return '[String]';
    if (el === 'number' || el === 'boolean') return '[NSNumber]';
    if (model.types.some((t) => t.name === el)) return `[${prefix}${el}]`;
    return null;
  };
  const blocks = [];
  const seen = new Set();
  // ObjC reserved-word renames the codegen applies to property/init labels
  // (generated header: SCAppInfo uses id2 - `id` is an ObjC keyword)
  const RESERVED = { id: 'id2', description: 'description2' };
  const label = (n) => RESERVED[n] || n;
  // every distinct method result type + event payload gets a bridge - the
  // conformance pass re-wraps resolve sites per method, so all of them are
  // reachable (reference: makeDeviceId..makeLanguageTag, one per return type)
  const wanted = new Set([
    ...model.methods.map((m) => m.returns).filter((r) => r && r !== 'void'),
    ...model.events.map((e) => e.payloadType || e.payload),
  ].filter(Boolean));
  // transitive closure through field types: nested object fields
  // (RestoredListenerEvent.error -> RestoredListenerEventErrorItem) generate
  // real sub-types (SC<X>ErrorItem?) - they need make fns of their own
  const objectNames = new Set(model.types.filter((t) => t.kind === 'object').map((t) => t.name));
  for (let round = 0; round < 3; round++) {
    for (const t of model.types) {
      if (!wanted.has(t.name)) continue;
      for (const f of t.fields || []) {
        const b = (f.type || '').replace(/\[\]$/, '').replace(/\|\s*(?:undefined|null)\b/g, '').trim();
        if (objectNames.has(b)) wanted.add(b);
      }
    }
  }
  for (const t of model.types) {
    if (t.kind !== 'object' || !wanted.has(t.name)) continue;
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    const scName = `${prefix}${t.name}`;
    const required = [];
    const optional = [];
    for (const f of t.fields || []) {
      const raw = `dict["${f.name}"]`;
      const base = baseTypeOf(f.type);
      const arr = arrayTypeOf(base);
      const isEnumField = enumOf.has(base);
      // `any` fields (codegen: NSDictionary) and inline-object fields
      // (codegen FLATTENS nested objects into the parent - no property to
      // assign): skip the bridge mapping, flag for the hand port (app
      // plugin: RestoredListenerEvent.data/error)
      if (base === 'any' || /^\{.+\}$/.test(base)) {
        if (flags && !flags.has('bridge-field-skipped')) {
          flags?.add('bridge-field-skipped', 'warning', `Field(s) typed 'any' or inline-object are skipped in the Swift bridge: 'any' maps to NSDictionary and inline objects are FLATTENED by codegen (RestoredListenerEvent.data/.error) - map them by hand if their values matter.`);
        }
        continue;
      }
      // optional (`field?:`) or nullable (`T | null`) fields are assignable
      // properties on the generated struct, not init arguments
      if (f.optional || base !== f.type.replace(/\s+/g, ' ').trim()) {
        // optional fields -> nullable assignment after init (reference: memUsed/name);
        // optional enums: the property type is the generated SC<X>_Nullable
        // typedef - its OWN RawRepresentable struct in Swift (compile-probed:
        // Optional<SCStyle_Nullable>, .rawValue works) - constructed through
        // .map on the raw string
        const isObjectField = objectNames.has(base);
        optional.push(isEnumField
          ? `    info.${label(f.name)} = (dict["${f.name}"] as? String).map { ${prefix}${base}_Nullable(rawValue: $0) }`
          : isObjectField
            ? `    info.${label(f.name)} = (dict["${f.name}"] as? [String: Any]).map { make${base}($0) }`
            : `    info.${label(f.name)} = ${raw} as? ${arr ?? (base === 'number' || base === 'boolean' ? 'NSNumber' : (base === 'any' || base === 'unknown' || base === 'object' ? '[String : Any]' : 'String'))}`);
      } else if (isEnumField) {
        // required enum: SCMode(rawValue:) is NON-failable (compile-probed -
        // force-unwrapping its result is an error); missing strings coerce
        // to the first declared value
        required.push(`${label(f.name)}: ${prefix}${base}(rawValue: ${raw} as? String ?? "${enumOf.get(base)}")`);
      } else if (objectNames.has(base) && !base.endsWith('[]')) {
        // REQUIRED nested object (messaging: Notification inside
        // NotificationReceivedEvent) - construct through its make fn
        required.push(`${label(f.name)}: (dict["${f.name}"] as? [String: Any]).map { make${base}($0) } ?? make${base}([:])`);
      } else if (arr) {
        required.push(`${label(f.name)}: ${raw} as? ${arr} ?? []`);
      } else if (base === 'boolean') {
        required.push(`${label(f.name)}: ${raw} as? Bool ?? false`);
      } else if (base === 'number') {
        required.push(`${label(f.name)}: ${raw} as? Double ?? 0`);
      } else {
        required.push(`${label(f.name)}: ${raw} as? String ?? ""`);
      }
    }
    const lines = [`public func make${t.name}(_ dict: [String: Any]) -> ${scName} {`];
    if (!optional.length) {
      // all-required (or empty): single return through the constructor
      lines.push(`    return ${scName}(${required.join(', ')})`);
    } else {
      // reference form: constructor takes the required fields (one per line when
      // several), optional fields assigned after init
      const initCall = required.length
        ? `${scName}(\n${required.map((r) => `        ${r}`).join(',\n')}\n    )`
        : `${scName}()`;
      lines.push(`    let info = ${initCall}`);
      lines.push(...optional);
      lines.push('    return info');
    }
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  // enum-typed results / event payloads: same heuristic as the primitive
  // bridges (single-key dict unwrap - Capacitor's {"value": v} idiom). The
  // maker returns NSString - the generated protocol method types the promise
  // as SCValdiPromise<NSString> (the typedef is transparent inside ObjC
  // generics, compile-probed); listener payloads re-wrap into the SC<Enum>
  // struct via SC<Enum>(rawValue:) at the emit site.
  for (const [name, first] of enumOf) {
    if (!wanted.has(name)) continue;
    blocks.push([
      `// plugin2valdi: enum-typed result/payload bridge - the generated typedef`,
      `// ${prefix}${name} is NSString in ObjC but a DISTINCT struct in Swift,`,
      `// so the promise side carries NSString and emit sites re-wrap through`,
      `// init(rawValue:). Unknown strings fall back to "${first}".`,
      `public func make${name}(_ dict: [String: Any]) -> NSString {`,
      `    let s = dict.count == 1 ? (dict.values.first as? String ?? "${first}") : (dict["value"] as? String ?? "${first}")`,
      `    return s as NSString`,
      `}`,
    ].join('\n'));
  }
  return blocks;
}

function emitEventStubs(model, moduleName, prefix = 'SC') {
  // listener protocol name = the .d.ts @ExportProxy ios annotation value
  // (verified: the codegen names @protocol SCValdiWebViewListener from the
  // annotation, not from the TS interface name)
  const listenerName = prefix + pascal(moduleName) + 'Listener';
  // storage var name matches the conformance's (conform-swift) exactly
  const storageName = camel(pascal(moduleName)) + 'ListenerStorage';
  // payload typing mirrors emit-dts exactly: synthesized/named structs carry
  // the SC* prefix (make<Payload>() returns the prefixed struct), enums map
  // to their SC* NS_STRING_ENUM typedef (probe-verified listener payload
  // position), primitives map to Swift scalars, unknown types collapsed to
  // string upstream
  const isStruct = (p) => model.types.some((t) => t.kind === 'object' && t.name === p);
  const isEnum = (p) => model.types.some((t) => t.kind === 'union' && t.fromEnum && t.members && t.name === p);
  const payloadType = (p) => {
    if (p === 'string') return 'String';
    if (p === 'number') return 'Double';
    if (p === 'boolean') return 'Bool';
    return (isStruct(p) || isEnum(p)) ? `${prefix}${pascal(p)}` : 'String';
  };
  const lines = [];
  lines.push(`// Verified pattern (valdi_webview generated bindings, built through the`);
  lines.push(`// real toolchain): events flow through a stored listener set via`);
  lines.push(`// setListener. The REAL ${listenerName} protocol is generated from the .d.ts`);
  lines.push(`// @ExportProxy - selector evtNameWithPayload: / setListenerWithListener:.`);
  lines.push(`// This re-declaration exists only so this REFERENCE file compiles`);
  lines.push(`// standalone; the compiled path (conformance) uses the generated one.`);
  lines.push(`public protocol ${listenerName}: AnyObject {`);
  for (const ev of model.events) {
    lines.push(`    func ${camel(ev.name)}(${/Error$/.test(ev.name) ? 'with' : 'withPayload'} payload: ${payloadType(ev.payloadType || ev.payload)})`);
  }
  lines.push('}');
  lines.push('');
  lines.push(`private var ${storageName}: ${listenerName}?`);
  lines.push('');
  lines.push(`public func setListenerWith(_ listener: ${listenerName}?) {`);
  lines.push(`    ${storageName} = listener`);
  lines.push('}');
  lines.push('');
  lines.push(`// fallback extraction for primitive payloads whose notifyListeners data`);
  lines.push(`// was not a single-key dictionary literal - flagged for hand review`);
  lines.push(`public func c2vPrimitivePayload(_ data: [String: Any]) -> Any? {`);
  lines.push(`    data.values.first`);
  lines.push('}');
  lines.push('');
  for (const ev of model.events) {
    lines.push(`public func emit${pascal(ev.name)}(_ data: ${payloadType(ev.payloadType || ev.payload)}) {`);
    lines.push(`    ${storageName}?.${camel(ev.name)}(${/Error/.test(ev.payloadType || ev.payload || '') && /Error$/.test(ev.name) ? 'with' : 'withPayload'}: data)`);
    lines.push('}');
    lines.push('');
  }
  lines.push(`public func emitUnresolvedEvent(_ name: String, data: [String: Any]) {`);
  lines.push(`    // plugin2valdi: event name was a non-constant expression - resolve by hand.`);
  lines.push(`    print("plugin2valdi: unresolved event \\(name) (unwired)")`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// Collect sibling implementation classes the plugin body references (e.g.
// `private let implementation = Device()` -> Device.swift next to the plugin
// source, or nested helper trees like stripe's PaymentFlow/). Reference pattern:
// each helper is appended to the conformance file verbatim - minus Capacitor
// conformance/imports - so the Swift implementation links. Collection closes
// transitively: a helper's references to other declared sibling types pull
// those files in too, or the appended set wouldn't compile.
const HELPER_DECL_RE = /(?:^|\n)((?:@\w+(?:\(\w+\))?\s+)*(?:(?:public|internal|open)\s+)?(?:final\s+)?(?:class|struct|enum)\s+(\w+)(?:\s*:\s*[^{\n]+?)?\s*\{)/;

function collectHelpers(swiftPath, pluginSrc, flags) {
  const root = path.dirname(swiftPath);
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (/test/i.test(e.name) || e.name === 'build' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.swift') && e.name !== 'Package.swift') files.push(p);
    }
  };
  walk(root);

  const declared = new Map(); // type name -> file src (ALL decls per file:
  // browser's Browser.swift leads with the BrowserEvent enum - the class
  // after it is the helper the plugin instantiates)
  const DECLS_RE = /(?:^|\n)((?:@\w+(?:\([^)\n]*\))?\s+)*(?:(?:public|internal|open)\s+)?(?:final\s+)?(?:class|struct|enum|protocol)\s+(\w+))/g;
  for (const p of files) {
    if (path.resolve(p) === path.resolve(swiftPath)) continue;
    let src;
    try { src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
    for (const m of src.matchAll(DECLS_RE)) {
      if (!declared.has(m[2])) declared.set(m[2], { name: m[2], src, file: p });
    }
  }

  // seeds: types the plugin body mentions; then close over helper texts.
  // Dedupe by FILE: multiple declared names can live in one file (browser's
  // Browser.swift declares BrowserEvent + Browser) - appending per name
  // would duplicate the declarations (invalid redeclaration)
  const helpers = [];
  const seen = new Set();
  const seenFiles = new Set();
  const pull = (text) => {
    for (const [name, info] of declared) {
      if (seen.has(name)) continue;
      if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
      seen.add(name);
      if (!seenFiles.has(info.file)) {
        seenFiles.add(info.file);
        helpers.push(info);
      }
      pull(info.src);
    }
  };
  pull(pluginSrc);
  helpers.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file));

  // the plugin body's `implementation = X()` must resolve to a collected
  // helper, or the conformance file won't link - but Foundation/Capacitor
  // system types (UUID, Data, JSObject, ...) live in the SDK, not siblings
  const SYSTEM_TYPES = new Set(['UUID', 'Data', 'Date', 'DateComponents', 'DateFormatter', 'NumberFormatter', 'ISO8601DateFormatter', 'Calendar', 'Locale', 'TimeZone', 'URL', 'URLRequest', 'URLComponents', 'URLQueryItem', 'NSNumber', 'NSNull', 'NSError', 'NSString', 'NSArray', 'NSDictionary', 'NSSet', 'NSMutableArray', 'NSMutableDictionary', 'NSMutableString', 'NSNotificationCenter', 'NotificationCenter', 'ProcessInfo', 'Bundle', 'Timer', 'JSONDecoder', 'JSONEncoder', 'JSObject', 'JSArray', 'CAPConfig', 'CGRect', 'CGPoint', 'CGSize', 'UIEdgeInsets']);
  const inst = pluginSrc.match(/(?:private\s+)?(?:let|var)\s+\w+\s*(?::\s*[^=\n]+)?=\s*([A-Z]\w*)\(\)/);
  if (inst && !seen.has(inst[1]) && !SYSTEM_TYPES.has(inst[1])) {
    flags.add('swift-helper-missing', 'blocking', `The plugin body instantiates ${inst[1]}() but no sibling Swift file declaring ${inst[1]} was found under the plugin source directory - the conformance file's implementation reference will not link. Append the helper class by hand.`);
  }
  // no-host policy, helper side: a helper whose body still references the
  // Capacitor bridge surface after processing (CAP* types, getConfig, the
  // .capacitor. extension namespace, its own bridge property) cannot compile
  // without the Capacitor framework - skip it and let the policy machinery
  // drop its decls/uses (status-bar: StatusBar holds CAPBridgeProtocol)
  const CAP_SURFACE = /\b(CAPBridge\w*|CAPConfig|CAPPluginCall|JSObject|JSValue|CAPLog|ApplicationDelegateProxy)\b|\.capacitor\w*|\bgetConfig\(|\bbridge\s*[:.]|\bbridge\b\s*\)/;
  // vendor-coupled helper (stripe: PaymentSheetHelper references
  // PaymentSheet.BillingDetailsCollectionConfiguration): its FILE imports a
  // vendor SDK - cannot compile without it, same skip as Capacitor-coupled
  const vendorImportsOf = (src) => {
    const mods = [];
    for (const m of src.matchAll(/^import (\w+)$/gm)) {
      if (!SDK_IMPORTS.has(m[1])) mods.push(m[1]);
    }
    return mods;
  };
  const portable = [];
  const unportableTypes = [];
  // global-func utility files: top-level funcs with no type decl
  const globalFuncFiles = [];
  for (const p of files) {
    if (path.resolve(p) === path.resolve(swiftPath)) continue;
    let src2;
    try { src2 = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
    if (HELPER_DECL_RE.test(src2)) continue; // type-bearing - handled above
    // column-0 statements (func bodies are indented and ignored): imports,
    // comments and blank lines excluded - everything left must be a func
    // declaration or a closing brace
    const topLevel = src2.split('\n').filter((l) => l && !/^\s/.test(l) && !/^import\s/.test(l) && !/^\/\//.test(l) && !/^\/\*/.test(l) && !/^\*/.test(l));
    if (topLevel.length && topLevel.every((l) => /^(public |internal |private |fileprivate )?func |^}/.test(l))) {
      let gf = src2.replace(/^import Capacitor\s*$/m, '');
      if (/\bCAPLog\b/.test(gf)) {
        gf = gf.replace(/CAPLog\.print/g, 'print');
        flags.add('global-func-sanitized', 'warning', 'Global-func utility file(s) sanitized: CAPLog.print -> print (the Capacitor logger is unavailable without the framework).');
      }
      globalFuncFiles.push(gf);
    }
  }
  for (const h of helpers) {
    const text = processHelperSource(h.src, h.name);
    const vMods = vendorImportsOf(h.src);
    if (vMods.length) {
      unportableTypes.push(h.name);
      flags.add(`swift-unportable-helper-vendor:${h.name}`, 'warning', `Helper ${h.name} references vendor SDK types (${vMods.join(', ')}) - NOT copied into the conformance. Contract methods depending on it drop-with-rejection; wire the SDK into ios_deps and port ${h.name} by hand if its behavior matters.`);
      continue;
    }
    if (CAP_SURFACE.test(text)) {
      unportableTypes.push(h.name);
      flags.add(`swift-unportable-helper:${h.name}`, 'warning', `Helper ${h.name} references the Capacitor bridge surface (CAP* types / getConfig / .capacitor. extensions) - NOT copied into the conformance. Declaring-instance properties drop, and contract methods depending on them drop-with-rejection; port ${h.name} against Valdi APIs by hand if its behavior matters.`);
      continue;
    }
    portable.push({ name: h.name, text, file: h.file });
  }
  return { helpers: portable, unportableTypes, globalFuncFiles };
}

// Strip Capacitor conformance from a helper class while keeping every method
// verbatim (reference: `@objc public class Device: NSObject {` appended as-is).
function processHelperSource(src, name) {
  const out = [];
  let dropping = null;
  for (const line of src.split('\n')) {
    if (dropping === 'pluginMethods') {
      if (/^\s*\]\s*$/.test(line)) dropping = null;
      continue;
    }
    if (/^\s*public let pluginMethods/.test(line)) {
      if (line.includes('=') && /\]\s*$/.test(line)) continue;
      dropping = 'pluginMethods';
      continue;
    }
    if (/^\s*public let (identifier|jsName)/.test(line)) continue;
    if (/^@objc\(/.test(line)) continue;
    if (/^import Capacitor\s*$/.test(line)) continue;
    // class header: drop CAPPlugin/CAPBridgedPlugin conformance for the
    // @objc + NSObject shape the conformance file links against (struct/enum
    // helpers and NSObject classes pass through verbatim)
    let l = line.replace(
      new RegExp(`^public (final )?class ${name}\\s*:\\s*(?:CAPBridgedPlugin\\s*,\\s*CAPPlugin|CAPPlugin(?:\\s*,\\s*CAPBridgedPlugin)?)\\s*\\{`),
      `@objc public class ${name}: NSObject {`,
    );
    out.push(l);
  }
  return out.join('\n').replace(/\n*$/, '\n');
}

function primaryResult(model) {
  const counts = {};
  for (const m of model.methods) if (m.returns && m.returns !== 'void') counts[m.returns] = (counts[m.returns] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function transformSwift(swiftPath, model, moduleClass, flags, iosPrefix = 'SC', moduleName = null) {
  const src = fs.readFileSync(swiftPath, 'utf8').replace(/\r\n/g, '\n');
  let lines = src.split('\n'); // let: the glue-extension pre-pass reassigns
  const primary = primaryResult(model);
  const distinctResults = new Set(model.methods.filter((m) => m.returns && m.returns !== 'void').map((m) => m.returns));
  if (primary && distinctResults.size > 1) {
    flags.add('resolve-wrap-assumption', 'resolved', `The intermediate impl wraps all call.resolve(...) with make${primary}(...), but the conformance pass re-wraps every site per-method (make<Result of the enclosing @objc func>) - verified E2E on @capacitor/device (5 result types) and @capacitor/preferences (3): every method fulfilled its own result type on the iOS simulator. The Java transform re-wraps per-method too (method-span tracking, same pattern).`);
  }

  const out = [];
  let dropping = null; // 'pluginMethods' | 'classDeclMeta'
  let origClassName = null; // captured from the class header, for extension renames
  let sawClassHeader = false;
  const deadGlueFuncs = new Set(); // funcs that died with dropped glue extensions
  // PRE-PASS: Combine/vendor-glue extensions on the plugin class
  // (geolocation: bindAuthorisationStatusPublisher - sink/publisher/
  // AnyCancellable/vendor chains) drop whole; they exist to pipe vendor
  // SDK events and cannot compile without them
  {
    let extName = null;
    let extDepth = 0;
    let glue = false;
    const keptLines = [];
    for (const line of lines) {
      const extM = line.match(/^\s*(?:private |public |internal )?extension (\w+)\s*\{/);
      if (extM && !extName) {
        extName = extM[1];
        extDepth = netBraces(line);
        glue = /\.sink|receiveValue|\.publisher|AnyCancellable/.test(line);
        if (extDepth > 0) continue; // consumed the whole opener
      } else if (extName) {
        glue = glue || /\.sink|receiveValue|\.publisher|AnyCancellable|IONGLOC\w*/.test(line);
        for (const fm of line.matchAll(/func (\w+)\(/g)) deadGlueFuncs.add(fm[1]);
        extDepth += netBraces(line);
        if (extDepth > 0) continue;
        // block complete
        if (glue) {
          flags.add('swift-combine-glue-extension', 'warning', `A Combine/vendor-glue extension (${extName}) dropped - it pipes vendor SDK events and cannot compile without them. Restore with the vendor wiring if the behavior matters.`);
        }
        extName = null;
        continue;
      }
      keptLines.push(line);
    }
    if (!extName) lines = keptLines;
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // 1. drop registration metadata block
    if (dropping === 'pluginMethods') {
      if (/^\s*\]\s*$/.test(line)) dropping = null;
      continue;
    }
    if (/^\s*public let pluginMethods/.test(line)) {
      // single-line assignment ("= []" or "= [ ... ]") - the type annotation
      // also contains "[CAPPluginMethod]", so detect completion via the '='
      // assignment, not the bracket contents
      if (line.includes('=') && /\]\s*$/.test(line)) continue;
      dropping = 'pluginMethods';
      continue;
    }
    if (/^\s*public let (identifier|jsName)/.test(line)) continue;
    if (/^@objc\(/.test(line)) continue;
    if (/^\s*import Capacitor\s*$/.test(line)) continue;

    // in-file SECONDARY Capacitor classes (barcode scanner declares a
    // delegate class INSIDE the plugin file, `: CAPPlugin`) drop whole -
    // same treatment as sibling-file unportable helpers
    if (/^\s*(?:@objc\s*)?(?:public |internal |open )?(?:final )?class \w+\s*:\s*(?:NSObject\s*,\s*)?CAP(?:Plugin|BridgedPlugin)/.test(line) && sawClassHeader) {
      let d = netBraces(line);
      let p = netParens(line);
      while ((d > 0 || p > 0) && li + 1 < lines.length) {
        li++;
        d += netBraces(lines[li]);
        p += netParens(lines[li]);
      }
      flags.add('swift-inline-capacitor-class-dropped', 'warning', 'An in-file secondary Capacitor class (a delegate/worker extending CAPPlugin) dropped whole - it cannot compile without the framework. Port it with the rest of the hand work if its behavior matters.');
      continue;
    }
    // 2. class header rewrite
    let l = line.replace(
      // extra conformances after CAPBridgedPlugin (barcode scanner adds
      // its own delegate protocol) are consumed with the Capacitor ones -
      // conformSwift re-adds NSObject + the module protocol
      /public class (\w+): CAPPlugin, CAPBridgedPlugin[^{]*\{/,
      (m, orig) => { origClassName = orig; sawClassHeader = true; return `public class ${moduleClass} {`; },
    );
    // extensions on the ORIGINAL class name follow the rename (glue
    // extension blocks were removed in the pre-pass above)
    if (origClassName && l.includes(`extension ${origClassName}`)) {
      l = l.replace(`extension ${origClassName}`, `extension ${moduleClass}`);
    }
    // 3. lifecycle rename (both modifier orders; `override` must go - the
    // conformance class has no Capacitor superclass)
    l = l.replace(/public override func load\(\)/, 'func onLoadModule()');
    l = l.replace(/override public func load\(\)/, 'func onLoadModule()');
    l = l.replace(/override (\w+ )?func (handleOn\w+|load)\(\)/, (m, vis) => `${vis || ''}func $2()`);
    // 4. type renames (ritual calls are rewritten whole-text below)
    l = l.replace(/CAPPluginCall/g, 'ValdiCall');
    // Capacitor's JSON aliases rewrite to plain dictionary/array types - a
    // helper RETURNING JSObject is perfectly portable (only separate helper
    // files importing Capacitor for these types are skipped)
    l = l.replace(/\bJSObject\b/g, '[String: Any]').replace(/\bJSArray\b/g, '[Any]');
    out.push(l);
  }

  // 4. ritual calls - whole-text pass so multiline dictionary literals
  // inside call.resolve([...]) are wrapped correctly
  let body = out.join('\n');

  // resolve constant event names: `let tokenReceivedEvent = "tokenReceived"`
  const constMap = new Map();
  for (const m of body.matchAll(/(?:static\s+)?(?:let|var)\s+(\w+)\s*(?::\s*String)?\s*=\s*"([^"]+)"/g)) {
    constMap.set(m[1], m[2]);
  }
  let unresolvedEvents = 0;
  // payload typing must mirror emit-dts (synthesized/named struct | enum |
  // primitive | collapsed-to-string) so emitX/makeX names line up with the
  // contract - enum payloads get a make<Enum> bridge in the support file
  const eventPayload = (ev) => ev.payloadType
    || (/^(string|number|boolean)$/.test(ev.payload)
      ? ev.payload
      : (model.types.some((t) => (t.kind === 'object' || (t.kind === 'union' && t.fromEnum && t.members)) && t.name === ev.payload) ? ev.payload : 'string'));
  body = replaceCalls(body, 'notifyListeners', (inner) => {
    const lit = inner.match(/^"(\w+)"\s*,\s*data:\s*([\s\S]+?)(?:\s*,\s*retainUntilConsumed[^),]*)?$/);
    const varM = inner.match(/^(\w+)\s*,\s*data:\s*([\s\S]+?)(?:\s*,\s*retainUntilConsumed[^),]*)?$/);
    const name = lit ? lit[1] : (varM && constMap.has(varM[1]) ? constMap.get(varM[1]) : null);
    const dataExpr = lit ? lit[2] : varM ? varM[2] : null;
    if (/retainUntilConsumed/.test(inner)) {
      flags.add('retain-until-consumed', 'blocking', 'notifyListeners(..., retainUntilConsumed: true) found - Capacitor queues the event until a JS listener attaches. The Valdi setListener model has no built-in retention; design queued delivery for events that can fire before setListener (push/notifications).');
    }
    if (name && dataExpr != null) {
      const ev = model.events.find((e) => e.name === name);
      const payload = ev ? eventPayload(ev) : 'UNKNOWN';
      if (ev && /^(string|number|boolean)$/.test(payload)) {
        // primitive-payload event: Capacitor still passes a JSObject dict -
        // a single-key dictionary literal unwraps to the scalar expression
        const dict = dataExpr.trim().match(/^\[\s*"(\w+)"\s*:\s*([\s\S]+?)\s*\]$/);
        if (dict && !/[,[]/.test(dict[2]) && !dict[2].includes('{')) {
          return `emit${pascal(name)}(${dict[2]})`;
        }
        flags.add(`primitive-payload-extract:${name}`, 'warning', `notifyListeners("${name}", ...) has a primitive ${payload} payload but its data expression is not a single-key dictionary literal - emitted as c2vPrimitivePayload(...) force-cast (takes the first dictionary value). Verify the field choice by hand.`);
        const cast = payload === 'string' ? 'as! String' : payload === 'number' ? 'as! Double' : 'as! Bool';
        return `emit${pascal(name)}(c2vPrimitivePayload(${dataExpr}) ${cast})`;
      }
      // enum payloads: the listener method takes the SC<Enum> STRUCT (value
      // position, compile-probed) - re-wrap the NSString maker through
      // init(rawValue:) (non-failable)
      const isEnumPayload = model.types.some((t) => t.kind === 'union' && t.fromEnum && t.members && t.name === payload);
      if (isEnumPayload) {
        return `emit${pascal(name)}(${iosPrefix}${pascal(payload)}(rawValue: make${payload}(${dataExpr}) as String))`;
      }
      return `emit${pascal(name)}(make${payload}(${dataExpr}))`;
    }
    if (varM) {
      unresolvedEvents++;
      return `emitUnresolvedEvent(${varM[1]}, data: ${varM[2]})`;
    }
    return null;
  });
  if (unresolvedEvents) {
    flags.add('dynamic-event-names', 'warning', `${unresolvedEvents} notifyListeners call(s) with non-constant event names rewritten to emitUnresolvedEvent(...) - resolve the constants or port by hand.`);
  }
  body = replaceCalls(body, 'call.resolve', (inner) => {
    if (!inner.trim()) return 'call.resolve()';
    if (!primary) return null;
    return `call.resolve(make${primary}(${inner}))`;
  });

  // vendor SDK imports (Stripe's `import StripePaymentSheet`, geolocation's
  // `import IONGeolocationLib`) - the conformance compiles only when the
  // vendor target is provided through ios_deps; not host-API, a real SDK
  // dependency the plugin cannot live without
  // SDK_IMPORTS is the module-level set (shadowing it here dropped Combine
  // - found via geolocation)
  for (const m of src.matchAll(/^import (\w+)$/gm)) {
    if (!SDK_IMPORTS.has(m[1])) {
      flags.add(`swift-vendor-import:${m[1]}`, 'blocking', `The plugin body imports vendor module ${m[1]} - the conformance compiles only when that SDK is provided. Add the vendor target to ios_deps in BUILD.bazel (or vendor the framework) and wire its dependency management by hand.`);
    }
  }

  // host-API scan
  for (const api of HOST_API) {
    const hits = (src.match(new RegExp(`\\b${api}\\b`, 'g')) || []).length;
    if (hits > 0) flags.add(`swift-host-api:${api}`, 'warning', `${hits} reference(s) to Capacitor host API "${api}" in the Swift body - verify equivalents in the Valdi module lifecycle.`);
  }
  if (/CAPPluginCall\[\]|\[CAPPluginCall\]/.test(src)) {
    flags.add('swift-call-in-state', 'warning', 'CAPPluginCall stored in module state (pendingStateCalls). ValdiCall shim preserves the shape; confirm Valdi async result semantics can be stored/deferred the same way.');
  }
  flags.add('swift-factory', 'resolved', 'Obj-C factory with VALDI_REGISTER_MODULE() emitted (reference-verified end-to-end on @capacitor/device: forward-declared @objc class resolved via NSClassFromString, wired through ios_deps in BUILD.bazel).');

  // sibling helper classes (reference: Device.swift appended to the conformance)
  const { helpers, unportableTypes, globalFuncFiles = [] } = collectHelpers(swiftPath, src, flags);
  // merge global-func utilities as pseudo-helpers (appended verbatim)
  for (const gf of globalFuncFiles) helpers.push({ name: '(global funcs)', text: gf.endsWith('\n') ? gf : gf + '\n', file: '(util)' });

  // ---- no-host policy: body surgery (Swift port of the objc/java policy) ----
  // Outside contract methods (their handling is conformSwift's drop-with-
  // rejection): drop instance declarations of unportable helper types and
  // host-surface statements (self.bridge / getConfig / CAPConfig /
  // viewController / .capacitor. extensions / unportable instances), with
  // brace-continuation so guard-else and if-let blocks drop whole.
  const hostPolicy = { unportableTypes, instances: [], deadFuncs: deadGlueFuncs };
  const declRe = unportableTypes.length
    ? new RegExp(`^\\s*(?:private |internal |public )?(?:weak )?(?:var|let)\\s+(\\w+)\\s*:\\s*\\??(?:${unportableTypes.join('|')})\\b(?:\\s*\\?)?\\s*$|^\\s*(?:private |internal |public )?(?:weak )?(?:var|let)\\s+(\\w+)\\s*=\\s*(?:${unportableTypes.join('|')})\\(`)
    : null;
  const tokenRe = () => new RegExp('\\bbridge\\b|\\bgetConfig\\(|\\bCAPConfig\\b|\\bviewController\\.|\\.capacitor\\w*|\\bJSObject\\b|\\bJSArray\\b|\\bMessaging\\b|\\bFirebaseMessaging\\b|\\bCrashlytics\\b|\\bFirebaseCrashlytics\\b');
  const instanceRe = () => hostPolicy.instances.length ? new RegExp(`\\b(?:${hostPolicy.instances.join('|')})\\b`) : null;
  const typeRe = unportableTypes.length ? new RegExp(`\\b(?:${unportableTypes.join('|')})\\b`) : null;
  const bl = body.split('\n');
  const kept = [];
  const droppedStmts = [];
  const tainted = new Set(); // locals declared in dropped statements
  const knownTypeNames = new Set([...model.types.map((t) => t.name), ...unportableTypes, 'ValdiCall', 'CAPPluginCall', 'PluginCall', 'String', 'Int', 'Bool', 'Double', 'Float', 'Any', 'AnyObject', 'Void', 'Array', 'Dictionary', 'Set', 'UUID', 'Data', 'Date', 'DateComponents', 'DateFormatter', 'NumberFormatter', 'ISO8601DateFormatter', 'Calendar', 'Locale', 'TimeZone', 'URL', 'URLRequest', 'URLComponents', 'URLQueryItem', 'NSNumber', 'NSNull', 'NSError', 'NSString', 'NSArray', 'NSDictionary', 'NSSet', 'NSMutableArray', 'NSMutableDictionary', 'NSMutableString', 'NotificationCenter', 'ProcessInfo', 'Bundle', 'Timer', 'JSONDecoder', 'JSONEncoder', 'JSObject', 'JSArray', 'CAPConfig', 'CGRect', 'CGPoint', 'CGSize', 'UIEdgeInsets', 'AnyCancellable', 'UIViewController', 'UIView', 'UIWindow', 'UIColor', 'UIFont', 'UIImage', 'UILabel', 'UIButton', 'UserDefaults', 'SCValdiPromise', 'SCValdiResolvablePromise', 'SCValdiUndefinedValue']);
  let contractDepth = 0; // inside a contract method: conformSwift handles it
  for (let i = 0; i < bl.length; i++) {
    const l = bl[i];
    if (contractDepth > 0) {
      contractDepth += netBraces(l);
      kept.push(l);
      continue;
    }
    // Capacitor permission machinery never runs on Valdi (no bridge to
    // grant through) - checkPermissions/requestPermissions drop like the
    // java @PermissionCallback treatment
    if (/(?:public |override |@objc\s*)*func (checkPermissions|requestPermissions)\s*\(/.test(l)) {
      let d = netBraces(l);
      if (d <= 0 && !/\{/.test(l)) {
        // sig on its own line - consume until the opening brace, then span
        while (i + 1 < bl.length && !/\{/.test(bl[i + 1])) i++;
        if (i + 1 < bl.length) { i++; d = netBraces(bl[i]); }
      }
      while (d > 0 && i + 1 < bl.length) { i++; d += netBraces(bl[i]); }
      droppedStmts.push(l.trim());
      continue;
    }
    if (/func \w+\(_ call: ValdiCall\) \{/.test(l)) {
      contractDepth = netBraces(l); // netBraces counts the sig's own `{` - no `1 +` (double-counts and swallows the next method)
      kept.push(l);
      continue;
    }
    if (/^\s*\/\//.test(l)) { kept.push(l); continue; }
    // property decls typed with UNKNOWN types (geolocation: IONGLOCService -
    // a type from the dropped vendor module) drop + flag; Apple framework
    // types stay (Combine's AnyCancellable etc.)
    {
      const pdAny = l.match(/^\s*(?:private |public |internal |fileprivate )?(?:weak )?(?:var|let)\s+\w+\s*:\s*\(?\s*(?:any\s+)?\??([A-Z]\w*)/);
      const pd = pdAny && !unportableTypes.includes(pdAny[1]) ? pdAny : (pdAny && unportableTypes.includes(pdAny[1])
        ? (() => { flags.add(`swift-unportable-type-field:${pdAny[1]}`, 'warning', `Property typed with dropped-helper type ${pdAny[1]} dropped (the helper was unportable). Restore with the port if needed.`); const fn2 = (l.match(/(?:var|let)\s+(\w+)/) || [])[1]; if (fn2) tainted.add(fn2); droppedStmts.push(l.trim()); return null; })()
        : pdAny);
      if (pd && !knownTypeNames.has(pd[1])) {
        const fname = (l.match(/(?:var|let)\s+(\w+)/) || [])[1];
        if (fname) tainted.add(fname);
        flags.add(`swift-vendor-type-field:${pd[1]}`, 'warning', `Property typed ${pd[1]} (a vendor-module type with no live import) dropped - wire the SDK and restore the field with the port if it matters.`);
        droppedStmts.push(l.trim());
        let d = netBraces(l);
        let p = netParens(l);
        while ((d > 0 || p > 0) && i + 1 < bl.length) { i++; d += netBraces(bl[i]); p += netParens(bl[i]); }
        continue;
      }
    }
    const decl = declRe && l.match(declRe);
    const instHit = instanceRe() && instanceRe().test(l);
    const typeHit = typeRe && typeRe.test(l);
    const hostHit = tokenRe('').test(l);
    const taintHit = tainted.size && [...tainted].some((n) => new RegExp(`\\b${n}\\b`).test(l));
    if (decl || instHit || typeHit || hostHit || taintHit) {
      // locals declared in a dropped statement die with it - later uses too
      for (const dm of l.matchAll(/(?:guard let|let|var)\s+(\w+)/g)) tainted.add(dm[1]);
      if (decl) { hostPolicy.instances.push(decl[1] || decl[2]); tainted.add(decl[1] || decl[2]); }
      // multi-line guard/if conditions (native-settings: `guard let url =
      // implementation.resolveSettingsURL(...),
      //       UIApplication...else {`) - the dropped line opens no brace, so
      // consume the remaining condition lines through the else/open line,
      // then that block's brace continuation
      if (/^(\s*)(guard|if)\b/.test(l) && !/\{/.test(l)) {
        while (i + 1 < bl.length && !/\{/.test(bl[i + 1])) i++;
        if (i + 1 < bl.length && /\{/.test(bl[i + 1])) {
          i++;
          let d2 = netBraces(bl[i]);
          while (d2 > 0 && i + 1 < bl.length) {
            i++;
            d2 += netBraces(bl[i]);
          }
        }
        droppedStmts.push(l.trim());
        continue;
      }
      // single-line statements: consume brace continuation so dropped
      // statements stay balanced; ALSO consume unclosed call chains (a
      // dropped `x.publisher` prefix leaves an orphaned `.sink(...) { }`
      // tail - parens must balance too)
      let depth = netBraces(l);
      let pdepth = netParens(l);
      if (depth > 0 || pdepth > 0) {
        while ((depth > 0 || pdepth > 0) && i + 1 < bl.length) {
          i++;
          depth += netBraces(bl[i]);
          pdepth += netParens(bl[i]);
        }
      }
      // method-chain continuation: the dropped statement's receiver line may
      // be paren-free (`locationService.publisher`) with the whole call on
      // following dot-leader lines (`.sink(...)`) - consume those too
      while (i + 1 < bl.length && /^\s*\./.test(bl[i + 1])) {
        i++;
        let d2 = netBraces(bl[i]);
        let p2 = netParens(bl[i]);
        while ((d2 > 0 || p2 > 0) && i + 1 < bl.length) {
          i++;
          d2 += netBraces(bl[i]);
          p2 += netParens(bl[i]);
        }
      }
      droppedStmts.push(l.trim());
      continue;
    }
    kept.push(l);
  }
  // funcs whose SIGNATURES reference unknown types (vendor glue:
  // requestLocationAuthorisation(type: IONGLOCAuthorisationRequestType))
  // drop whole - they cannot compile without the SDK
  {
    const kept2 = [];
    for (let i = 0; i < kept.length; i++) {
      const l = kept[i];
      const fm = l.match(/^\s*(?:private |public |internal |fileprivate )?(?:override )?(?:@\w+\s+)?func \w+\(([^)]*)\)(?:\s*->\s*\??([\w.[]<>? ]+))?/);
      if (fm) {
        const sigTypes = [...(fm[1] + ' ' + (fm[2] || '')).matchAll(/\b([A-Z]\w*)\b/g)].map((m) => m[1]);
        const unknown = sigTypes.filter((t) => !knownTypeNames.has(t) && !model.types.some((x) => x.name === t));
        if (unknown.length) {
          flags.add(`swift-vendor-signature:${unknown[0]}`, 'warning', `Func ${l.trim().slice(0, 50)}… signature references vendor type(s) (${unknown.join(', ')}) - dropped whole (cannot compile without the SDK). Port it with the vendor wiring if the behavior matters.`);
          let d = netBraces(l);
          let p = netParens(l);
          while ((d > 0 || p > 0) && i + 1 < kept.length) { i++; d += netBraces(kept[i]); p += netParens(kept[i]); }
          continue;
        }
      }
      kept2.push(l);
    }
    kept.length = 0;
    kept.push(...kept2);
  }
  // unused stored-property pruning: fields whose names appear nowhere else
  // after the drops (AnyCancellable fields whose consumers dropped)
  {
    const props = [];
    for (let i = 0; i < kept.length; i++) {
      const pm = kept[i].match(/^\s*(?:private |public |internal |fileprivate )?(?:weak )?(?:var|let)\s+(\w+)/);
      // literal initializers (event-name constants) survive - only complex
      // typed/call-initialized fields whose consumers dropped get pruned
      if (pm && netBraces(kept[i]) >= 0 && !/=\s*["'\d]/.test(kept[i])) props.push({ name: pm[1], idx: i, forced: /AnyCancellable|IONGLOC/.test(kept[i]) });
    }
    const text = kept.join('\n');
    for (const p of props.reverse()) {
      const uses = (text.match(new RegExp(`\\b${p.name}\\b`, 'g')) || []).length;
      if (uses <= 1 || p.forced) {
        kept.splice(p.idx, 1);
        flags.add(`swift-unused-property-dropped:${p.name}`, 'warning', `Stored property ${p.name} dropped - after the vendor/no-host drops nothing references it (its consumers were vendor glue). Restore with the port if needed.`);
      }
    }
  }
  if (droppedStmts.length) {
    flags.add('swift-host-neutralized', 'warning', `${droppedStmts.length} host-surface statement(s)/declaration(s) dropped in place outside contract methods (bridge/getConfig/CAPConfig/viewController/.capacitor./unportable-helper uses): ${droppedStmts.slice(0, 4).map((s) => s.slice(0, 60)).join(' | ')}${droppedStmts.length > 4 ? ' …' : ''}. Lifecycle bodies keep their surviving logic.`);
  }
  body = kept.join('\n');

  // impl = the translated body, conformSwift's input
  // unreferenced vendor imports drop (stripe: with PaymentSheetHelper
  // skipped, nothing references StripePaymentSheet anymore) - a dangling
  // import of a missing module fails compilation by itself
  {
    const helperText = helpers.map((h) => h.text).join('\n');
    body = body.split('\n').filter((l) => {
      const m = l.match(/^import (\w+)$/);
      if (!m || SDK_IMPORTS.has(m[1]) || m[1] === 'Capacitor') return true;
      const codeOnly = body.split('\n').filter((x) => x !== l && !x.trim().startsWith('//') && !x.trim().startsWith('*') && !x.trim().startsWith('/*')).join('\n');
      const helperCodeOnly = helperText.split('\n').filter((x) => !x.trim().startsWith('//') && !x.trim().startsWith('*') && !x.trim().startsWith('/*')).join('\n');
      const used = new RegExp(`\\b${m[1]}\\b`).test(codeOnly) || new RegExp(`\\b${m[1]}\\b`).test(helperCodeOnly);
      if (!used) {
        flags.add(`swift-vendor-import-dropped:${m[1]}`, 'warning', `import ${m[1]} dropped - after the no-host/vendor policy no live code references the module (all dependent code dropped-with-rejection). Wire the SDK and restore the port if that behavior matters.`);
        return false;
      }
      return true;
    }).join('\n');
  }

  // SPM resource accessor - does not exist under bazel; approximate
  if (/Bundle\.module/.test(body)) {
    body = body.replace(/Bundle\.module/g, 'Bundle.main');
    flags.add('swift-bundle-module-subst', 'warning', 'Bundle.module (SPM resource accessor) substituted with Bundle.main - bazel-built modules do not generate the SPM resource bundle. Wire the real resource bundle through the module target if plugin assets matter.');
  }

  const impl = `${body}\n`;

  // implFile = impl + the ValdiCall/listener shims - a self-contained
  // REFERENCE translation; BUILD.bazel compiles conformance + support only
  const implFile = `${body}\n${[
    banner('plugin2valdi generated shims - reference only (compiled path: conformance + support)'),
    '// ValdiCall mirrors the PluginCall surface (resolve/reject) so translated',
    '// bodies stay untouched. Resolve overloads are typed per the contract.',
    'public final class ValdiCall {',
    primary ? `    public func resolve(_ value: ${primary}) { /* TODO(valdi-verify): wire to Valdi async result */ }` : '',
    '    public func resolve() { /* TODO(valdi-verify): wire to Valdi async result (void) */ }',
    '    public func reject(_ message: String) { /* TODO(valdi-verify): wire to Valdi error path */ }',
    '}',
    '',
    emitEventStubs(model, moduleName, iosPrefix),
  ].filter((x) => x !== null && x !== '').join('\n')}\n`;

  // support = typed bridges ONLY (reference shape: imports + make<>() -> SC*
  // structs, required fields in the constructor, optional fields assigned
  // after init). Compiled alongside the conformance file.
  const makeBlocks = emitMakeFunctions(model, moduleName, flags, iosPrefix);
  const support = [
    'import Foundation',
    'import valdi_core',
    `import ${moduleName}Types`,
    '',
    `// plugin2valdi generated support - typed bridges (${moduleName} module)`,
    '',
    ...(makeBlocks.length ? [makeBlocks.join('\n\n') + '\n'] : []),
  ].join('\n');

  return { impl, implFile, support, helpers, hostPolicy };
}
