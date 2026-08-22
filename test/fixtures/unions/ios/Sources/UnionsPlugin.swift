import Foundation
import Capacitor

@objc(UnionsPlugin)
public class UnionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UnionsPlugin"
    public let jsName = "Unions"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getTaste", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setFlavor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDirection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRawDirection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNote", returnType: CAPPluginReturnPromise)
    ]

    private var flavor = "sweet"
    private var origin = "north"

    @objc func getTaste(_ call: CAPPluginCall) {
        call.resolve([
            "flavor": flavor,
            "heat": "low",
            "origin": origin,
            "region": NSNull(),
            "note": NSNull()
        ])
    }

    @objc func setFlavor(_ call: CAPPluginCall) {
        flavor = call.getString("flavor") ?? "sweet"
        call.resolve()
    }

    @objc func getDirection(_ call: CAPPluginCall) {
        call.resolve(flavor)
    }

    @objc func getRawDirection(_ call: CAPPluginCall) {
        call.resolve(origin)
    }

    @objc func getNote(_ call: CAPPluginCall) {
        call.resolve()
    }
}
