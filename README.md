# plugin2valdi

plugin2valdi converts Capacitor and React Native plugins into Valdi
polyglot modules.

The tool reads the plugin contract and the native sources. It emits a
Valdi module: the annotated contract, the native conformance for iOS and
Android, and the Bazel wiring. Anything the tool cannot translate is
flagged. The flags tell you what to do. Nothing fails silently.

Status: 13 public Capacitor plugins and 2 React Native plugins translated
and compiled on both platforms. You can regenerate each result: each row
in FLEET.md names a public npm package, and the example app runs the
whole chain on an iOS simulator and an Android emulator.

## What it does

- Parses the plugin contract with a real AST parser: Capacitor
  `definitions.ts`, or a React Native codegen Spec.
- Emits the annotated `.d.ts` contract, the Swift or ObjC conformance,
  the Java or Kotlin conformance, the module factories and the Bazel
  wiring.
- Applies the no-webview and no-host policies: code that exists only for
  the host framework drops with an honest rejection. See
  [docs/translation.md](docs/translation.md) - the table, the policies
  and the structural limits.
- Writes a review manifest (`FLAGS.md`) per module: blocking items,
  warnings, resolved items.

## Requirements

| Requirement | Version |
|---|---|
| Node.js | >= 22.18 (per `engines` in package.json) |
| Patched Valdi toolchain (to compile outputs) | beta-0.1.1 + `upstream-pr.diff`, see [docs/compiler-grammar.md](docs/compiler-grammar.md) - the upstream fix and its status |
| Example app toolchain | Xcode, Bazel 7.2.1, Android SDK/NDK, see [example/README.md](example/README.md) |

Translation alone needs Node only. The patch and the toolchain are needed
to compile what the tool emits.

## Commands

| Command | Purpose |
|---|---|
| `plugin2valdi <plugin-dir> --out <dir>` | Translate one plugin and write `FLAGS.md`. |
| `plugin2valdi build-valdi <plugin-dir> [--scratch <dir>] [--timeout <ms>]` | Translate, install into a scratch Valdi project, compile through the real toolchain. |
| `plugin2valdi survey <app-node-modules-dir> --out <dir> [--build]` | Report every plugin in an installed app. `--build` also compiles each contract. Use it to estimate the work. |
| `plugin2valdi-validate <plugin-dir> <out-module-dir>` | Prove the translation lost nothing: ritual coverage and body preservation checks. |

Options for translation: `--android-pkg` sets the Android class namespace
(default `com.plugin2valdi.modules`); `--ios-prefix` sets the iOS class
prefix (default `SC`). Use matching values. The compiler accepts one
Android package per module.

## First run

```bash
npx plugin2valdi <plugin-dir> --out out
```

The tool reads `src/definitions.ts` or `dist/esm/definitions.d.ts`, plus
native sources: `ios/**/*.{swift,m,mm}` and `android/**/*.{java,kt}`.
Output layout:

```text
<out>/<module>/
  src/<module>.d.ts        the contract, input to Valdi codegen
  ios/*_conformance.swift  the Swift conformance (or .m for ObjC plugins)
  ios/*_support.swift      typed bridges (make* functions)
  ios/*_factory.m          module factory and registration
  android/*Module.java     the Java conformance (or *Impl.kt skeleton)
  android/*_factory.kt     the Kotlin factory
  BUILD.bazel              valdi_module wiring, ios_deps, android_deps
  tsconfig.json            module tsconfig, required for JS packing
  FLAGS.md                 the review manifest: blocking, warnings, resolved
```

Before you use the output on your own plugin:

1. Translate the plugin and read `FLAGS.md`.
2. Resolve every blocking flag.
3. Run `plugin2valdi build-valdi <plugin-dir>` to compile through the
   real toolchain.
4. Compare the behavior with the original plugin. The original app
   defines the correct behavior.

## Project structure

```text
bin/        CLI entry points
lib/        the translation pipeline (see docs/README.md for the map)
test/       fixture-first suite, one synthetic plugin per shape
example/    a complete Valdi app with converted modules
docs/       reference docs + proof screenshots
FLEET.md    coverage table, one row per public plugin
```

## Verified end to end

Every claim below ran on a real toolchain.

- The `device` plugin translated, compiled, launched on an iOS simulator
  and returned a live UUID to the screen. See docs/screenshots/ios-device.png.
- The `preferences` plugin stored and read a value through UserDefaults
  and SharedPreferences. See docs/screenshots/ios-preferences.png. A second run
  used tool output only. The generated files matched the first,
  hand-verified version byte for byte. See docs/screenshots/ios-emitter-determinism.png.
- Events work on both platforms. An object payload and a primitive
  payload both moved from native code to a TypeScript listener. See
  docs/screenshots/ios-events.png and docs/screenshots/android-events.png.
- The same app built as a signed APK and ran on an Android emulator. See
  docs/screenshots/android-app.png.
- String enums become real types through `@ExportEnum`. See
  docs/screenshots/ios-enum.png and docs/screenshots/android-enum.png.
- ObjC plugins get a dedicated transformer. Kotlin plugin sources get a
  compiling rejection skeleton.
- The full example app (two converted modules plus a React Native module,
  promise roundtrip, native event and pasteboard roundtrip on screen)
  built and ran on both an iOS simulator and an Android emulator. See
  [example/](example/README.md).
- React Native TurboModules also translate. See
  [docs/react-native.md](docs/react-native.md) - the intake, its scope
  and the two verified packages.

## Documentation

- [docs/README.md](docs/README.md) - index of the reference docs and the
  source map.
- [FLEET.md](FLEET.md) - per-plugin coverage, all rows regenerable.
- [example/README.md](example/README.md) - the runnable proof app.
- [CONTRIBUTING.md](CONTRIBUTING.md) - how to change this tool, fixture
  first.
