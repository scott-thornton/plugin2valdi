# Fleet coverage

Every row below is a public npm package. Nothing in this table depends on
private code: to regenerate a row, fetch the package and run the tool
yourself.

```bash
npm pack @capacitor/device          # any row's package
npx plugin2valdi package/ --out out
```

Columns: "iOS" and "Android" mean the module compiled in a bazel workspace
against the patched beta-0.1.1 compiler. "Runtime" means the module ran in
an app on an iOS simulator or an Android emulator.

| Plugin | iOS | Android | Runtime | Notes |
|---|---|---|---|---|
| @capacitor/device | yes | yes | yes, both | Returns the device UUID. This was the first end-to-end proof. |
| @capacitor/preferences | yes | yes | yes, both | Stores and reads a value through UserDefaults and SharedPreferences. |
| @capacitor/app | yes | yes | no | All blockers are event retention. See "Structural limits" below. |
| @capacitor/browser | yes | yes | no | The methods open a web view. The no-webview policy rejects them by design. |
| @capacitor/splash-screen | yes | yes | no | Two methods pass the call object into a helper. The flags mark the hand port. |
| @capacitor/keyboard | yes | yes | iOS module level | This plugin is Objective-C. Events and style methods stay live. Web view methods drop by policy. |
| @capacitor/status-bar | yes | yes | no | Every method needs the Capacitor bridge. The tool emits honest rejections. |
| capacitor-barcode-scanner | yes | yes | no | The scanner view controller compiles in full. The scan flow passes the call object into callbacks. The flags mark the hand port. |
| @capacitor-firebase/crashlytics | yes | yes | no | Type aliases resolve to their target fields. |
| @capacitor-firebase/messaging | yes | yes | no | See "Structural limits" below. The Firebase body rejects honestly. |
| capacitor-native-settings | yes | yes | no | One method has no iOS body in the source. The tool emits a stub. |
| @capacitor/geolocation | yes | yes | no | Vendor code rejects honestly. One method works. Wire the vendor library to finish. |
| @capacitor-community/stripe | yes | yes | no | Ten methods reject honestly. Three methods work. Port the payment bodies onto the skeletons to finish. |

## Grammar learned from the plugins

Each plugin exposed new grammar. The tool learned the grammar and
recorded it in a fixture. All lessons are visible in the FLAGS.md manifest of each module.

- Swift imports ObjC selectors under special names. The tool maps the full
  set: set methods mangle, get methods mangle or collapse, other verbs
  collapse or keep the label. See lib/conform-swift.mjs.
- ObjC reserves some words. The tool renames them, for example `id` becomes
  `id2`.
- Inline object fields become real sub-types in codegen. The tool emits
  bridges for them.
- Fields typed `any` map to NSDictionary. The bridge skips them and flags
  the site.
- Listener payloads can arrive through type aliases. The tool resolves them.
- JSObject and JSArray are dictionary and array aliases. The tool rewrites
  them.
- Some APIs need iOS 13 or later. The tool adds availability floors per
  function. Overrides get body wraps instead, because an override must stay
  as available as the method it overrides.
- The tool maps `call.unimplemented()` to an honest rejection.
- The tool treats the `.capacitor` extensions, ApplicationDelegateProxy and
  CAPLog as Capacitor host surface.

## Structural limits

These limits are design decisions, not bugs. Each one is flagged, never
silent.

1. Event retention. Capacitor can queue an event until a listener attaches.
   A Valdi promise fulfills once. Push plugins need a retention design
   before their events can be complete.
2. One listener per module. A second `setListener` call replaces the first.

## What remains

The remaining work is hand porting, not translation: the payment bodies for
stripe, the scan flow for the barcode scanner, the vendor wiring for
geolocation. Each skeleton compiles, loads and rejects honestly, so the app
builds while you port.
