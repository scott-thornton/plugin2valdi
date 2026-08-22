// Emit the Valdi module .d.ts - the contract, now the source of truth for
// Valdi's own binding codegen.
//
// GRAMMAR VERIFIED against the real toolchain (Layer 1 spike, 2026-08-20):
//   - file-level doc annotation:  /** @ExportModule */
//   - native-backed structs:       /** @ExportModel({ ios: 'SCX', android: 'pkg.X' }) */
//   - listener/event interfaces:   /** @ExportProxy({ ios: 'SCX', android: 'pkg.X' }) */
//   - async:                       Promise<T> returns are sanctioned
//     (valdi_webview/src/WebViewNative.d.ts: getState(): Promise<IWebViewControllerState>)
//
// EVENTS - THE VERIFIED LISTENER PATTERN (distilled 2026-08-21 from
// valdi_webview, whose generated bindings were built through the real Valdi
// compiler - bazel target valdi_webview_api_objc, header
// SCCValdiWebViewTypes.h - plus the events module validation build):
//   d.ts:     @ExportProxy({ ios: 'SCXListener', android: 'pkg.XListener' })
//             export interface XListener { evtName(payload: Model): void; }
//             export function setListener(listener?: XListener): void;
//   codegen:  @protocol SCXListener <NSObject, SCValdiMarshallable>  (name =
//             the ios annotation value, NOT the interface name) with the
//             param-name selectorized:
//               - (void)evtNameWithPayload:(SCModel * _Nonnull)payload;
//             no-arg listener methods lose the suffix (- (void)onLoadCompleted;)
//             the MODULE protocol gains, from the top-level setListener fn:
//               - (void)setListenerWithListener:(id<SCXListener> _Nullable)listener;
//   Swift:    conform via @objc(setListenerWithListener:) func
//             setListenerWith(_ listener: SCTestEventsListener?) - the raw
//             selector imports set-family-mangled, compile-verified - and
//             emit through listener?.evtName(withPayload:) (verified import
//             of evtWithPayload:). Reference impls:
//             valdi_webview ios/SCValdiWebViewControllerImpl.m (ObjC) and
//             android/.../WebViewControllerImpl.kt (interface names verbatim).
//   PROOF:    test/fixtures/events translated + compiled GREEN through the
//             real toolchain (bazel a scratch app build with the patched
//             local compiler); the generated test_eventsTypes.h contains
//             exactly the declarations above.
// Reference impl: external valdi~ src/valdi_modules/src/valdi/valdi_webview.

import { pascal, camel } from './model.mjs';

