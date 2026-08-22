# Example app

This is a minimal Valdi application that uses two modules converted by
plugin2valdi, plus one React Native module through the RN intake. It proves
the full chain: translate, compile, launch, call native code from
TypeScript, receive events from native code.

Verified on both platforms:

- iOS: built, installed and launched on an iPhone 14 simulator
- Android: built, installed and launched on a Pixel 7 Pro emulator

The screen shows:

- `plugin2valdi example`, the title
- `Modules converted by plugin2valdi, running natively`
- `promise get(): roundtrip-ok`, the params module stored and returned
  a value through native code
- `event: barcode 0123456789 (QR)`, the events module delivered an object
  payload from native to a TypeScript listener
- `rn clipboard: hello from the RN module`, the React Native clipboard
  plugin wrote to the system pasteboard and read it back
- `async storage (engine not ported)`, the React Native AsyncStorage
  plugin loaded and its honest rejection crossed the bridge (the
  storage engine is a prebuilt vendor framework - the hand port)

The clipboard module was translated from the real
`@react-native-clipboard/clipboard` package (version 1.16.3), and the
async storage module from `@react-native-async-storage/async-storage`
(version 3.1.1):

```bash
npx plugin2valdi <clipboard-checkout> --out example/modules
npx plugin2valdi <async-storage-checkout> --out example/modules
```

## Prerequisites

- Xcode (with an iOS Simulator runtime available)
- Bazel 7.2.1 (install via bazelisk: `brew install bazelisk`)
- Android SDK and NDK (set `ANDROID_HOME` and `ANDROID_NDK_HOME` in your
  shell)
- Node.js 18 or later

## One-time setup

The Valdi compiler needs one fix until PR Snapchat/Valdi#150 merges.
Without it, generated type headers import themselves and Swift cannot
compile module conformance. The fix is a 119-line patch.

1. Clone Valdi next to this example:

```bash
cd example/
git clone https://github.com/Snapchat/Valdi.git valdi
```

2. Apply the patch:

```bash
cd valdi
git apply ../upstream-pr.diff
```

3. Build the patched compiler:

```bash
cd compiler/compiler/Compiler
swift build -c release
mkdir -p ../out/macos
cp .build/release/valdi_compiler ../out/macos/
```

## Build and run on iOS

```bash
cd example/
bazel build //:example_app_ios --@valdi//bzl/valdi:use_local_compiler=true
```

The app bundle is at
`bazel-bin/example_app_ios_archive-root/Payload/plugin2valdi example.app`.
Install it on a simulator:

```bash
xcrun simctl boot "iPhone 14"  # or any available device
APP="bazel-bin/example_app_ios_archive-root/Payload/plugin2valdi example.app"
xcrun simctl install booted "$APP"
xcrun simctl launch booted com.example.plugin2valdi
```

## Build and run on Android

Android does NOT need the patched compiler - CI builds the full APK on
the stock prebuilt one (the patch fixes Swift-facing merged headers
only). With the local checkout the flag is harmless to keep:

```bash
cd example/
export ANDROID_HOME=$HOME/Library/Android/sdk   # adjust to your SDK path
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/29.0.14206865
bazel build //:example_app_android
```

The APK is at `bazel-bin/example_app_android.apk`. The android package
name is derived from the target name: `com.snap.valdi.example_app`.

```bash
$ANDROID_HOME/platform-tools/adb install -r bazel-bin/example_app_android.apk
$ANDROID_HOME/platform-tools/adb shell monkey -p com.snap.valdi.example_app \
  -c android.intent.category.LAUNCHER 1
```

## Module layout notes

Two details to verify when you add modules by hand:

- Each module directory needs a `tsconfig.json` containing
  `{"extends": "../_configs/base.tsconfig.json"}`, and the module's
  `BUILD.bazel` must list it in `srcs` (as `glob([...]) + ["tsconfig.json"]`).
  Without it the Valdi compiler emits only declarations and packs no
  compiled JS into the `.valdimodule`; the app then fails at runtime with
  `No item named '<module>/src/*.js' in module '...'`. plugin2valdi emits
  both files for you.
- The app's `root_component_path` is `<Symbol>@<module>/<path under src>`,
  for example `App@example/src/App`.

## Convert your own plugin

```bash
cd ..  # back to the plugin2valdi checkout
npx plugin2valdi <path-to-plugin> --out example/modules
```

Then add the module to `example/BUILD.bazel` deps and to
`example/modules/example/BUILD.bazel` deps, import its functions in
`App.tsx`, and rebuild.
