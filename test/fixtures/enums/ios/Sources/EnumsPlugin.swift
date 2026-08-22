import Foundation
import Capacitor

@objc(EnumsPlugin)
public class EnumsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EnumsPlugin"
    public let jsName = "Enums"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "echoMode", returnType: CAPPluginReturnPromise)
    ]

    private var currentMode = "native"

    @objc func configure(_ call: CAPPluginCall) {
        let mode = call.getString("mode")
        currentMode = mode
        if let style = call.getString("style") {
            print("plugin2valdi fixture: style", style)
        }
        notifyListeners("modeDetected", data: ["mode": mode])
        call.resolve()
    }

    @objc func getMode(_ call: CAPPluginCall) {
        call.resolve(["value": currentMode])
    }

    @objc func echoMode(_ call: CAPPluginCall) {
        let mode = call.getString("mode")
        var style: String? = nil
        if let s = call.getString("style") { style = s }
        var ret: [String: Any] = ["mode": mode, "origin": "north"]
        if let style = style { ret["style"] = style }
        call.resolve(ret)
    }
}
