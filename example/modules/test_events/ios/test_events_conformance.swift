import Foundation
import valdi_core
import test_eventsTypes

import Foundation

@objc(TestEventsModule)
public final class TestEventsModule: NSObject, test_eventsTestEventsModule {

    private var lastBarcode = "0123456789"
    private var lastError = "decoder timed out"

    public func startScanning() -> SCValdiPromise<SCValdiUndefinedValue> {
        let promise = SCValdiResolvablePromise<SCValdiUndefinedValue>()
        emitScanCompleted(makeScanResult(["barcode": lastBarcode, "format": "QR"]))
        promise.fulfill(withSuccessValue: SCValdiUndefinedValue())
        return promise
    }

    public func getLastScan() -> SCValdiPromise<SCScanResult> {
        let promise = SCValdiResolvablePromise<SCScanResult>()
        emitDecodeError(lastError)
        promise.fulfill(withSuccessValue: makeScanResult(["barcode": lastBarcode, "format": "QR"]))
        return promise
    }

    // plugin2valdi: verified listener conformance - generated selector
    // setListenerWithListener: imports as setListenerWith(_:) (set-family
    // importer mangling; compile-verified through the events module build)
    @objc(setListenerWithListener:)
    public func setListenerWith(_ listener: SCTestEventsListener?) {
        testEventsListenerStorage = listener
    }

    private var testEventsListenerStorage: SCTestEventsListener?

    private func emitScanCompleted(_ data: SCScanResult) {
        testEventsListenerStorage?.scanCompleted(withPayload: data)
    }

    private func emitDecodeError(_ data: String) {
        testEventsListenerStorage?.decodeError(withPayload: data)
    }

}

