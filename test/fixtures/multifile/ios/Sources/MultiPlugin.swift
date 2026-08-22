import Foundation
import Capacitor

@objc(MultiPlugin)
public class MultiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MultiPlugin"
    public let jsName = "Multi"
    public let pluginMethods: [CAPPluginMethod] = []

    @objc func ping(_ call: CAPPluginCall) { call.resolve(["value": true]) }
    @objc func run(_ call: CAPPluginCall) { call.resolve(["ok": true]) }
    @objc func initialize(_ call: CAPPluginCall) { call.resolve() }
}
