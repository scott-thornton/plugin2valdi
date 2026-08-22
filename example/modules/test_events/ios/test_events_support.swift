import Foundation
import valdi_core
import test_eventsTypes

// plugin2valdi generated support - typed bridges (test_events module)

public func makeScanResult(_ dict: [String: Any]) -> SCScanResult {
    return SCScanResult(barcode: dict["barcode"] as? String ?? "", format: dict["format"] as? String ?? "")
}