function materializeInlinePayloads(model, flags) {
  const types = [...model.types];
  const parseInline = (raw, name) => {
    const fieldsSrc = raw.slice(1, -1);
    const fields = fieldsSrc.split(',').map((f) => {
      const idx = f.indexOf(':');
      return idx === -1 ? null : { name: f.slice(0, idx).trim(), type: f.slice(idx + 1).trim().replace(/;+$/, '').trim(), optional: false };
    }).filter(Boolean);
    const t = { name, kind: 'object', fields, synthetic: true };
    types.push(t);
    // synthetic event-payload/method-result types must be visible to the
    // Swift/Java transformers too (make<>() bridges reference SC* structs of
    // them) - model.types is the established cross-pass channel (ev.payloadType)
    if (!model.types.some((x) => x.name === name)) model.types.push(t);
  };
  for (const ev of model.events) {
    if (!ev.payload.startsWith('{')) continue;
    const name = pascal(ev.name) + 'Payload';
    ev.payloadType = name;
    parseInline(ev.payload, name);
  }
  // inline method returns: Promise<{ paymentResult: X }> -> named Result type;
  // array-of-literal returns (AsyncStorage getValues: { key, value|null }[])
  // get a ResultItem name
  for (const m of model.methods) {
    if (!m.returns || !m.returns.trim().startsWith('{')) continue;
    const arr = m.returns.trim().match(/^\{(.+)\}\[\]$/);
    const name = pascal(m.name) + 'Result';
    if (arr) {
      parseInline(`{${arr[1]}}`, `${name}Item`);
      m.returns = `${name}Item[]`;
    } else {
      parseInline(m.returns, name);
      m.returns = name;
    }
  }
  // union returns (inline literal unions, or names resolving to NON-ENUM
  // union types): the compiler rejects them in return position
  // (probe-verified) - collapse to string in the MODEL so the native emitters
  // never see a raw union (the d.ts emission collapses independently at the
  // type level). Nullable-only unions (T | undefined) are accepted by the
  // compiler: keep the base type. TS enums (fromEnum unions) are NOT unions
  // to the compiler once emitted as @ExportEnum - their returns survive.
  const unionTypeNames = new Set(model.types.filter((t) => t.kind === 'union' && !t.fromEnum).map((t) => t.name));
  for (const m of model.methods) {
    if (!m.returns) continue;
    const base = m.returns.replace(/\|\s*(?:undefined|null)\b/g, '').trim();
    if (base.includes('|') || unionTypeNames.has(base)) {
      flags.add(`union-collapsed:${m.name}`, 'warning', `Union return ${m.returns} on ${m.name}() collapsed to string - the compiler rejects union returns (probe-verified; see union-rejections-verified).`);
      m.returns = 'string';
    } else if (base !== m.returns) {
      m.returns = base;
    }
  }
  // inline method params: fn(options: { isVisible: boolean }) -> named Options
  // type (keyboard E2E: the compiler rejects raw literals in param position -
  // "Unrecognized type 'literal'. Only annotated types can be exported.")
  // Array-of-literal params ({ key, value }[] - AsyncStorage setValues) get
  // the same treatment with an Item name.
  for (const m of model.methods) {
    for (const p of m.params || []) {
      if (!p.type || !p.type.trim().startsWith('{')) continue;
      const arr = p.type.trim().match(/^\{(.+)\}\[\]$/);
      const name = pascal(m.name) + pascal(p.name);
      if (arr) {
        parseInline(`{${arr[1]}}`, `${name}Item`);
        p.type = `${name}Item[]`;
      } else {
        parseInline(p.type, name);
        p.type = name;
      }
    }
  }
  // inline object-literal arrays in fields: { label: string }[] -> named type []
  // (observed: compiler rejects raw literals - "Unrecognized type 'literal'")
  const arrayRefs = [];
  for (const t of model.types) {
    for (const f of t.fields || []) {
      const m = f.type && f.type.match(/^\{(.+)\}\[\]$/);
      if (!m) continue;
      const name = pascal(t.name) + pascal(f.name) + 'Item';
      parseInline(`{${m[1]}}`, name);
      f.type = `${name}[]`;
      arrayRefs.push(`${t.name}.${f.name}`);
    }
  }
  if (arrayRefs.length) {
    flags.add('inline-array-synthesized', 'warning', `Inline object-literal array field(s) synthesized to named types: ${arrayRefs.join(', ')}. Array-of-@ExportModel support in codegen is unverified - if the compiler rejects them, flatten to two parallel arrays or restructure by hand.`);
  }
  // nested inline object FIELDS (app plugin: `error?: { message: string }`
  // inside RestoredListenerEvent) - codegen rejects raw literals in field
  // position just like everywhere else
  const nestedRefs = [];
  for (const t of model.types) {
    for (const f of t.fields || []) {
      if (!f.type || !/^\{.+\}$/.test(f.type) || f.type.includes('|')) continue;
      const name = pascal(t.name) + pascal(f.name) + 'Item';
      parseInline(f.type, name);
      f.type = name;
      nestedRefs.push(`${t.name}.${f.name}`);
    }
  }
  if (nestedRefs.length) {
    flags.add('inline-nested-synthesized', 'warning', `Inline object-literal field(s) synthesized to named types (codegen rejects raw literals): ${nestedRefs.join(', ')}.`);
  }
  return types;
}

