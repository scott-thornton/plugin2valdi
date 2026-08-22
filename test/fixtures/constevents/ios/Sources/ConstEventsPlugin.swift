import Foundation
import Capacitor

@objc(ConstEventsPlugin)
public class ConstEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ConstEventsPlugin"
    public let jsName = "ConstEvents"
    public let pluginMethods: [CAPPluginMethod] = []

    private let stateChangeEvent = "stateChange"
    private let urlOpenEvent = "urlOpen"

    @objc func exit(_ call: CAPPluginCall) {
        notifyListeners(stateChangeEvent, data: ["active": false], retainUntilConsumed: true)
        notifyListeners(urlOpenEvent, data: ["url": "https://example.com"], retainUntilConsumed: true)
        call.resolve()
    }
}
