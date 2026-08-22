import Foundation

public class TestEventsModule {

    private var lastBarcode = "0123456789"
    private var lastError = "decoder timed out"

    @objc func startScanning(_ call: ValdiCall) {
        emitScanCompleted(makeScanResult(["barcode": lastBarcode, "format": "QR"]))
        call.resolve()
    }

    @objc func getLastScan(_ call: ValdiCall) {
        emitDecodeError(lastError)
        call.resolve(makeScanResult(["barcode": lastBarcode, "format": "QR"]))
    }
}

// plugin2valdi generated shims - reference only (compiled path: conformance + support) 
// ValdiCall mirrors the PluginCall surface (resolve/reject) so translated
// bodies stay untouched. Resolve overloads are typed per the contract.
public final class ValdiCall {
    public func resolve(_ value: ScanResult) { /* TODO(valdi-verify): wire to Valdi async result */ }
    public func resolve() { /* TODO(valdi-verify): wire to Valdi async result (void) */ }
    public func reject(_ message: String) { /* TODO(valdi-verify): wire to Valdi error path */ }
}
// Verified pattern (valdi_webview generated bindings, built through the
// real toolchain): events flow through a stored listener set via
// setListener. The REAL SCTestEventsListener protocol is generated from the .d.ts
// @ExportProxy - selector evtNameWithPayload: / setListenerWithListener:.
// This re-declaration exists only so this REFERENCE file compiles
// standalone; the compiled path (conformance) uses the generated one.
public protocol SCTestEventsListener: AnyObject {
    func scanCompleted(withPayload payload: SCScanResult)
    func decodeError(with payload: String)
}

private var testEventsListenerStorage: SCTestEventsListener?

public func setListenerWith(_ listener: SCTestEventsListener?) {
    testEventsListenerStorage = listener
}

// fallback extraction for primitive payloads whose notifyListeners data
// was not a single-key dictionary literal - flagged for hand review
public func c2vPrimitivePayload(_ data: [String: Any]) -> Any? {
    data.values.first
}

public func emitScanCompleted(_ data: SCScanResult) {
    testEventsListenerStorage?.scanCompleted(withPayload: data)
}

public func emitDecodeError(_ data: String) {
    testEventsListenerStorage?.decodeError(withPayload: data)
}

public func emitUnresolvedEvent(_ name: String, data: [String: Any]) {
    // plugin2valdi: event name was a non-constant expression - resolve by hand.
    print("plugin2valdi: unresolved event \(name) (unwired)")
}

