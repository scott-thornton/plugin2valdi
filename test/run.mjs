#!/usr/bin/env node
// plugin2valdi test suite - zero dependencies.
// Each fixture is a synthetic Capacitor plugin covering one grammar shape
// (see CONTRIBUTING.md for the fixture-first rule). The suite asserts:
//   1. the CLI exits 0 (crash-proofing: never crash, always flag)
//   2. contract expectations on the emitted .d.ts
//   3. expected blocking flags appear for shapes that need hand work
//   4. the Layer 0 validator passes (no lost ritual, bodies preserved)

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleName as toModuleName } from '../lib/model.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(root, 'test', 'tmp');
fs.rmSync(tmp, { recursive: true, force: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: root });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
};

function translate(fixture) {
  const dir = path.join(root, 'test', 'fixtures', fixture);
  const r = run('node', ['bin/plugin2valdi.mjs', dir, '--out', 'test/tmp']);
  check(`${fixture}: CLI exits 0`, r.code === 0, r.out.split('\n').filter((l) => l.includes('Error')).slice(0, 2).join(' | '));
  return path.join(root, 'test', 'tmp', toModuleName(`test-${fixture}`));
}

function read(outDir, rel) {
  return fs.readFileSync(path.join(outDir, rel), 'utf8');
}

// ---- basic ----
{
  const out = translate('basic');
  const dts = read(out, 'src/test_basic.d.ts');
  check('basic: methods emitted', /export function getStatus\(\): Promise<Status>;/.test(dts) && /export function refresh\(\): Promise<void>;/.test(dts));
  check('basic: struct annotated', /@ExportModel/.test(dts) && /export interface Status \{/.test(dts));
  check('basic: nullability mapped', /note\?: string;/.test(dts));
  check('basic: union collapsed to string', /mode: string;/.test(dts) && !/export type Mode/.test(dts));
  check('basic: listener pattern', /setListener\(listener\?/.test(dts) && /statusChanged\(payload: Status\): void;/.test(dts));
  check('basic: neutral default package', dts.includes('com.plugin2valdi.modules.'));
  check('basic: no @ in comment prose', !/@(?!\*|Export)/.test(dts));
  const factory = read(out, 'ios/test_basic_factory.m');
  check('basic: factory forward-declares + NSClassFromString lookup', /@class TestBasicModule;/.test(factory) && factory.includes('return [[NSClassFromString(@"TestBasicModule") alloc] init];') && !/conformance-Swift\.h/.test(factory));
  const conf = read(out, 'ios/test_basic_conformance.swift');
  check('basic: @objc conformance header', /@objc\(TestBasicModule\)/.test(conf) && /public final class TestBasicModule: NSObject, test_basicTestBasicModule \{/.test(conf) && /import test_basicTypes/.test(conf));
  const support = read(out, 'ios/test_basic_support.swift');
  check('basic: support required-in-init + assign-after-init', /enabled: dict\["enabled"\] as\? Bool \?\? false/.test(support) && /info\.count = dict\["count"\] as\? NSNumber/.test(support) && /info\.note = dict\["note"\] as\? String/.test(support) && !/count: dict\["count"\]/.test(support));
  const v = run('node', ['bin/plugin2valdi-validate.mjs', 'test/fixtures/basic', path.relative(root, out)]);
  check('basic: validator', v.code === 0, v.out.split('\n').filter((l) => l.includes('FAIL')).join(' | '));
}

// ---- multiresolve ----
{
  const out = translate('multiresolve');
  const flags = read(out, 'FLAGS.md');
  // per-method re-wrapping happens in the conformance pass (E2E-verified on
  // device + preferences), so the swift flag is resolved, not blocking
  check('multiresolve: resolve-wrap resolved (per-method re-wrap E2E-verified)', /\[resolved\] resolve-wrap-assumption/.test(flags) && !/\[blocking\] resolve-wrap-assumption/.test(flags));
  // java side now emits a Kotlin-interface conformance (XModuleImpl,
  // per-method fulfillSuccess) - assert the emitted java itself
  const java = read(out, 'android/TestMultiresolveModule.java');
  check('multiresolve: java per-method makers', /valdiPromise\.fulfillSuccess\(makeAResult\(/.test(java) && /valdiPromise\.fulfillSuccess\(makeBResult\(/.test(java) && /valdiPromise\.fulfillSuccess\(makeCResult\(/.test(java) && /\[resolved\] java-resolve-wrap-assumption/.test(flags));
}

// ---- jparam (java conformance: interface implementation) ----
{
  const out = translate('jparam');
  const impl = read(out, 'android/TestJparamModule.java');
  const makers = impl.match(/fulfillSuccess\(make(\w+)\(/g) || [];
  check('jparam: three distinct per-method makers', new Set(makers).size === 3 && makers.length >= 3, makers.join(' '));
  check('jparam: java array converter emitted', /toStringList\(/.test(impl));
  check('jparam: implements generated interface + DefaultImpls bridge', /implements TestJparamModule /.test(impl) && /DefaultImpls\.pushToMarshaller/.test(impl) && !/ValdiCall/.test(impl));
}

// ---- javacon (java conformance full shape) ----
{
  const out = translate('javacon');
  const impl = read(out, 'android/TestJavaconModule.java');
  const b = read(out, 'BUILD.bazel');
  check('javacon: module tsconfig emitted + wired into srcs', read(out, 'tsconfig.json').includes('../_configs/base.tsconfig.json') && /\]\) \+ \["tsconfig\.json"\],/.test(b));
  check('javacon: conformance implements interface with promise signatures', /implements TestJavaconModule /.test(impl) && /Promise<.*> \w+\(/.test(impl) && /ResolvablePromise</.test(impl) && /fulfillSuccess\(/.test(impl) && /fulfillFailure\(/.test(impl));
  check('javacon: no ValdiCall shim survives', !/ValdiCall/.test(impl) && !/class ValdiCall/.test(read(out, 'android/test_javacon_support.java')));
  check('javacon: BUILD wires android_deps valdi_android_library', /android_deps = \[":test_javacon_android_impl"\]/.test(b) && /valdi_android_library\(\s*name = "test_javacon_android_impl"/.test(b));
}

// ---- watchcallback ----
{
  const out = translate('watchcallback');
  const flags = read(out, 'FLAGS.md');
  check('watchcallback: callback-aliases blocking', /\[blocking\] callback-aliases/.test(flags));
  check('watchcallback: unresolved-types blocking', /\[blocking\] unresolved-types.*PermissionState/.test(flags));
  // regression: a RELATIVE plugin dir with an external package import used to
  // loop forever in the node_modules walk (tryPackage never reached the root)
  const rel = run('node', ['bin/plugin2valdi.mjs', 'test/fixtures/watchcallback', '--out', 'test/tmp']);
  check('watchcallback: relative plugin dir terminates', rel.code === 0, rel.out.split('\n').filter((l) => l.includes('Error')).slice(0, 1).join(' | '));
}

// ---- constevents ----
{
  const out = translate('constevents');
  const dts = read(out, 'src/test_constevents.d.ts');
  const flags = read(out, 'FLAGS.md');
  const swift = read(out, 'ios/test_constevents_swift_impl.swift');
  const java = read(out, 'android/TestConsteventsModule.java');
  check('constevents: union event names split', /stateChange\(payload/.test(dts) && /pause\(payload/.test(dts) && /urlOpen\(payload/.test(dts));
  check('constevents: retain flag (swift)', /\[blocking\] retain-until-consumed/.test(flags));
  check('constevents: retain flag (java)', /\[blocking\] java-retain-until-consumed/.test(flags));
  check('constevents: constants resolved in swift', /emitStateChange\(/.test(swift) && !/(?<!func )emitUnresolvedEvent\(/.test(swift));
  check('constevents: constants resolved in java', /emitStateChange\(/.test(java) && /emitPause\(/.test(java) && !/notifyListeners/.test(java));
  const v = run('node', ['bin/plugin2valdi-validate.mjs', 'test/fixtures/constevents', path.relative(root, out)]);
  check('constevents: validator', v.code === 0, v.out.split('\n').filter((l) => l.includes('FAIL')).join(' | '));
}

// ---- kotlinanno ----
{
  const out = translate('kotlinanno');
  const v = run('node', ['bin/plugin2valdi-validate.mjs', 'test/fixtures/kotlinanno', path.relative(root, out)]);
  check('kotlinanno: validator absorbs annotation block', v.code === 0, v.out.split('\n').filter((l) => l.includes('FAIL')).join(' | '));
}

// ---- rejectcall ----
{
  const out = translate('rejectcall');
  const conf = read(out, 'ios/test_rejectcall_conformance.swift');
  const flags = read(out, 'FLAGS.md');
  // reject reaches the Swift-invisible fulfillWithError: through the ObjC
  // runtime (perform + raw selector) - compile-probed green
  const rejections = conf.match(/promise\.perform\(Selector\("fulfillWithError:"\), with: NSError\(domain: "plugin2valdi", code: 0, userInfo: \[NSLocalizedDescriptionKey: String\(describing:/g) || [];
  check('rejectcall: every call.reject becomes the ObjC-runtime reject', rejections.length === 2, `${rejections.length}/2`);
  check('rejectcall: message args carried into the NSError', /String\(describing: (?:"(?:[^"\\]|\\.)*"|\w+)\)/.test(conf));
  check('rejectcall: no unrewritten call.reject in conformance', !/call\.reject/.test(conf));
  check('rejectcall: flag documents runtime reach + upstream gap', /\[resolved\] swift-reject-objc-runtime/.test(flags) && flags.includes('NS_SWIFT_NAME') && !/\[blocking\] swift-reject-unwired/.test(flags));
  check('rejectcall: BUILD wires ios_deps + modulemap', (() => { const b = read(out, 'BUILD.bazel'); return /ios_deps = \[":test_rejectcall_conformance", ":test_rejectcall_factory"\],/.test(b) && /modulemap\(/.test(b) && /generates_header = True/.test(b); })());
}

// ---- events (verified @ExportProxy listener pattern) ----
{
  const out = translate('events');
  const dts = read(out, 'src/test_events.d.ts');
  const conf = read(out, 'ios/test_events_conformance.swift');
  const flags = read(out, 'FLAGS.md');
  // listener interface + setListener per the toolchain-verified grammar
  check('events: @ExportProxy listener interface in contract', /@ExportProxy\(\{\n \*   ios: 'SCTestEventsListener',\n \*   android: 'com\.plugin2valdi\.modules\.test_events\.TestEventsListener'\n \* \}\)/.test(dts) && /export interface TestEventsListener \{/.test(dts) && /export function setListener\(listener\?: TestEventsListener\): void;/.test(dts));
  check('events: object + primitive payload methods', /scanCompleted\(payload: ScanResult\): void;/.test(dts) && /decodeError\(payload: string\): void;/.test(dts));
  check('events: conformance carries verified selector + storage', /@objc\(setListenerWithListener:\)\n\s*public func setListenerWith\(_ listener: SCTestEventsListener\?\)/.test(conf) && /private var testEventsListenerStorage: SCTestEventsListener\?/.test(conf));
  check('events: emit shims call withPayload labels', /scanCompleted\(withPayload:/.test(conf) && /decodeError\(withPayload:/.test(conf));
  // java listener forwarding (Android runtime-proven, iOS parity)
  const javaImpl = read(out, 'android/TestEventsModule.java');
  check('events: java listener forwarding wired', /private TestEventsListener valdiListener;/.test(javaImpl) && /if \(l != null\) l\.scanCompleted\(payload\);/.test(javaImpl) && /if \(l != null\) l\.decodeError\(payload\);/.test(javaImpl));
  check('events: java listener access synchronized', /synchronized \(this\) \{ l = this\.valdiListener; \}/.test(javaImpl));
  check('events: verified flag present', /\[resolved\] events-listener-verified/.test(flags));
}

// ---- dangling (annotation closure: keyboard E2E shapes) ----
{
  const out = translate('dangling');
  const dts = read(out, 'src/test_dangling.d.ts');
  const flags = read(out, 'FLAGS.md');
  // unreachable declarations carrying DOM types are dropped silently - they
  // are not part of the contract (keyboard: 4 dangling names all lived on
  // dead @capacitor/core declarations pulled in by a type-only import)
  check('dangling: unreachable DOM-typed declaration dropped', !/DebugHooks/.test(dts) && !/\[blocking\] unresolved-types/.test(flags) && !/\[blocking\] callback-aliases/.test(flags));
  // reachable DOM refs collapse to string with a warning naming the original
  check('dangling: reachable DOM ref collapsed + warned', /init\?: string;/.test(dts) && /\[warning\] type-collapsed:FetchOptions\.init/.test(flags));
}

// ---- objcpush (ObjC-native plugin transformer) ----
{
  const out = translate('objcpush');
  const conf = read(out, 'ios/test_objcpush_conformance.m');
  const factory = read(out, 'ios/test_objcpush_factory.m');
  const b = read(out, 'BUILD.bazel');
  check('objcpush: conformance selectors match generated protocol', /- \(SCValdiPromise<SCEchoResult \*> \*\)echoWithOptions:\(SCEchoOptions \*\)options/.test(conf) && /\[\[SCEchoResult alloc\] initWithMessage:message/.test(conf));
  check('objcpush: reject is first-class fulfillWithError', /\[promise fulfillWithError:\[NSError errorWithDomain:@".*".*code:/.test(conf) && /return promise;/.test(conf));
  check('objcpush: events through locked listener', /\[\[self c2vLockedListener\] pushReceivedWithPayload:/.test(conf) && /- \(void\)setListenerWithListener:\(id<SCTestObjcpushListener> _Nullable\)listener/.test(conf));
  // no-webview policy: webview-dependent methods drop-with-rejection;
  // bridge events with no same-method notify reroute to listener emits
  const pushFlags = read(out, 'FLAGS.md');
  check('objcpush: webview-dependent method -> drop-with-rejection stub', conf.includes('@"resizeProbe: not applicable on Valdi - no webview"') && pushFlags.includes('objc-webview-dropped:resizeProbe'));
  check('objcpush: window-JS event reroutes to listener emit', /\[\[self c2vLockedListener\] windowPingedWithPayload:@"from-window"\]/.test(conf) && pushFlags.includes('objc-bridge-event-rerouted:windowPinged'));
  // coverage carried over from the retired real-plugin test: the no-webview
  // policy leaves zero blocking objc flags and host-API sites resolve
  check('objcpush: zero blocking objc flags', !/\[blocking\] objc-/.test(pushFlags));
  check('objcpush: host-API sites resolved', /\[resolved\] objc-host-api:bridge/.test(pushFlags) && /\[resolved\] objc-host-api:webView/.test(pushFlags));
  // java no-host mirror: bridge-dependent contract methods reject honestly
  const pushJava = read(out, 'android/TestObjcpushModule.java');
  check('objcpush: java no-host policy active', /\[resolved\] java-no-host-policy/.test(pushFlags) || !/\[blocking\] java-host/.test(pushFlags));
  check('objcpush: no call.* survivors in java code', !/\bcall\.\w+\(/.test(pushJava.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')));
  // ritual check scoped to CODE (the conformance comments legitimately
  // explain the mapping and mention the old idioms by name)
  const codeOnly = conf.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('objcpush: no Capacitor ritual survivors', !/CAPPluginCall|notifyListeners|call\.resolve|call\.reject|CAP_PLUGIN/.test(codeOnly));
  const factoryCode = factory.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('objcpush: direct-alloc factory + BUILD wiring', /return \[\[TestObjcpushModule alloc\] init\];/.test(factoryCode) && !/NSClassFromString/.test(factoryCode) && /ios_deps = \[":test_objcpush_conformance", ":test_objcpush_factory"\],/.test(b) && b.includes('objc_library('));
}

// ---- unions (probe-verified collapse; TS enums now upgrade) ----
{
  const out = translate('unions');
  const dts = read(out, 'src/test_unions.d.ts');
  const flags = read(out, 'FLAGS.md');
  const swiftConf = read(out, 'ios/test_unions_conformance.swift');
  const swiftSupport = read(out, 'ios/test_unions_support.swift');
  const javaImpl = read(out, 'android/TestUnionsModule.java');
  // literal unions still collapse; the TS enum Heat UPGRADES to ExportEnum
  check('unions: literal-union positions still collapsed to string', /flavor: string;/.test(dts) && /origin: string;/.test(dts) && /region\?: string;/.test(dts) && !/export type Flavor/.test(dts));
  check('unions: TS string enum upgrades to ExportEnum', /@ExportEnum\(\{\n \*   ios: 'SCHeat',\n \*   android: 'com\.plugin2valdi\.modules\.test_unions\.Heat'\n \* \}\)/.test(dts) && /export const enum Heat \{\n  LOW = 'low',\n  HIGH = 'high',\n\}/.test(dts) && /heat: Heat;/.test(dts));
  check('unions: enum-emitted flag replaces the collapse flag', /\[resolved\] enum-emitted:Heat: TS enum Heat emitted as an @ExportEnum string enum - wire values \['low', 'high'\]/.test(flags) && !/union-collapsed:Heat/.test(flags));
  // native emitters construct the enum types (SCHeat typedef / Kotlin enum)
  check('unions: swift bridge constructs SCHeat through rawValue:', /heat: SCHeat\(rawValue: dict\["heat"\] as\? String \?\? "low"\),/.test(swiftSupport));
  check('unions: java converter maps wire values through getValue()', /if \(s != null\) for \(Heat v : Heat\.values\(\)\) if \(v\.getValue\(\)\.equals\(s\)\) return v;/.test(javaImpl) && /return Heat\.LOW;/.test(javaImpl) && /toHeat\(dict\.optString\("heat"\)\)/.test(javaImpl));
  check('unions: null maps to accepted T | undefined', /note\?: string;/.test(dts));
  check('unions: param struct field collapsed', /export function setFlavor\(options: FlavorOptions\): Promise<void>;/.test(dts) && /export interface FlavorOptions \{\n  flavor: string;/.test(dts));
  check('unions: verified rejection flag keeps literal set', /\[warning\] union-collapsed:Flavor: Union Flavor \(sweet \| salty \| umami\) collapsed/.test(flags) && /\[resolved\] union-rejections-verified/.test(flags));
  // union RETURNS never leak raw union text into native emitters
  check('unions: union returns map to string in natives', /getDirection\(\) -> SCValdiPromise<NSString>/.test(swiftConf) && /Promise<String> getRawDirection\(\)/.test(javaImpl) && !/\|/.test(swiftConf.split('getRawDirection')[1]?.split('\n')[0] || ''));
}

// ---- enums (@ExportEnum fidelity path) ----
{
  const out = translate('enums');
  const dts = read(out, 'src/test_enums.d.ts');
  const flags = read(out, 'FLAGS.md');
  const swiftConf = read(out, 'ios/test_enums_conformance.swift');
  const swiftSupport = read(out, 'ios/test_enums_support.swift');
  const javaImpl = read(out, 'android/TestEnumsModule.java');
  // d.ts: both enums annotated + members synthesized from the WIRE values
  check('enums: ExportEnum annotations with ios/android names', /@ExportEnum\(\{\n \*   ios: 'SCMode',\n \*   android: 'com\.plugin2valdi\.modules\.test_enums\.Mode'\n \* \}\)/.test(dts) && /@ExportEnum\(\{\n \*   ios: 'SCStyle',\n \*   android: 'com\.plugin2valdi\.modules\.test_enums\.Style'\n \* \}\)/.test(dts));
  check('enums: members synthesized from wire values', /export const enum Mode \{\n  BODY = 'body',\n  IONIC = 'ionic',\n  NATIVE = 'native',\n\}/.test(dts) && /export const enum Style \{\n  DARK = 'DARK',\n  LIGHT = 'LIGHT',\n\}/.test(dts));
  check('enums: enum-typed fields + returns preserved in contract', /mode: Mode;/.test(dts) && /style\?: Style;/.test(dts) && /getMode\(\): Promise<Mode>;/.test(dts) && /modeDetected\(payload: Mode\): void;/.test(dts));
  check('enums: literal-union field stays collapsed', /origin: string;/.test(dts) && !/Origin/.test(dts.replace(/^\/\/.*$/gm, '')));
  check('enums: numeric-ambiguity note on name-equal values', /\[resolved\] enum-emitted:Style:.*AMBIGUITY: every value equals its \(synthesized\) member name/.test(flags) && !/AMBIGUITY/.test((flags.match(/enum-emitted:Mode:[^\n]*/) || [''])[0]));
  // Swift: typedef construction in the bridges, rawValue reads in the
  // conformance - shapes COMPILE-VERIFIED through the test_enums toolchain
  // build (//modules/test_enums:test_enums_conformance, real swiftc)
  check('enums: swift bridges construct the NS_STRING_ENUM typedef', /mode: SCMode\(rawValue: dict\["mode"\] as\? String \?\? "body"\),/.test(swiftSupport) && /info\.style = \(dict\["style"\] as\? String\)\.map \{ SCStyle_Nullable\(rawValue: \$0\) \}/.test(swiftSupport) && /public func makeMode\(_ dict: \[String: Any\]\) -> NSString \{/.test(swiftSupport));
  check('enums: swift conformance maps enum return + rawValue reads', /getMode\(\) -> SCValdiPromise<NSString>/.test(swiftConf) && /SCValdiResolvablePromise<NSString>\(\)/.test(swiftConf) && /let mode = options\.mode\.rawValue/.test(swiftConf) && /if let style = options\.style\?\.rawValue/.test(swiftConf));
  check('enums: swift listener payload typed by the typedef struct', /modeDetected\(withPayload: data\)/.test(swiftConf) && /private func emitModeDetected\(_ data: SCMode\)/.test(swiftConf) && /emitModeDetected\(SCMode\(rawValue: makeMode\(\["mode": mode\]\) as String\)\)/.test(swiftConf));
  // Java: Kotlin enum interop from Java (wire converter + Promise<Mode> signature)
  check('enums: java wire converters + null-safe variant', /private static Mode toMode\(String s\) \{/.test(javaImpl) && /for \(Mode v : Mode\.values\(\)\) if \(v\.getValue\(\)\.equals\(s\)\) return v;/.test(javaImpl) && /return Mode\.BODY;/.test(javaImpl) && /toStyleOrNull\(dict\.optString\("style", null\)\)/.test(javaImpl));
  check('enums: java conformance Promise<Mode> + typed options reads', /public Promise<Mode> getMode\(\) \{/.test(javaImpl) && /valdiPromise\.fulfillSuccess\(makeMode\(ret\)\);/.test(javaImpl) && /String mode = options\.getMode\(\) == null \? null : options\.getMode\(\)\.getValue\(\);/.test(javaImpl));
  check('enums: java enum listener forwarding', /private void emitModeDetected\(Mode payload\)/.test(javaImpl) && /l\.modeDetected\(payload\);/.test(javaImpl));
  check('enums: grammar flag documents the probe', /\[resolved\] enum-grammar-verified/.test(flags));
  const v = run('node', ['bin/plugin2valdi-validate.mjs', 'test/fixtures/enums', path.relative(root, out)]);
  check('enums: validator', v.code === 0, v.out.split('\n').filter((l) => l.includes('FAIL')).join(' | '));
}

// ---- swifthost (Swift no-host policy: status-bar shapes) ----
{
  const out = translate('swifthost');
  const conf = read(out, 'ios/test_swifthost_conformance.swift');
  const flags = read(out, 'FLAGS.md');
  // unportable helper NOT copied; its instance decl + bridge statements drop
  check('swifthost: unportable helper skipped + flagged', /\[warning\] swift-unportable-helper:MagicBox/.test(flags) && !/class MagicBox/.test(conf) && !/private var magic/.test(conf));
  // bridge-dependent contract method drops-with-rejection, FAMILY naming
  // (setMagic -> setMagicWith, importer get/set-family rule)
  check('swifthost: drop-with-rejection + family signature', /@objc\(setMagicWithOptions:\)\n\s*public func setMagicWith\(_ options: SCStyleOptions\) -> SCValdiPromise<SCValdiUndefinedValue> \{/.test(conf) && conf.includes('"setMagic: not applicable on Valdi - no Capacitor bridge"') && /\[warning\] swift-host-dropped:setMagic/.test(flags));
  // pure method survives; original body preserved as comments
  check('swifthost: pure method survives, dropped body commented', /public func getInfo\(\) -> SCValdiPromise<SCInfo> \{/.test(conf) && conf.includes('call.getString("style")'));
  check('swifthost: host statements neutralized', /\[warning\] swift-host-neutralized/.test(flags) && flags.includes('guard let bridge = bridge else { return }'));
  // no bridge surface in emitted CODE (comments + the rejection message
  // string excluded - the message names the bridge honestly)
  const codeOnly = conf.split('\n').filter((l) => !l.trim().startsWith('//') && !l.includes('not applicable on Valdi')).join('\n');
  check('swifthost: no bridge surface in emitted code', !/bridge[.?\s(=]|getConfig\(|CAPConfig|MagicBox/.test(codeOnly));
}

// ---- params (preferences E2E shapes: parameterized methods) ----
{
  const out = translate('params');
  const conf = read(out, 'ios/test_params_conformance.swift');
  const support = read(out, 'ios/test_params_support.swift');
  // importer families: bare get/set selectors import as getWith(_:)/setWith(_:)
  check('params: bare get/set pinned + importer-family names', /@objc\(getWithOptions:\)\n\s*public func getWith\(_ options: SCGetOptions\) -> SCValdiPromise<SCGetResult> \{/.test(conf) && /@objc\(setWithOptions:\)\n\s*public func setWith\(_ options: SCSetOptions\) -> SCValdiPromise<SCValdiUndefinedValue> \{/.test(conf));
  // other verbs keep the preposition split: configure(with:)
  check('params: configure(with:) preposition form', /@objc\(configureWithOptions:\)\n\s*public func configure\(with options: SCConfigureOptions\) -> SCValdiPromise<SCValdiUndefinedValue> \{/.test(conf));
  // guards on non-optional fields collapse to plain lets; the reject TODO +
  // bare return inside the dead else block disappear with them
  check('params: non-optional guard dropped to let', /let key = options\.key/.test(conf) && !/guard let key = options\.key/.test(conf));
  check('params: dead else blocks removed', !/reject path - fulfillWithError/.test(conf) && !/\n\s*return\n\s*\}/.test(conf));
  // getString default-arg form unwraps to typed access
  check('params: getString default form -> typed access', /let value = options\.value/.test(conf) && !/call\.getString/.test(conf) && !/\bcall\b/.test(conf));
  // optional fields keep their if-let, value flows from the typed property
  check('params: optional field access keeps if-let', /let group = options\.group\n\s*if let group = group \{/.test(conf));
  // arrays: string[] -> [String] with ?? [] (KeysResult.keys)
  check('params: array coercion in support bridge', /keys: dict\["keys"\] as\? \[String\] \?\? \[\]/.test(support));
}

// ---- orphanhelp (java orphan-call-site shapes: final params, call.unimplemented,
// ---- helpers taking the call object, unportable helper classes) ----
{
  const out = translate('orphanhelp');
  const impl = read(out, 'android/TestOrphanhelpModule.java');
  const support = read(out, 'android/test_orphanhelp_support.java');
  const flags = read(out, 'FLAGS.md');
  // `final PluginCall call` params are conformance-tracked now (keyboard
  // show/hide, status-bar: every method) - no silent ValdiCall survivors
  check('orphanhelp: final-param method conformed to Promise signature', /public Promise<PingResult> ping\(\) \{/.test(impl) && /fulfillSuccess\(makePingResult\(/.test(impl) && !/ValdiCall call/.test(impl.split('\n').filter((l) => !l.trim().startsWith('//') && l !== '    private void permsDone(ValdiCall call) {').join('\n')));
  // call.unimplemented() maps to an honest rejection (Capacitor rejects MIUNIMPLEMENTED)
  check('orphanhelp: call.unimplemented mapped to rejection', /fulfillFailure\(new RuntimeException\("unimplemented"\)\)/.test(impl) && /\[warning\] java-unimplemented-mapped/.test(flags));
  // methods depending on unportable helper classes drop-with-rejection
  // (Java mirror of the objc no-webview policy)
  check('orphanhelp: unportable-dependent method dropped with rejection', impl.includes('"greet: not applicable on Valdi - no Capacitor bridge"') && /\[warning\] java-bridge-dropped:greet/.test(flags));
  // helper methods still taking a call object: verbatim + scoped blocking
  // flag + dead ValdiCall shim (smaller flag surface, honest hand-port note)
  check('orphanhelp: helper call-flow flagged + shimmed', /\[blocking\] java-helper-call-flow:permsDone/.test(flags) && /private void permsDone\(ValdiCall call\) \{/.test(impl) && /class ValdiCall \{/.test(support) && /void resolve\(\) \{\}/.test(support));
  check('orphanhelp: zero blanket java-orphan-call-sites flags', !/java-orphan-call-sites/.test(flags));
  // skipped-helper constants literalized; same-method window-JS trigger deduped
  check('orphanhelp: skipped-helper constant literalized', /emitGreeted\(makeGreetedPayload\(data\)\)/.test(impl) && /"hi"/.test(impl) && !/Greeter\.GREETING_HI/.test(impl));
  check('orphanhelp: same-method bridge event deduped', !/triggerWindowJSEvent/.test(impl.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')) && /\[resolved\] java-bridge-event-deduped:onGreetingEvent/.test(flags));
}

// ---- multifile ----
{  const out = translate('multifile');
  const dts = read(out, 'src/test_multifile.d.ts');
  const flags = read(out, 'FLAGS.md');
  check('multifile: inherited methods flattened', /export function ping\(\): Promise<boolean>;/.test(dts) && /export function extra\(\): Promise<number>;/.test(dts));
  check('multifile: optional method kept', /export function optionalThing\(x: string\): Promise<void>;/.test(dts));
  check('multifile: inline return synthesized', /export function run\(\): Promise<RunResult>;/.test(dts) && /export interface RunResult \{/.test(dts));
  check('multifile: inline array synthesized + flagged', /summary\?: InitOptionsSummaryItem\[\];/.test(dts) && /\[warning\] inline-array-synthesized/.test(flags));
  check('multifile: no unresolved types', !/\[blocking\] unresolved-types/.test(flags));
  check('multifile: factory scaffolding emitted', (() => { try { return fs.readFileSync(path.join(out, 'ios', 'test_multifile_factory.m'), 'utf8').includes('VALDI_REGISTER_MODULE') && fs.readFileSync(path.join(out, 'android', 'test_multifile_factory.kt'), 'utf8').includes('@RegisterValdiModule'); } catch { return false; } })());
}

// ---- rnclip (React Native TurboModule intake: end-to-end RN translation) ----
{
  const out = translate('clipboard');
  const dts = read(out, 'src/test_clipboard.d.ts');
  const flags = read(out, 'FLAGS.md');
  // contract: Spec parsed, primitives wrapped into options, boilerplate absorbed,
  // listener emitted from the scanned event constant, Int32 gone
  check('rnclip: options wrapping + void functions kept', /export function setString\(options: SetStringOptions\): void;/.test(dts) && /export interface SetStringOptions \{/.test(dts) && dts.includes('content: string;'));
  check('rnclip: promises kept as promises', /export function getString\(\): Promise<string>;/.test(dts) && /export function hasString\(\): Promise<boolean>;/.test(dts));
  check('rnclip: RN emitter boilerplate absorbed + listener emitted', (() => { const head = dts.split('export interface TestClipboardListener')[0]; return !/addListener|removeListeners/.test(head) && !/setListener\(\): void/.test(head); })() && /export interface TestClipboardListener \{/.test(dts) && /textChanged\(payload: string\): void;/.test(dts) && /setListener\(listener\?/.test(dts));
  check('rnclip: Int32 codegen type mapped away', !/Int32/.test(dts) && !/\[blocking\]/.test(flags));
  // iOS: RCT macros -> Capacitor call dialect -> ObjC conformance
  const conf = read(out, 'ios/test_clipboard_conformance.m');
  check('rnclip: promise methods conformed', /\- \(SCValdiPromise<NSString \*> \*\)getString/.test(conf) && conf.includes('[promise fulfillWithSuccessValue:(clipboard.string ? : @"")]'));
  check('rnclip: void methods conformed without promise machinery', /\- \(void\)setStringWithOptions:\(SCSetStringOptions \*\)options/.test(conf) && !/SCValdiPromise<SCValdiUndefinedValue \*> \*\)setStringWith/.test(conf));
  check('rnclip: sendEventWithName rerouted to locked listener', /\[\[self c2vLockedListener\] textChangedWithPayload:@""\]/.test(conf) && !/sendEventWithName/.test(conf));
  check('rnclip: attach/detach preserved as hooks + new-arch block dropped', /- \(void\)c2vRnAttach/.test(conf) && /- \(void\)c2vRnDetach/.test(conf) && !/RCT_NEW_ARCH_ENABLED/.test(conf) && !/#import <React\//.test(conf));
  check('rnclip: RN lifecycle surface dropped', !/requiresMainQueueSetup|startObserving|methodQueue/.test(conf.split('\n').filter((l) => !l.trim().startsWith('/*') && !l.trim().startsWith('//')).join('\n')));
  // Android: @ReactMethod -> generated-interface conformance
  const impl = read(out, 'android/TestClipboardModule.java');
  check('rnclip: java promise signatures + option accessors', /public Promise<String> getString\(\)/.test(impl) && /public void setString\(SetStringOptions options\)/.test(impl) && /String text = options\.getContent\(\);/.test(impl));
  check('rnclip: reactContext -> appContext + listener slot absorbed', /appContext\(\)\.getSystemService/.test(impl) && !/\breactContext\b/.test(impl) && /public void setListener\(TestClipboardListener listenerSlot\)/.test(impl) && /clipboard\.addPrimaryClipChangedListener/.test(impl));
  check('rnclip: event emission rerouted to the proxy listener', /valdiListener\.textChanged\(""\)/.test(impl) && !/DeviceEventManagerModule/.test(impl) && !/com\.facebook\.react/.test(impl));
  check('rnclip: helper carried, constructor + getName dropped', /private ClipboardManager getClipboardService\(\)/.test(impl) && !/ClipModule\(ReactApplicationContext/.test(impl) && !/getName\(\)/.test(impl));
}

// ---- asyncstore (RN intake: function-property spec, tuples, vendor drops) ----
{
  const out = translate('asyncstore');
  const dts = read(out, 'src/test_asyncstore.d.ts');
  const flags = read(out, 'FLAGS.md');
  const conf = read(out, 'ios/test_asyncstore_conformance.m');
  const impl = read(out, 'android/TestAsyncstoreModuleImpl.kt');
  // function-property syntax parses; multi-scalar params wrap into options;
  // inline-object-array params and returns synthesize named Item types with
  // the nullable union mapping to an optional field
  check('asyncstore: function-property spec parsed + options wrapped', /export function getValues\(options: GetValuesOptions\): Promise<GetValuesResultItem\[\]>;/.test(dts) && /dbName: string;/.test(dts) && /keys: string\[\];/.test(dts));
  check('asyncstore: inline array items + nullable union', /export interface GetValuesResultItem \{/.test(dts) && /key: string;/.test(dts) && /value\?: string;/.test(dts) && /export interface SetValuesOptionsValuesItem \{/.test(dts));
  check('asyncstore: tuple collapsed with a flag + readonly stripped', /legacy_multiGet\(options: LegacyMultiGetOptions\): Promise<string\[\]\[\]>;/.test(dts) && /\[warning\] tuple-collapsed/.test(flags) && /export function legacy_multiRemove\(options: LegacyMultiRemoveOptions\): Promise<void>;/.test(dts));
  // vendor classes (StoreHub, RNStoreEngine) -> honest rejection; pure-NS
  // bodies translate through
  check('asyncstore: vendor-dependent body rejected', /\[warning\] rn-objc-vendor-drop:getValues/.test(flags) && /getValues: storage engine not ported/.test(conf) && !/RNStoreEngine/.test(conf));
  check('asyncstore: pure bodies survive (getAllKeys, legacy_multiGet)', conf.includes('getAllKeysWithOptions') && conf.includes('legacy_multiGetWithOptions'));
  // Kotlin source -> rejection skeleton with Kotlin array spellings; no
  // DefaultImpls delegation from Kotlin (inherited default method)
  check('asyncstore: kotlin skeleton + kotlin.collections.List', /internal class TestAsyncstoreModuleImpl : TestAsyncstoreModule/.test(impl) && impl.includes('Promise<kotlin.collections.List<GetValuesResultItem>>') && impl.includes('Promise<kotlin.collections.List<kotlin.collections.List<String>>>') && !/DefaultImpls\./.test(impl));
}

// ---- nestedopt (make* bridge closure through optional `T | undefined` fields) ----
{
  const out = translate('nestedopt');
  const support = read(out, 'ios/test_nestedopt_support.swift');
  // regression: the closure regex carried a backspace control character where
  // it wanted \b - `Inner | undefined` fields never resolved, so makeInner
  // was never emitted (external review finding)
  check('nestedopt: optional nested object bridge emitted', /public func makeInner\(/.test(support) && /public func makeOuter\(/.test(support));
  check('nestedopt: support free of `| undefined` spellings', !/undefined/.test(support));
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
