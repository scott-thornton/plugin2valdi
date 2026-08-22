import Foundation
import Capacitor

@objc(WatchPlugin)
public class WatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchPlugin"
    public let jsName = "Watch"
    public let pluginMethods: [CAPPluginMethod] = []

    @objc func getPosition(_ call: CAPPluginCall) {
        call.resolve(["lat": 1.0, "lng": 2.0])
    }

    @objc func watch(_ call: CAPPluginCall) {
        call.resolve(["id": "w1"])
    }

    @objc func stopWatch(_ call: CAPPluginCall) { call.resolve() }

    _objc func getSecurity(_ call: CAPPluginCall) {
        call.resolve(["state": "granted"])
    }
}