// Resolve TS string enums (model kind 'union' + fromEnum) for @ExportEnum
// emission. Wire VALUES are preserved verbatim; member names are synthesized
// from the values (upper-case identifier form - the parser keeps only the
// initializer values, not the member names). Demotes unemittable enums back
// to plain unions (fromEnum=false) so every emitter stays consistent.
// GRAMMAR (probe-verified 2026-08-21, real toolchain - an enum probe module
// module through the ValdiCompile pipeline; see enum-grammar-verified):
//   /**
//    * @ExportEnum({ ios: 'SCMode', android: 'pkg.Mode' })
//    */
//   export const enum Mode { BODY = 'body', IONIC = 'ionic' }
function resolveEnums(types, flags) {
  const enums = new Map(); // name -> { members: [[NAME, value]], firstValue, ambiguous }
  for (const t of types) {
    if (t.kind !== 'union' || !t.fromEnum) continue;
    const values = (t.values || []).map((v) => String(v));
    const usable = values.length > 0 && values.every((v) => v.length > 0);
    if (!usable) {
      t.fromEnum = false; // demote: emitted as a collapsed union everywhere
      flags.add(`enum-collapsed:${t.name}`, 'warning', `Enum ${t.name} has no usable string values - collapsed to string (see union-rejections-verified).`);
      continue;
    }
    const used = new Set();
    const members = [];
    let ok = true;
    for (const v of values) {
      // member names: the drawing-module convention (DEMI_BOLD = 'demi-bold')
      let name = v.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (/^[0-9]/.test(name)) name = `_${name}`;
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) { ok = false; break; }
      let candidate = name;
      let i = 2;
      while (used.has(candidate)) candidate = `${name}_${i++}`;
      used.add(candidate);
      members.push([candidate, v]);
    }
    if (!ok) {
      t.fromEnum = false;
      flags.add(`enum-collapsed:${t.name}`, 'warning', `Enum ${t.name} has value(s) that cannot form valid member identifiers (${values.join(' | ')}) - collapsed to string (see union-rejections-verified).`);
      continue;
    }
    // numeric-enum ambiguity: the parser stringifies non-string initializers
    // to member NAMES, indistinguishably from `A = 'A'`. Values that equal
    // their synthesized member names MIGHT have been a numeric enum - flag.
    const ambiguous = members.every(([n, v]) => n === v);
    t.members = members;
    enums.set(t.name, { members, firstValue: values[0], ambiguous });
  }
  return enums;
}

// Map TS field types to the verified-safe surface. TS string enums keep their
// NAME (emitted as @ExportEnum above - the compiler accepts them in every
// position, probe-verified). String-literal unions and named union types
// still collapse to string - VERIFIED necessary: the Valdi compiler rejects
// every literal-union position (probe matrix 2026-08-21, real toolchain via
// the patched local compiler; see union-rejections-verified flag in emitDts).
// `T | null` becomes `T | undefined` per stdlib optional-field convention -
// the one union shape the compiler accepts.
function tsTypeFor(type, flags, where, unionNames = new Set(), enumNames = new Set()) {
  const t = type.replace(/\s+/g, ' ').trim();
  const nullFree = t.replace(/\|\s*null|null\s*\|/g, '').trim();
  const isNullable = nullFree !== t;
  const base = (() => {
    if (/^(string|number|boolean)$/.test(nullFree)) return nullFree;
    if (/^(string|number|boolean)\[\]$/.test(nullFree)) return nullFree;
    if (enumNames.has(nullFree)) return nullFree; // @ExportEnum reference
    const enumArr = nullFree.match(/^(\w+)\[\]$/);
    if (enumArr && enumNames.has(enumArr[1])) {
      flags.add(`enum-array-collapsed:${where}`, 'warning', `${nullFree} (${where}) collapsed to string[] - arrays of enums are an unverified codegen position (the enum probe covered field/optional/param/return/event-payload); the element literal set is preserved only in this flag.`);
      return 'string[]';
    }
    if (unionNames.has(nullFree)) {
      flags.add(`union-collapsed:${where}`, 'warning', `${nullFree} collapsed to string - the Valdi compiler rejects named literal-union aliases ("Unrecognized type 'String'. Only annotated types can be exported.") and the enum rewrite is not taken (see union-rejections-verified); the literal set is preserved only in this flag.`);
      return 'string';
    }
    if (t.includes('|')) {
      flags.add(`type-collapsed:${where}`, 'warning', `Type "${t}" (${where}) collapsed to string - the Valdi compiler rejects inline unions ("Union types are only supported with null or undefined"); only the emitted T | undefined nullable form is accepted.`);
      return 'string';
    }
    return t; // named type reference
  })();
  return isNullable ? `${base} | undefined` : base;
}

