import Foundation
import Capacitor

@objc(JparamPlugin)
public class JparamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "JparamPlugin"
    public let jsName = "Jparam"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "count", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "describe", returnType: CAPPluginReturnPromise)
    ]

    private var items: [String] = ["a", "b", "c"]

    @objc func list(_ call: CAPPluginCall) {
        call.resolve([
            "items": items
        ])
    }

    @objc func count(_ call: CAPPluginCall) {
        call.resolve([
            "count": items.count
        ])
    }

    @objc func describe(_ call: CAPPluginCall) {
        guard let label = call.getString("label") else {
            call.reject("label required")
            return
        }
        call.resolve([
            "label": label,
            "active": items.contains(label)
        ])
    }
}
