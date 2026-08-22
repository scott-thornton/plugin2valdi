import Foundation
import Capacitor

@objc(RejectcallPlugin)
public class RejectcallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RejectcallPlugin"
    public let jsName = "Rejectcall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lookup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "risky", returnType: CAPPluginReturnPromise)
    ]

    @objc func lookup(_ call: CAPPluginCall) {
        if let cached = cacheHit() {
            call.resolve([
                "value": cached
            ])
        } else {
            call.reject("not found")
        }
    }

    @objc func risky(_ call: CAPPluginCall) {
        call.reject("boom", "E_BOOM", nil);
    }

    private func cacheHit() -> String? {
        return nil
    }
}