export function emitDts(model, moduleName, flags, opts = {}) {
  const androidPrefix = opts.androidPkg || 'com.plugin2valdi.modules';
  const iosPrefix = opts.iosPrefix || 'SC';
  const allTypes = materializeInlinePayloads(model, flags);
  const enums = resolveEnums(allTypes, flags);
  const enumNames = new Set(enums.keys());
  const iosPkg = (name) => `${iosPrefix}${name}`;
  const androidPkg = (name) => `${androidPrefix}.${moduleName}.${name}`;
  const lines = [];

  // reachability pruning: emit only types transitively referenced by the
  // contract itself. Multi-file loading pulls in second-degree types
  // (function-typed fields, external package internals) that violate
  // annotation closure and can silently poison codegen.
  const typeByName = new Map(allTypes.map((t) => [t.name, t]));
  const namedRefs = (raw) => [...String(raw || '').matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]);
  const reachable = new Set();
  const visit = (name) => {
    if (reachable.has(name) || !typeByName.has(name)) return;
    reachable.add(name);
    const t = typeByName.get(name);
    if (t.kind === 'object') {
      for (const f of t.fields || []) namedRefs(f.type).forEach(visit);
    }
  };
  model.methods.forEach((m) => { m.params.forEach((p) => namedRefs(p.type).forEach(visit)); namedRefs(m.returns).forEach(visit); });
  model.events.forEach((e) => namedRefs(e.payloadType || e.payload).forEach(visit));
  const types = allTypes.filter((t) => reachable.has(t.name));
  if (allTypes.length !== types.length) {
    const dropped = allTypes.filter((t) => !reachable.has(t.name)).map((t) => t.name);
    flags.add('types-pruned', 'resolved', `${dropped.length} loaded type(s) not reachable from the contract were not emitted: ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ', ...' : ''}`);
  }

  lines.push('/**');
  lines.push(' * @ExportModule');
  lines.push(' */');
  lines.push('');
  lines.push(`// Translated from the ${model.dialect === 'rn' ? 'React Native TurboModule spec' : 'Capacitor plugin contract'} "${model.interfaceName.replace(/@/g, '')}" via plugin2valdi.`);
  lines.push('// Grammar verified against valdi_webview/src/WebViewNative.d.ts + valdi_http.');
  lines.push('// NOTE: the annotation parser treats any at-sign-prefixed word in comments');
  lines.push('// as an annotation (verified by build error) - never put handles in prose.');
  lines.push('');

  const structNames = new Set();
  const unionNames = new Set(types.filter((t) => t.kind === 'union' && !t.fromEnum).map((t) => t.name));
  // @ExportEnum declarations first (structs below reference them)
  for (const t of types) {
    if (!t.fromEnum || !enumNames.has(t.name)) continue;
    const { members, ambiguous } = enums.get(t.name);
    lines.push('/**');
    lines.push(` * @ExportEnum({`);
    lines.push(` *   ios: '${iosPkg(t.name)}',`);
    lines.push(` *   android: '${androidPkg(t.name)}'`);
    lines.push(' * })');
    lines.push(' */');
    lines.push(`export const enum ${t.name} {`);
    lines.push(members.map(([n, v]) => `  ${n} = '${v}',`).join('\n'));
    lines.push('}');
    lines.push('');
    flags.add(`enum-emitted:${t.name}`, 'resolved', `TS enum ${t.name} emitted as an @ExportEnum string enum - wire values [${members.map(([, v]) => `'${v}'`).join(', ')}] preserved verbatim from the plugin source; the toolchain generates an NS_STRING_ENUM typedef (typedef NSString * _Nonnull ${iosPkg(t.name)} + ${iosPkg(t.name)}<MEMBER> constants, probe-verified) on iOS and a real Kotlin enum class (var <field>: ${t.name}, .getValue() returns the wire string) on Android, and the Swift/Java bridges were emitted to match (see enum-grammar-verified).${ambiguous ? ` AMBIGUITY: every value equals its (synthesized) member name - the parser cannot distinguish a string enum with name-equal initializers from a NUMERIC enum (whose initializers are stringified to member names). If the source was numeric, the emitted wire values are invented strings; verify.` : ''}`);
  }
  for (const t of types) {
    if (t.kind === 'union' && !enumNames.has(t.name)) {
      flags.add(`union-collapsed:${t.name}`, 'warning', `Union ${t.name} (${(t.values || []).join(' | ')}) collapsed to string at use sites - VERIFIED necessary, see union-rejections-verified.`);
      continue;
    }
    if (enumNames.has(t.name)) continue; // already emitted as @ExportEnum above
    // aliases (crashlytics: `type SetCustomKeyOptions = CustomKeyAndValue`)
    // emit as interfaces carrying the RESOLVED target's fields (one-hop chain)
    let src = t;
    for (let hops = 0; src.kind === 'alias' && hops < 5; hops++) {
      const next = types.find((x) => x.name === src.alias);
      if (!next || next === src) break;
      src = next;
    }
    // alias to a PRIMITIVE (geolocation: `type CallbackID = string`) - not a
    // struct: use sites resolve to the primitive, nothing to emit here
    if (src !== t && src.kind === 'alias' && /^(string|number|boolean)$/.test(String(src.alias || ''))) {
      flags.add(`alias-primitive:${t.name}`, 'resolved', `Type alias ${t.name} = ${src.alias} resolved to the primitive at use sites - no struct emitted.`);
      continue;
    }
    if (src !== t && src.kind === 'object' && Array.isArray(src.fields)) {
      t.fields = src.fields.map((f) => ({ ...f }));
      flags.add(`alias-resolved:${t.name}`, 'resolved', `Type alias ${t.name} = ${src.name} emitted as an interface carrying ${src.name}'s fields.`);
    }
    structNames.add(t.name);
    const unsupportedFields = (t.fields || []).filter((f) => f.unsupported);
    if (unsupportedFields.length) {
      flags.add(`unsupported-type:${t.name}`, 'blocking', `Field(s) ${unsupportedFields.map((f) => f.name).join(', ')} of ${t.name} (a type REACHABLE from this contract) use type shapes the stringifier does not support - restructure or inline by hand.`);
    }
    lines.push('/**');
    lines.push(` * @ExportModel({`);
    lines.push(` *   ios: '${iosPkg(t.name)}',`);
    lines.push(` *   android: '${androidPkg(t.name)}'`);
    lines.push(` * })`);
    lines.push(' */');
    lines.push(`export interface ${t.name} {`);
    for (const f of t.fields || []) {
      // nullable types (T | undefined / T | null) are OPTIONAL fields in the
      // contract even without the ? syntax, matching the support emitter
      const isNullable = f.optional || /\|\s*(undefined|null)\b/.test(f.type);
      // nullable: the ? carries the optionality, strip | undefined from the
      // type annotation (redundant, and the compiler wants one form)
      const emitType = isNullable ? f.type.replace(/\s*\|\s*(undefined|null)\b/g, '') : f.type;
      lines.push(`  ${f.name}${isNullable ? '?' : ''}: ${tsTypeFor(emitType, flags, `${t.name}.${f.name}`, unionNames, enumNames)};`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const m of model.methods) {
    // watch-pattern params: function-typed (callback) params cannot cross
    // into Valdi (unannotated function types dangle in codegen) - drop them
    // and flag the semantic port (continuous updates belong on setListener)
    const droppedCallbacks = [];
    const liveParams = m.params.filter((p) => {
      const pt = (p.type || '').trim();
      const alias = types.find((x) => x.kind === 'alias' && x.name === pt);
      const isFnAlias = alias && alias.payloadType !== undefined;
      const isInlineFn = /^\(.*\)\s*=>/.test(pt);
      if (isFnAlias || isInlineFn) { droppedCallbacks.push(p.name); return false; }
      return true;
    });
    if (droppedCallbacks.length) {
      flags.add(`watch-callback-dropped:${m.name}`, 'blocking', `${m.name}()'s callback param(s) (${droppedCallbacks.join(', ')}) dropped from the contract - Capacitor delivers continuous updates by repeatedly resolving the same call; a Valdi promise fulfills once. Port: stream updates through the @ExportProxy listener instead (or resolve once and poll). The translated body's callback machinery is flagged for the hand port.`);
    }
    // alias-to-primitive resolution at use sites (geolocation: CallbackID)
    const resolvePrim = (t) => {
      const a = t && types.find((x) => x.kind === 'alias' && x.name === String(t).trim() && !x.payloadType && /^(string|number|boolean)$/.test(String(x.alias || '')));
      return a ? a.alias : t;
    };
    const params = liveParams.map((p) => `${p.name}: ${tsTypeFor(resolvePrim(p.type), flags, `${m.name}(${p.name})`, unionNames, enumNames)}`).join(', ');
    const ret = m.isPromise ? `Promise<${tsTypeFor(resolvePrim(m.returns), flags, m.name, unionNames, enumNames)}>` : tsTypeFor(resolvePrim(m.returns), flags, m.name, unionNames, enumNames);
    lines.push(`export function ${m.name}(${params}): ${ret};`);
  }
  lines.push('');

  if (model.events.length) {
    const listenerName = pascal(moduleName) + 'Listener';
    // payload typing: named struct (incl. synthesized inline payloads) as-is,
    // enums as-is (listener enum payloads are probe-verified -
    // modeChangedWithPayload:(SCMode) / fun modeChanged(payload: Mode)),
    // primitives as-is (webview: onMessage(message: string)), unknown -> string
    const payloadOf = (ev) => ev.payloadType
      || (/^(string|number|boolean)$/.test(ev.payload) ? ev.payload : (structNames.has(ev.payload) || enumNames.has(ev.payload) ? ev.payload : 'string'));
    lines.push('/**');
    lines.push(` * @ExportProxy({`);
    lines.push(` *   ios: '${iosPkg(listenerName)}',`);
    lines.push(` *   android: '${androidPkg(listenerName)}'`);
    lines.push(' * })');
    lines.push(' */');
    lines.push(`export interface ${listenerName} {`);
    for (const ev of model.events) {
      lines.push(`  ${camel(ev.name)}(payload: ${payloadOf(ev)}): void;`);
    }
    lines.push('}');
    lines.push('');
    lines.push(`export function setListener(listener?: ${listenerName}): void;`);
    lines.push('');
    flags.add('events-listener-verified', 'resolved', `Events emitted as the verified @ExportProxy listener pattern (${iosPkg(listenerName)} + module-level setListener(listener?)) - codegen verified against the real toolchain via the valdi_webview_api_objc build (generated SCCValdiWebViewTypes.h: @protocol from the ios annotation, param-name selectors evtWithPayload:, setListenerWithListener: on the module protocol) and the test/fixtures/events module compiled through Valdi codegen. Capacitor semantics mapped: addListener('e', cb) -> per-event listener method; removeAllListeners -> dropped (the JS side clears by calling setListener(undefined)). Still provisional: no per-listener handles (Capacitor's PluginListenerHandle/CallbackID and removeListener(id) collapse into the single setListener slot - one listener per event set), and event RETENTION (retainUntilConsumed) is flagged separately.`);
  }

  flags.add('enum-grammar-verified', 'resolved', 'ExportEnum probe matrix (2026-08-21, real Valdi toolchain - a an enum probe module driven through the ValdiCompile pipeline): @ExportEnum({ ios: \'SCX\', android: \'pkg.X\' }) on `export const enum X { A = \'a\' }` is ACCEPTED in EVERY position the translator emits - @ExportModel field, optional field, options-struct param, Promise<Enum> return, and listener event payload. Generated shapes (read from the real outputs): iOS `typedef NSString * _Nonnull SCMode NS_STRING_ENUM` + `typedef NSString * _Nullable SCMode_Nullable` + `FOUNDATION_EXPORT SCMode SCMode<A>;` constants (constant = TypeName + member name, no separator); struct fields `@property (copy, nonatomic) SCMode _Nonnull mode;` (optional: SCMode_Nullable) with `initWithMode:(SCMode _Nonnull)`; protocol methods `- (SCValdiPromise<SCMode> * _Nonnull)getMode;`; listener `- (void)modeChangedWithPayload:(SCMode _Nonnull)payload;`. Android: a REAL Kotlin `enum class Mode { BODY, IONIC; val value: String }` in the module package; struct `var mode: Mode` / `var fallback: Mode?` with `@ValdiClassConstructor constructor(mode: Mode, fallback: Mode? = null)`; interface `fun getMode(): Promise<Mode>`; listener `fun modeChanged(payload: Mode)`. TS surface: the contract d.ts itself - app code uses `X.A` member access (valdi_test/src/MarshallingTests.ts: receiveStringEnum(TestStringEnum.SECOND) === \'two\', and the marshalled value compares EQUAL to the enum member, i.e. string enums cross the bridge as their wire strings). Because SCMode is a plain NSString typedef, ObjC bodies compile unchanged. Caveats kept honest: (1) literal UNIONS still collapse to string - synthesizing an enum from a union renames concepts; only TS-declared enums are upgraded; (2) the parser cannot distinguish numeric TS enums (their member names are recorded as the values), so every value-equals-member-name enum carries an ambiguity note in its enum-emitted flag; (3) enum ARRAYS are collapsed (unprobed position); (4) if the source type was a union-of-enum-members alias rather than a direct enum declaration, the emitted enum carries the FULL underlying enum value set (a superset of the alias).');
  flags.add('union-rejections-verified', 'resolved', 'Literal-union probe matrix (2026-08-21, real Valdi toolchain - patched local compiler driven on a test_unions module through the ValdiCompile pipeline, /tmp/unions-build workspace): the compiler REJECTS string-literal unions in EVERY position - @ExportModel field ("Failed to parse property mode: Union types are only supported with null or undefined (got any | any | any"), optional field (same), method param (same), Promise return (same), literal-union-with-undefined (same), named alias type Mode = ... ("Unrecognized type \'String\'. Only annotated types can be exported."), and unannotated TS string enums ("Unrecognized type \'Mode\'. Only annotated types can be exported."). The accepted representations: (a) T | undefined / T | null nullable unions -> nullable native type (already emitted for T | null), and (b) @ExportEnum string enums - NOW EMITTED for TS-declared enums (see enum-grammar-verified + enum-emitted:*): the Swift/Java emitters learned the enum-typed bridges (SC<Enum>(rawValue:) construction / <Enum>.valueOf-style conversion via .getValue()), so enum-typed fields/returns no longer collapse. Literal unions (inline or named aliases) still collapse to string - synthesizing an enum from a union would invent a type name and member names for a concept the plugin author expressed as an ad-hoc literal set; the literal set stays preserved in these flags.');
  flags.add('dts-grammar-verified', 'resolved', 'Grammar verified against Valdi beta-0.1.1 toolchain (Layer 1 spike): @ExportModule/@ExportModel/@ExportProxy/@ExportEnum doc annotations, Promise<T> returns, setListener proxy pattern; the events listener surface additionally verified through the valdi_webview generated-bindings build + the events fixture module build (see events-listener-verified); the enum surface through the enumprobe module build (see enum-grammar-verified). String-literal unions: VERIFIED rejected in every position - collapse to string is required, see union-rejections-verified. Remaining unknowns: Promise<void> compile check.');
  return lines.join('\n');
}
