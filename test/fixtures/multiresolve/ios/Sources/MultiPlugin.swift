import Foundation
import Capacitor

@objc(MultiPlugin)
public class MultiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MultiPlugin"
    public let jsName = "Multi"
    public let pluginMethods: [CAPPluginMethod] = []

    @objc func getA(_ call: CAPPluginCall) { call.resolve(["a": "x"]) }
    @objc func getB(_ call: CAPPluginCall) { call.resolve(["b": 2]) }
    @objc func getC(_ call: CAPPluginCall) { call.resolve(["c": true]) }
}
