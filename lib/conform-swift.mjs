// Swift conformance pass - rewrite a translated body (ValdiCall-shim style)
// into an implementation of the GENERATED module protocol, speaking
// SCValdiPromise. Verified API surface (framework source):
//   SCValdiResolvablePromise<T> + fulfillWithSuccessValue: / fulfillWithError:
//   (valdi_core/ios/valdi_core/SCValdiResolvablePromise.h; reference impl:
//   valdi_webview/ios/SCValdiWebViewControllerImpl.m)
//
// Method spans are tracked by brace depth (bodies pass through verbatim;
// string literals containing braces are a known, flagged edge).

import { replaceCalls, netBraces } from './transform-common.mjs';
import { pascal, camel } from './model.mjs';

const header = (moduleName) => ['import Foundation', 'import valdi_core', `import ${moduleName}Types`, ''];

// iOS-13-gated API tokens (availability floors applied per-func on the
// FINAL assembly; overrides get body-wraps instead - an override must stay
// as available as the declaration it overrides)
const GATED_TOKENS = /\.darkContent\b|UIStatusBarStyle\.darkContent|\.allResourceKeys\b|UIWindowScene|connectedScenes|\.medium\b|\.large\b|AnyCancellable|UIImage\(systemName:/;

export function conformSwift(impl, model, moduleName, moduleClass, flags, helpers = [], iosPrefix = 'SC', hostPolicy = null) {
  const proto = `${moduleName}${moduleClass}`; // e.g. deviceDeviceModule (observed codegen)
  // generated listener protocol name = the .d.ts @ExportProxy ios annotation
  // value (verified against the valdi_webview generated bindings:
  // @protocol SCValdiWebViewListener <NSObject, SCValdiMarshallable>, and the
  // module protocol selector - (void)setListenerWithListener:(id<...> _Nullable))
  const listenerProto = `${iosPrefix}${pascal(moduleName)}Listener`;
  const listenerStorage = camel(pascal(moduleName)) + 'ListenerStorage';
  const iosPkg = (name) => `${iosPrefix}${name}`;

  // method -> result type name (per-method: fixes the uniform-wrap assumption)
  const resultByMethod = new Map(model.methods.map((m) => [m.name, m.returns]));
  const primary = [...resultByMethod.values()].filter((r) => r && r !== 'void')[0];

  // method -> its options param ({name, type}) + that type's field map, for
  // typed options access (preferences E2E: call.getString("key") -> options.key)
  const paramsByMethod = new Map(model.methods.map((m) => [m.name, m.params || []]));
  // field map is ALIAS-AWARE: `type SetCustomKeyOptions = CustomKeyAndValue`
  // emits as an interface carrying the target's fields, but the MODEL still
  // carries it as kind 'alias' - resolve one-hop so parameterization fires
  const resolveToObject = (name, hops = 0) => {
    const t = model.types.find((x) => x.name === name);
    if (!t || hops > 5) return null;
    if (t.kind === 'object') return t;
    if (t.kind === 'alias') return resolveToObject(t.alias, hops + 1);
    return null;
  };
  const objectFields = new Map();
  for (const t of model.types) {
    const o = t.kind === 'object' ? t : resolveToObject(t.alias);
    if (o && Array.isArray(o.fields)) objectFields.set(t.name, o.fields);
  }
  const enumNames = new Set(model.types.filter((t) => t.kind === 'union' && t.fromEnum && t.members).map((t) => t.name));
  const fieldIsOptional = (f) => !f || f.optional || /\|\s*(undefined|null)\b/.test(f.type);

  const lines = [...header(moduleName), ...impl.split('\n')];
  const emittedMethods = new Set();
  const out = [];
  let inMethod = null; // { name, result, depth, sigIndent, opts, optsFields, skipElse }
  let insideClass = false;

  const swiftResult = (r) => {
    // alias-to-primitive returns resolve first (geolocation: CallbackID =
    // string -> the generated protocol promises NSString)
    const ar = r && model.types.find((x) => x.kind === 'alias' && x.name === r.trim() && !x.payloadType && /^(string|number|boolean)$/.test(String(x.alias || '')));
    if (ar) r = ar.alias;
    if (!r || r === 'void') return 'SCValdiUndefinedValue';
    if (/^(string|number|boolean)$/.test(r)) { flags.add(`primitive-return:${r}`, 'warning', `Primitive Promise<${r}> return maps to SCValdiPromise<NSString/NSNumber> - verify marshalling.`); return r === 'boolean' ? 'NSNumber' : 'NSString'; }
    // @ExportEnum returns: the generated protocol promises
    // SCValdiPromise<SC<Enum>> - but the typedef is TRANSPARENT inside ObjC
    // generics, so it imports as SCValdiPromise<NSString> and the enum
    // imports as a distinct struct at value positions. The conformance
    // therefore carries NSString and the make<Enum> bridge returns NSString
    // (compile-probed through the test_enums toolchain build; emit sites
    // re-wrap into the struct via init(rawValue:)).
    if (enumNames.has(r)) {
      if (!flags.has('swift-enum-return')) {
        flags.add('swift-enum-return', 'resolved', `Promise<Enum> methods conform as SCValdiPromise<NSString> with make<Enum> bridges returning NSString - the ObjC SC<Enum> NS_STRING_ENUM typedef is transparent inside the promise generic (imports as NSString there) but a distinct RawRepresentable struct at value positions (struct fields, listener payloads), where the conformance constructs it via the NON-failable init(rawValue:). Optional enum struct fields are their own SC<Enum>_Nullable struct type. Compile-probed green through the test_enums module toolchain build.`);
      }
      return 'NSString';
    }
    return iosPkg(r);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // class header -> conformance declaration
    if (!insideClass && new RegExp(`public (final )?class ${moduleClass} \\{`).test(line)) {
      // availability-gated APIs seen in the translated body/helpers force a
      // class-level floor (starter list - grown as the fleet surfaces more)
      const gated = /\.darkContent\b|UIStatusBarStyle\.darkContent|\.allResourceKeys\b|UIWindowScene|connectedScenes|\.medium\b|\.large\b/;
      if (gated.test(impl) || helpers.some((h) => gated.test(h.text || ''))) {
        // per-func @available is applied at emit time (below) - a CLASS-level
        // floor breaks @objc protocol witnessing (the protocol is ungated)
        flags.add('swift-min-ios-13', 'warning', 'The translated body uses APIs gated to iOS 13+ (UIStatusBarStyle.darkContent, UIWindowScene, UIFont.Metrics...) - affected funcs carry @available(iOS 13.0, *) individually (a class-level floor would break @objc protocol witnessing). Port the gated paths if pre-13 support matters.');
      }
      if (/c2vPrimitivePayload/.test(impl) && !out.some((l) => l.includes('func c2vPrimitivePayload'))) {
        out.push('// stateless payload unwrap - free function so closures need no self capture');
        out.push('private func c2vPrimitivePayload(_ data: [String: Any]?) -> Any? {');
        out.push('    data?.values.first');
        out.push('}');
        out.push('');
      }
      // Swift dead-shim: private helper funcs still taking a call object
      // (splash-screen: splashScreenSettings(from call:)) - mirrors the java
      // helper-call-flow treatment: stubs keep the file compiling, the flow
      // is runtime-dead until the hand port
      if (/func \w+\((?!_ call: ValdiCall\b)[^)]*\bcall: ValdiCall\b|\[\s*ValdiCall\s*\]|let call = ValdiCall\(\)/.test(impl) || [...(hostPolicy?.deadFuncs || [])].length) { // helpers (any param position), stored-call arrays, orphan locals - contract shape excluded
        const verbs = new Set([...impl.matchAll(/\bcall\??\.(\w+)\(/g)].map((m) => m[1]));
        const stub = (v) => ({
          resolve: ['    func resolve() {}', '    func resolve(_ value: [String: Any]) {}', `    func resolve(_ value: ${(() => { const pr = [...resultByMethod.values()].find((r) => r && r !== 'void'); return pr ? `${iosPrefix}${pr}` : 'SCValdiUndefinedValue'; })()}) {}`],
          reject: ['    func reject(_ message: String) {}'],
          getString: ['    func getString(_ key: String) -> String? { return nil }'],
          getInt: ['    func getInt(_ key: String) -> Int? { return nil }', '    func getInt(_ key: String, _ def: Int) -> Int { return def }'],
          getDouble: ['    func getDouble(_ key: String) -> Double? { return nil }'],
          getBool: ['    func getBool(_ key: String) -> Bool? { return nil }'],
          getArray: ['    func getArray(_ key: String) -> [Any]? { return nil }'],
        }[v] || null);
        const stubLines = [...verbs].flatMap((v) => stub(v) || []);
        flags.add('swift-helper-call-flow', 'blocking', `Private helper func(s) still take a Capacitor-style call object - a dead ValdiCall shim (stubs for: ${[...verbs].join(', ')}) keeps the conformance compiling, but the flow is RUNTIME-DEAD. Port by hand: thread the SCValdiResolvablePromise (or the resolved value) through the helper instead of the call object.`);
        out.push('// plugin2valdi dead shim - private helper(s) still carry a Capacitor-style call');
        out.push('// object (flagged swift-helper-call-flow). Stubs exist ONLY so the');
        out.push('// preserved bodies compile; NOTHING routes here. Port the helper(s) and');
        out.push('// delete this class.');
        out.push('final class ValdiCall {');
        out.push('    var keepAlive = false');
        out.push(...(stubLines.length ? stubLines : []));
        out.push('}');
        out.push('');
      }
      out.push(`@objc(${moduleClass})`);
      out.push(`public final class ${moduleClass}: NSObject, ${proto} {`);
      insideClass = true;
      continue;
    }

    // method signature -> promise-returning conformance method
    if (!inMethod) {
      const sig = line.match(/^(\s*)(?:@objc\s+)?(?:public\s+)?func (\w+)\(_ call: ValdiCall\) \{$/);
      if (sig && insideClass) {
        const name = sig[2];
        const result = resultByMethod.get(name) ?? primary;
        const swiftType = swiftResult(result);

        // parameterized methods: the generated protocol selectorizes
        // `fn(options: X)` to `fnWithOptions:` - and Swift imports that
        // selector two different ways depending on the fn prefix
        // (`configure(with:)` but `setWith(_:)`), so the conformance pins
        // the ObjC selector with @objc() instead of guessing importer names
        // live params only: function-typed (callback) params dropped from
        // the contract (watchPosition's callback) don't parameterize here
        const isCallbackParam = (p) => {
          const alias = model.types.find((x) => x.kind === 'alias' && x.name === (p.type || '').trim());
          return (alias && alias.payloadType !== undefined) || /^\(.*\)\s*=>/.test(p.type || '');
        };
        const params = (paramsByMethod.get(name) || []).filter((p) => !isCallbackParam(p));
        const opts = params.length === 1 && objectFields.has(params[0].type) ? params[0] : null;
        if (params.length > 1) {
          flags.add('swift-multi-param', 'blocking', `Method ${name}() has ${params.length} parameters - the generated protocol selector for multi-param methods is unverified. Emitting the first parameter only; fix the signature by hand against the generated ${moduleName}Types header.`);
        }
        // importer get/set FAMILIES mangle any name STARTING with get/set:
        // bare set -> setWith(_:) (preferences), setStyle -> setStyleWith(_:)
        // (status-bar compile-verified); other verbs keep the preposition
        // split (configureWithOptions: -> configure(with:))
        // Unified importer label rules (empirical on every compiled point:
        // set/setStyle/get+GetOptions/getCurrentPosition/watchPosition/
        // configure/createApplePay/initialize/openAndroid):
        //  - set* ALWAYS mangles to name+With(_:)
        //  - read-verbs (get/is/open/watch/fetch...) collapse to (with:)
        //    UNLESS Pascal(base)+Pascal(param) == the type (get+GetOptions
        //    -> getWith(_:))
        //  - everything else: (with:) on that exact match (configure),
        //    else with<Pascal(param)>: (createApplePay -> withOptions:,
        //    initialize -> withOpts:)
        // Final table (every entry compile-verified): bare get and ANY
        // set* mangle to nameWith(_:); factory verbs (create/make/build/
        // initialize/new) keep the explicit label; EVERYTHING ELSE collapses
        // to (with:) - hide/show/watchPosition/getCurrentPosition/open*/
        // configure all verified collapsing
        // FINAL rule (selector-probe verified on header-imported protocols;
        // pinning does NOT witness - exact imported names required):
        //  - set* and bare get mangle to nameWith(_:)
        //  - param named 'options' ALWAYS collapses to (with:) - every
        //    create*/watchPosition/hide/open/createChannel/createApplePay
        //    verified collapsing
        //  - other param names: with<Pascal(param)>: (initialize(opts:) ->
        //    withOpts:, handleURLCallback(opts:) -> withOpts:)
        // COMPLETE importer matrix (every entry compile-verified):
        //  - set* ALWAYS mangles: nameWith(_:)
        //  - get*: exact type reconstruction (getToken/GetTokenOptions)
        //    mangles nameWith(_:); otherwise collapses (getCurrentPosition/
        //    PositionOptions -> (with:))
        //  - read-verbs (is/open/watch/hide/show/load/fetch/read/check/
        //    find/query/present) ALWAYS collapse -> (with:)
        //  - factory verbs (create/make/build/initialize/new) and
        //    everything else: collapse ONLY on exact reconstruction
        //    (createChannel/CreateChannelOptions -> (with:), configure/
        //    ConfigureOptions -> (with:)); else with<Pascal(param)>:
        //    (createApplePay/ApplePayOptions -> withOptions:, initialize/
        //    opts -> withOpts:)
        const isSetFamily = /^set/.test(name);
        const exact = pascal(name) + pascal(opts?.name || 'options') === pascal(opts?.type || 'X');
        const isGet = /^get/.test(name);
        const isReadVerb = /^(is|open|watch|hide|show|load|fetch|read|check|find|query|present)/.test(name);
        const mangle = isSetFamily || (isGet && exact);
        const collapse = isGet || isReadVerb || exact;
        const label = mangle ? null : (collapse ? 'with' : `with${pascal(opts?.name || 'options')}`);
        const sigLines = opts
          ? [
            `${sig[1]}@objc(${name}With${pascal(opts.name)}:)`,
            mangle
              ? `${sig[1]}public func ${name}With(_ ${opts.name}: ${iosPkg(opts.type)}) -> SCValdiPromise<${swiftType}> {`
              : `${sig[1]}public func ${name}(${label} ${opts.name}: ${iosPkg(opts.type)}) -> SCValdiPromise<${swiftType}> {`,
          ]
          : [`${sig[1]}public func ${name}() -> SCValdiPromise<${swiftType}> {`];

        // no-host policy (Swift port of the objc/java policy): a contract
        // method whose body depends on the Capacitor bridge surface -
        // directly (bridge/getConfig/.capacitor./CAP*) or transitively (an
        // instance of an unportable helper class) - drops-with-rejection
        // using the SAME protocol-satisfying signature; the original body
        // survives as comments for the hand port.
        if (hostPolicy) {
          const depTokens = [...hostPolicy.unportableTypes, ...hostPolicy.instances, ...(hostPolicy.deadFuncs || [])];
          depTokens.push('Messaging', 'FirebaseMessaging', 'FirebaseInstallations', 'Crashlytics', 'FirebaseCrashlytics');
          const depRe = depTokens.length
            ? new RegExp(`\\b(?:${depTokens.join('|')})\\b|\\bbridge\\b|\\bgetConfig\\(|\\.capacitor\\w*|\\bCAPConfig\\b|\\bviewController\\.|\\bJSObject\\b|\\bJSArray\\b|\\bApplicationDelegateProxy\\b`)
            : /\bbridge\b|\bgetConfig\(|\.capacitor\w*|\bCAPConfig\b|\bviewController\.|\bJSObject\b|\bJSArray\b|\bApplicationDelegateProxy\b/;
          let depth = 1; // the sig line's `{`
          let dep = depRe.test(line);
          const spanBody = [];
          let j = i + 1;
          for (; j < lines.length && depth > 0; j++) {
            depth += netBraces(lines[j]);
            if (depth > 0 || !/^\s*\}\s*$/.test(lines[j])) spanBody.push(lines[j]);
            if (depRe.test(lines[j])) dep = true;
          }
          if (dep) {
            emittedMethods.add(name);
            flags.add(`swift-host-dropped:${name}`, 'warning', `Method ${name}() depends on the Capacitor bridge surface (directly or through an unportable helper) - emitted as a rejection ("${name}: not applicable on Valdi - no Capacitor bridge"); the original body is preserved as comments. Port it against Valdi APIs if this behavior matters on Valdi.`);
            out.push(...sigLines);
            out.push(`${sig[1]}    let promise = SCValdiResolvablePromise<${swiftType}>()`);
            out.push(`${sig[1]}    // plugin2valdi: no-host policy - original body preserved for the hand port:`);
            for (const bl of spanBody) out.push(`${sig[1]}    //${bl}`);
            out.push(`${sig[1]}    promise.perform(Selector("fulfillWithError:"), with: NSError(domain: "plugin2valdi", code: 0, userInfo: [NSLocalizedDescriptionKey: "${name}: not applicable on Valdi - no Capacitor bridge"]))`);
            out.push(`${sig[1]}    return promise`);
            out.push(`${sig[1]}`);
            out.push(sig[1] + '}');
            i = j - 1; // resume after the span (j sits on the closing `}`)
            continue;
          }
        }
        emittedMethods.add(name);
        out.push(...sigLines);
        out.push(`${sig[1]}    let promise = SCValdiResolvablePromise<${swiftType}>()`);
        // orphaned bare `call` refs (native-settings: handleOpen(call: call))
        // - dead local keeps the body compiling, flow runtime-dead (java parity)
        if (/[(,:]\s*call\b|\bcall\s*[,)]/.test(impl.split(`func ${name}(`)[1]?.split('\n    }')[0] || '')) {
          flags.add(`swift-orphan-call-sites:${name}`, 'blocking', `A bare \`call\` reference survives in ${name}() (likely passed into a helper) - a dead ValdiCall local keeps it compiling but the flow is RUNTIME-DEAD; thread the SCValdiPromise through the helper instead.`);
          out.push(`${sig[1]}    // plugin2valdi dead shim - see swift-orphan-call-sites:${name}`);
          out.push(`${sig[1]}    let call = ValdiCall()`);
        }
        inMethod = { name, result, depth: 1, indent: sig[1], maker: result && result !== 'void' ? `make${result}` : null, opts, optsFields: new Map((objectFields.get(opts?.type) || []).map((f) => [f.name, f])), skipElse: 0 };
        continue;
      }
      out.push(line);
      continue;
    }

    // inside a method: track depth, rewrite ritual, inject return at close
    let l = line;

    // dropping a guard's else block: the field was non-optional in the
    // contract, so the guard can never fire - the else body (reject TODO +
    // bare return) goes away with it. Braces inside the dropped block count
    // toward skip termination only: they are removed from the emitted text,
    // so method depth must stay untouched.
    if (inMethod.skipElse > 0) {
      for (const ch of l) {
        if (ch === '{') inMethod.skipElse++;
        else if (ch === '}') inMethod.skipElse--;
      }
      continue;
    }

    if (inMethod.opts) {
      // typed options access: `call.getString("key")` -> `options.key`.
      // Optionality comes from the generated struct's property, so the same
      // expression serves guards (String?) and direct use (String).
      // guard-let on a NON-optional field becomes a plain let - conditional
      // binding on a non-optional does not compile, and the guard is dead.
      const g = l.match(/^(\s*)guard let (\w+) = call\.(?:getString|string\(forKey:\s*|getInt|getDouble|getBool|getObject|getArray)\("(\w+)"(?:\s*,[^)]*)?\)\s+else \{$/);
      if (g && !fieldIsOptional(inMethod.optsFields.get(g[3]))) {
        // non-optional guard -> plain let; enum fields read .rawValue (the
        // property is the NS_STRING_ENUM typedef, not String)
        const gf = inMethod.optsFields.get(g[3]);
        const gBase = gf ? gf.type.replace(/\s+/g, ' ').replace(/\|\s*(?:undefined|null)\b/g, '').trim() : null;
        const suffix = gBase && enumNames.has(gBase) ? '.rawValue' : '';
        out.push(`${g[1]}let ${g[2]} = options.${g[3]}${suffix}`);
        inMethod.skipElse = 1;
        continue;
      }
      l = l
        .replace(/call\.(?:getString|string\(forKey:\s*)\("(\w+)"(?:\s*,[^)]*)?\)/g, (_m, field) => {
          // enum-typed fields surface as the NS_STRING_ENUM typedef (a distinct
          // RawRepresentable Swift type, NOT String) - read the wire string
          // through .rawValue so the body's String expectations still hold
          const f = inMethod.optsFields.get(field);
          const base = f ? f.type.replace(/\s+/g, ' ').replace(/\|\s*(?:undefined|null)\b/g, '').trim() : null;
          if (base && enumNames.has(base)) {
            return `options.${field}${fieldIsOptional(f) ? '?' : ''}.rawValue`;
          }
          return `options.${field}`;
        })
        .replace(/call\.(getInt|getBool|getDouble|getArray|getDictionary|getJSON)\("(\w+)"\)(?:\s*,[^)]*)?/g, (_m, _acc, field) => {
          if (!flags.has('swift-param-marshalling')) {
            flags.add('swift-param-marshalling', 'warning', 'call.getInt/getBool/... accessors rewritten to typed options.<field> - number/boolean fields surface as NSNumber on the generated struct; add .doubleValue/.boolValue at use sites if arithmetic follows.');
          }
          return `options.${field}`;
        });
      l = l.replace(/call\.(getObject|getArray)\("(\w+)"\)(?:\s*,[^)]*)?/g, (_m, kind, field) => {
        if (!flags.has('swift-option-object-read')) {
          flags.add('swift-option-object-read', 'warning', `call.getObject/getArray reads map to options.<field> - object fields surface as NSDictionary and arrays as NSArray on the generated struct; verify casts at use sites (local-server: headers as? [String: String]).`);
        }
        return `options.${field}`;
      });
      // early returns inside a promise-returning method must return the promise
      if (/^(\s*)return\s*$/.test(l)) l = l.replace(/return\s*$/, 'return promise');
    }
    if (inMethod.maker) {
      // re-wrap the primary maker with this method's own maker
      l = l.split(`make${primary}(`).join(`${inMethod.maker}(`);
      l = l.replace(/call\.resolve\(/, 'promise.fulfill(withSuccessValue: ');
    } else {
      l = l.replace(/call\.resolve\(\)/, 'promise.fulfill(withSuccessValue: SCValdiUndefinedValue())');
    }
    // unimplemented/unavailable (app plugin): reject through the same
    // ObjC-runtime reach - mirrors the java/objc unimplemented mappings
    l = replaceCalls(l, 'call.unimplemented', () => {
      if (!flags.has('swift-unimplemented-mapped')) {
        flags.add('swift-unimplemented-mapped', 'warning', 'call.unimplemented() sites mapped to promise rejections ("unimplemented") via the ObjC-runtime selector reach - same semantics as the java/objc transforms.');
      }
      return `promise.perform(Selector("fulfillWithError:"), with: NSError(domain: "plugin2valdi", code: 0, userInfo: [NSLocalizedDescriptionKey: "unimplemented"]))`;
    });
    l = replaceCalls(l, 'call.unavailable', () => {
      if (!flags.has('swift-unimplemented-mapped')) {
        flags.add('swift-unimplemented-mapped', 'warning', 'call.unimplemented()/unavailable() sites mapped to promise rejections via the ObjC-runtime selector reach - same semantics as the java/objc transforms.');
      }
      return `promise.perform(Selector("fulfillWithError:"), with: NSError(domain: "plugin2valdi", code: 0, userInfo: [NSLocalizedDescriptionKey: "unavailable"]))`;
    });
    // reject path - swiftc does not import fulfillWithError: (compile probe
    // errors on record; upstream issue draft (d)), but the selector exists on
    // the class: reach it through the ObjC runtime. Compile-probed green on
    // //modules/device:reject_probe (perform + Selector form).
    l = replaceCalls(l, 'call.reject', (inner) => {
      if (!flags.has('swift-reject-objc-runtime')) {
        flags.add('swift-reject-objc-runtime', 'resolved', `call.reject sites reject through the ObjC runtime: SCValdiResolvablePromise.h declares -fulfillWithError: but swiftc does not import it (probe: 'incorrect argument label in call (have withError:, expected withSuccessValue:)' - sibling rejectedPromiseWithError: carries an NS_SWIFT_NAME, fulfillWithError: lacks one; a drafted upstream issue). The selector is reachable via promise.perform(Selector("fulfillWithError:"), with: NSError(...)) - compile-probed green on //modules/device:reject_probe. Replace with the imported method if the upstream header audit lands.`);
      }
      const trimmed = inner.trim();
      let msg = '"rejected"';
      const strLit = trimmed.match(/^"((?:[^"\\]|\\.)*)"/);
      if (strLit) msg = `"${strLit[1]}"`;
      else if (trimmed) msg = trimmed.split(',')[0].trim();
      return `promise.perform(Selector("fulfillWithError:"), with: NSError(domain: "plugin2valdi", code: 0, userInfo: [NSLocalizedDescriptionKey: String(describing: ${msg})]))`;
    });

    for (const ch of l) {
      if (ch === '{') inMethod.depth++;
      else if (ch === '}') inMethod.depth--;
    }
    if (inMethod.depth <= 0) {
      out.push(`${inMethod.indent}    return promise`);
      out.push(l);
      inMethod = null;
      continue;
    }
    out.push(l);
  }

  // listener conformance + event emit shims on the class. Selector verified
  // against the real generated module protocol (events module toolchain
  // build): the generated ObjC selector is setListenerWithListener:, which
  // swiftc imports as setListenerWith(_:) - the set-family importer mangling
  // (same rule as setWithOptions: -> setWith(_:), cf. params fixture); the
  // Swift name is therefore pinned to the importer's, with @objc() pinning
  // the raw selector. Listener event methods selectorize evtWithPayload: -
  // compile-verified import: evt(withPayload:).
  // contract methods with NO body in the iOS plugin (native-settings:
  // openAndroid is Android-only in the source) still owe the protocol a
  // member - honest rejection stubs, SPLICED INSIDE the class (out at this
  // point ends at the class close; appending would escape it)
  const stubs = [];
  for (const m of model.methods) {
    if (emittedMethods.has(m.name)) continue;
    const swiftType = swiftResult(m.returns);
    flags.add(`swift-method-unimplemented:${m.name}`, 'warning', `Contract method ${m.name}() has no implementation in the iOS plugin source (platform-specific method) - emitted as a rejection stub so the generated protocol is satisfied.`);
    // same signature discipline as real methods (family naming + @objc pin)
    const mp = (m.params || []).filter((p) => !(model.types.find((x) => x.kind === 'alias' && x.name === (p.type || '').trim())?.payloadType !== undefined || /^\(.*\)\s*=>/.test(p.type || '')));
    const mopts = mp.length === 1 && objectFields.has(mp[0].type) ? mp[0] : null;
    const mFamily = /^(get|set)/.test(m.name);
    if (mopts) {
      stubs.push(`    @objc(${m.name}With${pascal(mopts.name)}:)`);
      stubs.push(mFamily
        ? `    public func ${m.name}With(_ ${mopts.name}: ${iosPkg(mopts.type)}) -> SCValdiPromise<${swiftType}> {`
        : `    public func ${m.name}(${['options', 'opts'].includes(mopts.name) && (pascal(m.name) + pascal(mopts.name) === pascal(mopts.type) || pascal(m.name.replace(/^(get|is|open)/, '')) + pascal(mopts.name) === pascal(mopts.type)) ? 'with' : `with${pascal(mopts.name)}`} ${mopts.name}: ${iosPkg(mopts.type)}) -> SCValdiPromise<${swiftType}> {`);
    } else {
      stubs.push(`    public func ${m.name}() -> SCValdiPromise<${swiftType}> {`);
    }
    stubs.push(`        let promise = SCValdiResolvablePromise<${swiftType}>()`);
    stubs.push(`        promise.perform(Selector("fulfillWithError:"), with: NSError(domain: "plugin2valdi", code: 0, userInfo: [NSLocalizedDescriptionKey: "${m.name}: not implemented on iOS in the source plugin"]))`);
    stubs.push(`        return promise`);
    stubs.push(`    }`);
    stubs.push('');
  }

  // the MODULE CLASS's closing brace - the last top-level '}' line. (Not
  // the first: the dead ValdiCall shim, when present, closes earlier.)
  let closeIdx = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === '}') { closeIdx = i; break; }
  }
  if (closeIdx === -1) closeIdx = out.length;
  if (stubs.length) out.splice(closeIdx, 0, ...stubs);
  const swiftPrim = (p) => ({ string: 'String', number: 'Double', boolean: 'Bool' }[p]);
  const eventPayloadType = (ev) => {
    const p = ev.payloadType
      || (/^(string|number|boolean)$/.test(ev.payload) ? ev.payload : (objectFields.has(ev.payload) || enumNames.has(ev.payload) ? ev.payload : 'string'));
    return swiftPrim(p) || iosPkg(p);
  };
  const conf = [
    ...out.slice(0, closeIdx),
    ...(model.events.length ? [
      '',
      `    // plugin2valdi: verified listener conformance - generated selector`,
      `    // setListenerWithListener: imports as setListenerWith(_:) (set-family`,
      `    // importer mangling; compile-verified through the events module build)`,
      `    @objc(setListenerWithListener:)`,
      `    public func setListenerWith(_ listener: ${listenerProto}?) {`,
      `        ${listenerStorage} = listener`,
      `    }`,
      '',
      `    private var ${listenerStorage}: ${listenerProto}?`,

      ...model.events.flatMap((ev) => [
        '',
        `    private func emit${pascal(ev.name)}(_ data: ${eventPayloadType(ev)}) {`,
        `        ${listenerStorage}?.${camel(ev.name)}(${/Error/.test(ev.payloadType || ev.payload || '') && /Error$/.test(ev.name) ? 'with' : 'withPayload'}: data)`,
        `    }`,
      ]),
    ] : []),
    '',
    ...out.slice(closeIdx),
  ];

  // (per-func availability now runs on the FINAL text, after helper appends)

  flags.add('swift-conformance-emitted', 'resolved', `Swift conformance emitted at ios/<module>_conformance.swift (protocol ${proto}, @objc(${moduleClass}) class, SCValdiResolvablePromise bodies, per-method result mapping, sibling helper classes appended) - reference-verified end-to-end on @capacitor/device: the module registered through <module>_factory.m and answered getId() on an iOS simulator. BUILD.bazel wires ios_deps + the swift_library/modulemap/objc_library targets.`);
  if (model.events.length) {
    flags.add('swift-listener-conformance', 'resolved', `Listener conformance emitted on the class: @objc(setListenerWithListener:) func setListenerWith(_ listener: ${listenerProto}?) + private ${listenerStorage} storage + private emitX methods calling ${listenerStorage}?.<event>(withPayload:). Compile-verified through the real toolchain (events fixture module: the generated test_eventsTypes.h declares setListenerWithListener: on the module protocol and scanCompletedWithPayload:/decodeErrorWithPayload: on ${listenerProto}; swiftc imports them as setListenerWith(_:) - set-family mangling - and evt(withPayload:)). Provisional: thread-safety (the webview reference impl takes a lock around listener access; the emitted conformance does not) and single-listener semantics (see events-listener-verified).`);
  }
  // sibling helper classes append verbatim after the conformance class (reference:
  // blank separator, then the helper file's own imports + class, byte-identical)
  let finalText = conf.join('\n') + (helpers.length ? '\n\n' + helpers.map((h) => h.text).join('') : '');
  // Bundle.module appears in helper text too (appended after the transform's
  // substitution) - substitute on the final assembly
  if (/Bundle\.module/.test(finalText)) {
    finalText = finalText.replace(/Bundle\.module/g, 'Bundle.main');
    flags.add('swift-bundle-module-subst', 'warning', 'Bundle.module (SPM resource accessor) substituted with Bundle.main - bazel-built modules do not generate the SPM resource bundle. Wire the real resource bundle through the module target if plugin assets matter.');
  }
  // availability floor LAST - helper text appended above carries gated APIs
  // too (barcode scanner's ViewController: UIImage(systemName:))
  {
    const ln = finalText.split('\n');
    for (let i = 0; i < ln.length; i++) {
      if (!/^\s*(?:@objc\([^)]*\)\s*)?(?:public |private |internal |override )*(?:public |private |internal )?func \w+/.test(ln[i])) continue;
      let depth = netBraces(ln[i]);
      let j = i + 1;
      let gated = GATED_TOKENS.test(ln[i]);
      for (; j < ln.length && depth > 0; j++) {
        depth += netBraces(ln[j]);
        if (GATED_TOKENS.test(ln[j])) gated = true;
      }
      if (!gated || /@available|#available/.test(ln[i - 1] || '')) continue;
      const indent = (ln[i].match(/^\s*/) || [''])[0];
      if (/\boverride\b/.test(ln[i])) {
        // an override must stay as available as the original - wrap the body
        const bodyStart = i + 1;
        const bodyEnd = j - 1; // j sits on (one past) the closing brace
        // walk back to the actual closing brace line
        let close = bodyEnd;
        while (close > bodyStart && !/^\s*\}\s*$/.test(ln[close])) close--;
        const inner = ln.slice(bodyStart, close);
        const innerIndent = (inner[0]?.match(/^\s*/) || ['      '])[0] || '      ';
        const wrapped = [`${indent}if #available(iOS 13.0, *) {`, ...inner.map((x) => '    ' + x), `${innerIndent}} else {`, `${innerIndent}    // plugin2valdi: iOS 13+ API path elided (pre-13 unsupported)`, `${innerIndent}}`];
        ln.splice(bodyStart, inner.length, ...wrapped);
        i = bodyStart + wrapped.length;
      } else {
        ln.splice(i, 0, `${indent}@available(iOS 13.0, *)`);
        i = j + 1;
      }
    }
    finalText = ln.join('\n');
  }
  return finalText;
}
