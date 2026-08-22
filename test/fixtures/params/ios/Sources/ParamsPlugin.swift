import Foundation
import Capacitor

@objc(ParamsPlugin)
public class ParamsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ParamsPlugin"
    public let jsName = "Params"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keys", returnType: CAPPluginReturnPromise)
    ]

    private var store: [String: String] = [:]

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key required")
            return
        }
        call.resolve([
            "value": store[key] as Any
        ])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key required")
            return
        }
        let value = call.getString("value", "")
        store[key] = value
        call.resolve()
    }

    @objc func configure(_ call: CAPPluginCall) {
        let group = call.getString("group")
        if let group = group {
            print("group \(group)")
        }
        call.resolve()
    }

    @objc func keys(_ call: CAPPluginCall) {
        call.resolve([
            "keys": Array(store.keys)
        ])
    }
}
