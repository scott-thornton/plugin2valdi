import Foundation
import Capacitor

@objc(NestedoptPlugin)
public class NestedoptPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "test-nestedopt"
    public let jsName = "Nestedopt"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getOuter", returnType: CAPPluginReturnPromise)
    ]

    @objc func getOuter(_ call: CAPPluginCall) {
        call.resolve([
            "label": "outer",
            "inner": ["value": "inner-value"]
        ])
    }
}
