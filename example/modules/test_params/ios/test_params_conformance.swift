import Foundation
import valdi_core
import test_paramsTypes

import Foundation

@objc(TestParamsModule)
public final class TestParamsModule: NSObject, test_paramsTestParamsModule {

    private var store: [String: String] = [:]

    @objc(getWithOptions:)
    public func getWith(_ options: SCGetOptions) -> SCValdiPromise<SCGetResult> {
        let promise = SCValdiResolvablePromise<SCGetResult>()
        let key = options.key
        promise.fulfill(withSuccessValue: makeGetResult([
            "value": store[key] as Any
        ]))
        return promise
    }

    @objc(setWithOptions:)
    public func setWith(_ options: SCSetOptions) -> SCValdiPromise<SCValdiUndefinedValue> {
        let promise = SCValdiResolvablePromise<SCValdiUndefinedValue>()
        let key = options.key
        let value = options.value
        store[key] = value
        promise.fulfill(withSuccessValue: SCValdiUndefinedValue())
        return promise
    }

    @objc(configureWithOptions:)
    public func configure(with options: SCConfigureOptions) -> SCValdiPromise<SCValdiUndefinedValue> {
        let promise = SCValdiResolvablePromise<SCValdiUndefinedValue>()
        let group = options.group
        if let group = group {
            print("group \(group)")
        }
        promise.fulfill(withSuccessValue: SCValdiUndefinedValue())
        return promise
    }

    public func keys() -> SCValdiPromise<SCKeysResult> {
        let promise = SCValdiResolvablePromise<SCKeysResult>()
        promise.fulfill(withSuccessValue: makeKeysResult([
            "keys": Array(store.keys)
        ]))
        return promise
    }

}

