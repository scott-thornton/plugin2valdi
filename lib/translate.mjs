// The translate pipeline, shared by `plugin2valdi <dir>` and
// `plugin2valdi build-valdi <dir>`.

import fs from 'fs';
import path from 'path';
import { Flags, moduleName as toModuleName, pascal } from './model.mjs';
import { parseContract, findDefinitionsFile } from './parse-contract.mjs';
import { emitDts } from './emit-dts.mjs';
import { transformSwift } from './transform-swift.mjs';
import { transformJava, findNativeFiles, emitKotlinRejectionConformance } from './transform-java.mjs';
import { emitBazel } from './emit-bazel.mjs';
import { emitObjcFactory, emitKotlinFactory } from './emit-factory.mjs';
import { conformSwift } from './conform-swift.mjs';
import { transformObjc, emitObjcBuildAddendum } from './transform-objc.mjs';
import { findRnSpec, normalizeRnModel, scanRnEvents } from './rn.mjs';
import { transformRnJava } from './rn-java.mjs';

const pickPluginSource = (files, marker) => {
  for (const f of files) {
    try { if (fs.readFileSync(f, 'utf8').includes(marker)) return f; } catch {}
  }
  return files[0] || null;
};

export function translatePlugin(pluginDir, outRoot, opts = {}, log = () => {}) {
  const flags = new Flags();

  // 1. contract - crash here still yields a useful manifest
  let model = { types: [], methods: [], events: [] };
  let notAPlugin = false;
  let isRn = false;
  try {
    let defsPath = findDefinitionsFile(pluginDir);
    const rnSpecPath = findRnSpec(pluginDir, flags);
    if (rnSpecPath) {
      // a TurboModule spec outranks the weak index.ts fallback (an RN
      // package always ships src/index.ts, but it is JS wrapper code)
      defsPath = null;
    }
    if (!defsPath && rnSpecPath) {
      // React Native TurboModule: the codegen Spec is the contract
      isRn = true;
      flags.add('rn-spec-found', 'resolved', `React Native TurboModule spec detected (${path.relative(pluginDir, rnSpecPath)}) - parsed with the RN intake (codegen scalars mapped, primitive params wrapped into synthesized options types, emitter boilerplate absorbed into the listener machinery).`);
      model = parseContract(rnSpecPath, flags);
    } else if (!defsPath) {
      let natives = { swift: [], objc: [], java: [], kotlin: [] };
      try { natives = findNativeFiles(pluginDir); } catch {}
      const hasNative = natives.swift.length + natives.objc.length + natives.java.length + natives.kotlin.length > 0;
      if (!hasNative) {
        // a web/Vue component library can get swept up by the
        // survey - no contract, no native sources. Verdict, not an error.
        flags.add('not-a-plugin', 'resolved', 'No Capacitor contract (definitions) and no native plugin sources found - this package is not a Capacitor plugin (e.g. a web/Vue component library). Nothing to translate.');
        notAPlugin = true;
      } else {
        throw new Error('No definitions.ts / definitions.d.ts found in plugin');
      }
    } else {
      model = parseContract(defsPath, flags);
    }
  } catch (err) {
    flags.add('parse-failed', 'blocking', `Contract parsing failed: ${err.message}. No .d.ts could be generated - file an issue with the definitions file.`);
  }

  let pkgName = null;
  try { pkgName = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')).name; } catch {}
  const moduleName = toModuleName(pkgName, model.interfaceName);
  const moduleClass = pascal(moduleName);

  const outDir = path.join(outRoot, moduleName);
  for (const sub of ['src', 'ios', 'android']) fs.mkdirSync(path.join(outDir, sub), { recursive: true });
  const write = (rel, content) => {
    fs.writeFileSync(path.join(outDir, rel), content);
    log(`  wrote ${path.join(path.basename(outRoot), moduleName, rel)}`);
  };

  log(`plugin2valdi: translating ${pkgName || pluginDir} -> module "${moduleName}"`);

  if (notAPlugin) {
    write('FLAGS.md', flags.render());
    return { moduleName, moduleClass, outDir, flags, model };
  }

  // 2. contract emission (the RN model normalizes BEFORE emission: option
  // wrapping, codegen scalar mapping, event boilerplate absorption and the
  // native event scan all shape the .d.ts)
  let natives = { swift: [], objc: [], java: [], kotlin: [] };
  try { natives = findNativeFiles(pluginDir); } catch {}
  if (isRn) {
    normalizeRnModel(model, flags);
    if (!model.events.length) model.events = scanRnEvents(natives, moduleName, flags);
    model.dialect = 'rn';
  }
  try {
    write(path.join('src', `${moduleName}.d.ts`), emitDts(model, moduleName, flags, { androidPkg: opts.androidPkg, iosPrefix: opts.iosPrefix }));
  } catch (err) {
    flags.add('dts-emit-failed', 'blocking', `.d.ts emission failed: ${err.message}`);
    write(path.join('src', `${moduleName}.d.ts`), `/* plugin2valdi: emission failed - ${err.message} */\n`);
  }

  // 3. natives - each platform degrades independently
  const swiftFile = isRn ? null : pickPluginSource(natives.swift, 'CAPBridgedPlugin');
  const javaFile = isRn
    ? pickPluginSource([...natives.java, ...natives.kotlin], '@ReactModule') || pickPluginSource([...natives.java, ...natives.kotlin], 'ReactMethod') || natives.java[0] || natives.kotlin[0] || null
    : pickPluginSource([...natives.java, ...natives.kotlin], '@CapacitorPlugin') || natives.java[0] || natives.kotlin[0] || null;
  // RN iOS implementations are ObjC/ObjC++ (RCT_EXPORT_METHOD) or Swift
  // (TurboModule) - the first pass covers the ObjC dialect
  const objcFile = isRn
    ? natives.objc.find((f) => { try { return fs.readFileSync(f, 'utf8').includes('RCT_EXPORT_METHOD'); } catch { return false; } }) || null
    : (natives.objc[0] || null);
  let objcBuildAddendum = null; // set by the objc branch: BUILD ios_deps splice + targets

  if (swiftFile) {
    try {
      const { impl, implFile, support, helpers, hostPolicy } = transformSwift(swiftFile, model, `${moduleClass}Module`, flags, opts.iosPrefix, moduleName);
      write(path.join('ios', `${moduleName}_swift_impl.swift`), implFile);
      write(path.join('ios', `${moduleName}_support.swift`), support);
      try {
        write(path.join('ios', `${moduleName}_conformance.swift`), conformSwift(impl, model, moduleName, `${moduleClass}Module`, flags, helpers, opts.iosPrefix, hostPolicy));
      } catch (err) {
        flags.add('conformance-emit-failed', 'blocking', `Swift conformance emission failed: ${err.message}`);
      }
    } catch (err) {
      flags.add('swift-transform-failed', 'blocking', `Swift translation failed: ${err.message}. iOS body not translated.`);
    }
  } else if (objcFile) {
    // ObjC-native plugin (e.g. at-capacitor/keyboard): the .m body is
    // translated into an ObjC class conforming to the GENERATED protocol -
    // architecturally simpler than the Swift path (no NSClassFromString, no
    // importer mangling: ObjC speaks to the ObjC protocol directly)
    try {
      const objc = transformObjc([objcFile], model, `${moduleClass}Module`, flags, opts.iosPrefix, moduleName);
      if (objc) {
        write(path.join('ios', `${moduleName}_conformance.h`), objc.header);
        write(path.join('ios', `${moduleName}_conformance.m`), objc.impl);
        write(path.join('ios', `${moduleName}_factory.m`), objc.factory);
        objcBuildAddendum = emitObjcBuildAddendum(moduleName, objc.impl, flags);
      }
    } catch (err) {
      flags.add('objc-transform-failed', 'blocking', `Obj-C translation failed: ${err.message}. iOS body not translated.`);
    }
  }

  if (javaFile) {
    try {
      if (isRn && !javaFile.endsWith('.kt')) {
        const rn = transformRnJava(javaFile, model, `${moduleClass}Module`, flags);
        write(path.join('android', `${moduleClass}Module.java`), rn.impl);
      } else if (javaFile.endsWith('.kt')) {
        // Kotlin plugin body: rejection-conformance skeleton (compiles + loads;
        // real body is the hand port)
        write(path.join('android', `${moduleClass}ModuleImpl.kt`),
          emitKotlinRejectionConformance(model, moduleClass, moduleName, flags, opts.androidPkg));
      } else {
        const { impl, support } = transformJava(javaFile, model, `${moduleClass}Module`, flags);
        write(path.join('android', `${moduleClass}Module.java`), impl);
        write(path.join('android', `${moduleName}_support.java`), support);
      }
    } catch (err) {
      flags.add('java-transform-failed', 'blocking', `Java/Kotlin translation failed: ${err.message}. Android body not translated.`);
    }
  }

  // 4. build + manifest + factory scaffolding
  try {
    let buildText = emitBazel(model, moduleName, moduleClass, !!swiftFile, !!javaFile, opts.androidPkg);
    if (objcBuildAddendum) {
      // ObjC conformance targets: plain objc_library pair, with ios_deps spliced
      // INSIDE the valdi_module() call (emit-bazel's hasSwift slot carries the
      // Swift swift_library/modulemap machinery, which does not apply here)
      buildText = buildText.replace('    visibility = ', `${objcBuildAddendum.iosDeps}\n    visibility = `);
      buildText += '\n' + objcBuildAddendum.targets;
    }
    write('BUILD.bazel', buildText);
    // Module tsconfig - the compiler resolves the extends path against the
    // merged modules root, where the Valdi repo provides modules/_configs
    write('tsconfig.json', '{\n    "extends": "../_configs/base.tsconfig.json"\n}\n');
  } catch (err) {
    flags.add('bazel-emit-failed', 'blocking', `BUILD.bazel emission failed: ${err.message}`);
  }
  try {
    if (!objcBuildAddendum) {
      // Swift path (or objc transform failed): scaffolding factory via
      // NSClassFromString - the Swift @objc class lives behind swift_library
      write(path.join('ios', `${moduleName}_factory.m`), emitObjcFactory(moduleName, moduleClass));
    }
    // the objc branch wrote its direct-alloc factory in section 3
    write(path.join('android', `${moduleName}_factory.kt`), emitKotlinFactory(moduleName, moduleClass, opts.androidPkg));
    flags.add('factory-emitted', 'resolved', objcBuildAddendum
      ? `ios/${moduleName}_factory.m emitted by the ObjC transform (direct [[${moduleClass}Module alloc] init] - ObjC-to-ObjC, no NSClassFromString) and wired through ios_deps alongside :${moduleName}_conformance; android/${moduleName}_factory.kt is scaffolding (TODO-stubbed onLoadModule - wire the translated Java implementation through android_deps).`
      : `Factory scaffolding emitted (ios/${moduleName}_factory.m, android/${moduleName}_factory.kt) - generated base-class naming follows observed codegen (${moduleName}${moduleClass}ModuleFactory). Conform the translated body + wire ios_deps/android_deps to activate.`);
  } catch (err) {
    flags.add('factory-emit-failed', 'warning', `Factory scaffolding emission failed: ${err.message}`);
  }
  write('FLAGS.md', flags.render());

  return { moduleName, moduleClass, outDir, flags, model };
}
