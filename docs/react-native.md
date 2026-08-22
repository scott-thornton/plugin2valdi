# React Native intake reference

How plugin2valdi detects and translates React Native TurboModules. The
Capacitor path is verified on the plugins listed in
[FLEET.md](../FLEET.md); the React Native path uses the same
architecture.

## Detection

The tool auto-detects a React Native plugin: a package whose codegen Spec
(a `src/**/Native*.ts` file that uses `TurboModuleRegistry`, located per
`codegenConfig.jsSrcsDir`) is the contract. Both Spec syntaxes parse:
method style and function-property style.

## What the intake does

- parses the Spec, maps codegen scalars (`Int32`, `Double`) to TS scalars,
  wraps primitive params into synthesized options types (the verified
  contract shape) and keeps void functions void (RN sync surface);
- absorbs the RN emitter boilerplate (`addListener`, `removeListeners`,
  the no-arg `setListener`/`removeListener` pair) into the Valdi listener
  machinery, and scans the native sources for event constants used at
  real emission sites (`RNCClipboard_TEXT_CHANGED` maps to a
  `textChanged()` listener method);
- translates `RCT_EXPORT_METHOD` bodies (iOS ObjC/ObjC++) including
  `RCTPromiseResolveBlock`/`RejectBlock` calls, `sendEventWithName`
  rerouting and the React imports. Bodies that depend on engine classes
  the module does not carry (a Swift storage engine, for example) become
  honest rejections;
- translates `@ReactMethod` Java bodies: `Promise` params become
  `ResolvablePromise` bodies, `ReactApplicationContext` becomes the Valdi
  runtime Context helper, emitter attach/detach absorb into the generated
  `setListener` slot. Kotlin sources get a compiling rejection skeleton.

## Scope, stated honestly

Verified on two real plugins, end to end on both platforms, inside the
example app:

| Package | Result |
|---|---|
| `@react-native-clipboard/clipboard` 1.16.3 | All functions work. The pasteboard roundtrip runs natively on both platforms. |
| `@react-native-async-storage/async-storage` 3.1.1 | Contract and shape compile on both platforms. The storage engine is a prebuilt vendor framework, so every method emits an honest rejection. You must port the engine by hand. Tuple params, inline-object-array types and multi-scalar params all translate. |

Not covered yet: old-architecture RN packages (no codegen Spec) and Swift
TurboModule sources.
