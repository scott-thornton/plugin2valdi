import Foundation
import Capacitor

public class MagicBox {
    private var bridge: CAPBridgeProtocol

    init(bridge: CAPBridgeProtocol) {
        self.bridge = bridge
    }

    public func apply(_ style: String) {
        bridge.triggerJSEvent(eventName: style, target: "window")
    }
}
