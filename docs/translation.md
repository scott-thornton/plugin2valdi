# Translation reference

What plugin2valdi maps to what: the idiom table, the reject mechanics,
the policies that drop code, and the structural limits of the result.

## The translation table

| Capacitor idiom | Valdi emission |
|---|---|
| plugin interface methods | `.d.ts` `export function` declarations |
| option and result types | annotated `export interface` declarations |
| `addListener('e', ...)` | `@ExportProxy` listener interface + `setListener` |
| `call.getString("k")` | typed `options.<field>` access |
| `call.resolve(dict)` | `promise.fulfill(withSuccessValue: make<Struct>(dict))` |
| `call.reject(msg)` | an honest rejection (see below) |
| `notifyListeners("e", data)` | listener method call through the stored listener |
| `call.unimplemented()` | a rejection with the message "unimplemented" |
| `@CapacitorPlugin`, `CAP_PLUGIN`, `pluginMethods` | dropped; the factory replaces them |
| `load()` | `onLoadModule()` |
| `JSObject` (Android) | `JSONObject` (org.json) |
| `JSObject` (iOS) | `[String: Any]` |
| `getBridge().executeOnMainThread` | `Handler(Looper.getMainLooper()).post` |
| web and PWA files | discarded |

## Rejection mechanics

A rejection is a promise that fulfills with an error. It names the method
and states what to do instead. Rejections keep the selector alive, so the
module compiles and loads while you port the body by hand.

On iOS the Swift conformance calls `fulfillWithError:` through the ObjC
runtime. The Valdi promise header declares this selector, but Swift does
not import it. See `swift-reject-objc-runtime` in
lib/conform-swift.mjs for the evidence. On Android and on ObjC the reject
path is a direct API.

## The no-webview policy

A Valdi app has no web view. Methods that exist only to control a web view
drop with an honest rejection. The rejection names the method and states
the replacement.

## The no-host policy

The same policy covers the Capacitor host surface: `bridge`,
`getConfig`, `viewController`, the `.capacitor` extensions, `CAPLog` and
`ApplicationDelegateProxy`. Plugin code that depends on these parts drops
or rejects. The flags record every drop.

## Vendor SDK imports

Vendor SDK imports (Stripe, Firebase and similar) are dependencies, not
host surface. The tool detects them and flags them. Wire the SDK into
`ios_deps` by hand, then port the method bodies.

## Structural limits

These limits are design decisions. Each is flagged, never silent.

1. Event retention. Capacitor can queue an event until a listener
   attaches. A Valdi promise fulfills once. Push plugins need a retention
   design before their events can be complete.
2. One listener per module. A second `setListener` call replaces the
   first.
