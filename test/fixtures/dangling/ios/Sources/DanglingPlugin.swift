import Foundation
import Capacitor

@objc(DanglingPlugin)
public class DanglingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DanglingPlugin"
    public let jsName = "Dangling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise)
    ]

    @objc func ping(_ call: CAPPluginCall) {
        call.resolve(["alive": true])
    }

    @objc func fetch(_ call: CAPPluginCall) {
        call.resolve()
    }
}
