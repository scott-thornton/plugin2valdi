import Foundation

public class TestParamsModule {

    private var store: [String: String] = [:]

    @objc func get(_ call: ValdiCall) {
        guard let key = call.getString("key") else {
            call.reject("key required")
            return
        }
        call.resolve(makeGetResult([
            "value": store[key] as Any
        ]))
    }

    @objc func set(_ call: ValdiCall) {
        guard let key = call.getString("key") else {
            call.reject("key required")
            return
        }
        let value = call.getString("value", "")
        store[key] = value
        call.resolve()
    }

    @objc func configure(_ call: ValdiCall) {
        let group = call.getString("group")
        if let group = group {
            print("group \(group)")
        }
        call.resolve()
    }

    @objc func keys(_ call: ValdiCall) {
        call.resolve(makeGetResult([
            "keys": Array(store.keys)
        ]))
    }
}

// plugin2valdi generated shims - reference only (compiled path: conformance + support) 
// ValdiCall mirrors the PluginCall surface (resolve/reject) so translated
// bodies stay untouched. Resolve overloads are typed per the contract.
public final class ValdiCall {
    public func resolve(_ value: GetResult) { /* TODO(valdi-verify): wire to Valdi async result */ }
    public func resolve() { /* TODO(valdi-verify): wire to Valdi async result (void) */ }
    public func reject(_ message: String) { /* TODO(valdi-verify): wire to Valdi error path */ }
}
// Verified pattern (valdi_webview generated bindings, built through the
// real toolchain): events flow through a stored listener set via
// setListener. The REAL SCTestParamsListener protocol is generated from the .d.ts
// @ExportProxy - selector evtNameWithPayload: / setListenerWithListener:.
// This re-declaration exists only so this REFERENCE file compiles
// standalone; the compiled path (conformance) uses the generated one.
public protocol SCTestParamsListener: AnyObject {
}

private var testParamsListenerStorage: SCTestParamsListener?

public func setListenerWith(_ listener: SCTestParamsListener?) {
    testParamsListenerStorage = listener
}

// fallback extraction for primitive payloads whose notifyListeners data
// was not a single-key dictionary literal - flagged for hand review
public func c2vPrimitivePayload(_ data: [String: Any]) -> Any? {
    data.values.first
}

public func emitUnresolvedEvent(_ name: String, data: [String: Any]) {
    // plugin2valdi: event name was a non-constant expression - resolve by hand.
    print("plugin2valdi: unresolved event \(name) (unwired)")
}

