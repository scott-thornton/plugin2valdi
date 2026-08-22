import Foundation
import Capacitor

@objc(EventsPlugin)
public class EventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EventsPlugin"
    public let jsName = "Events"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLastScan", returnType: CAPPluginReturnPromise)
    ]

    private var lastBarcode = "0123456789"
    private var lastError = "decoder timed out"

    @objc func startScanning(_ call: CAPPluginCall) {
        notifyListeners("scanCompleted", data: ["barcode": lastBarcode, "format": "QR"])
        call.resolve()
    }

    @objc func getLastScan(_ call: CAPPluginCall) {
        notifyListeners("decodeError", data: ["message": lastError])
        call.resolve(["barcode": lastBarcode, "format": "QR"])
    }
}
