import Foundation
import Capacitor

@objc(OrphanHelpPlugin)
public class OrphanHelpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OrphanHelpPlugin"
    public let jsName = "OrphanHelp"
    public let pluginMethods: [CAPPluginMethod] = []

    @objc func ping(_ call: CAPPluginCall) {
        let ret = JSObject()
        ret["pong"] = true
        call.resolve(ret)
    }

    @objc func notHere(_ call: CAPPluginCall) {
        call.unimplemented()
    }

    @objc func greet(_ call: CAPPluginCall) {
        call.resolve()
    }
}
