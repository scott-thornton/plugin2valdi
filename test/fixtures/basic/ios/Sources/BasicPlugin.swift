import Foundation
import Capacitor

@objc(BasicPlugin)
public class BasicPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BasicPlugin"
    public let jsName = "Basic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise)
    ]

    private var mode = "fast"

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve([
            "enabled": true,
            "mode": mode,
            "label": "ok",
            "note": NSNull(),
            "count": 3
        ])
    }

    @objc func refresh(_ call: CAPPluginCall) {
        notifyListeners("statusChanged", data: ["mode": mode])
        call.resolve()
    }
}
