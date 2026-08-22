import Foundation
import Capacitor

@objc(KotlinAnnoPlugin)
public class KotlinAnnoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KotlinAnnoPlugin"
    public let jsName = "KotlinAnno"
    public let pluginMethods: [CAPPluginMethod] = []

    @objc func read(_ call: CAPPluginCall) { call.resolve(["value": "v"]) }
}
