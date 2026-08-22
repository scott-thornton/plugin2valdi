import Foundation
import Capacitor

@objc(SwiftHostPlugin)
public class SwiftHostPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SwiftHostPlugin"
    public let jsName = "SwiftHost"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMagic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise)
    ]

    private var magic: MagicBox?

    override public func load() {
        guard let bridge = bridge else { return }
        magic = MagicBox(bridge: bridge)
    }

    private func defaults() -> Bool {
        if let raw = getConfig().getBoolean("overlays", true) {
            return raw
        }
        return true
    }

    @objc func setMagic(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "default"
        magic?.apply(style)
        call.resolve()
    }

    @objc func getInfo(_ call: CAPPluginCall) {
        call.resolve([
            "overlays": defaults()
        ])
    }
}
