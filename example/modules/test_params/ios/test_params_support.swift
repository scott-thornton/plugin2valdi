import Foundation
import valdi_core
import test_paramsTypes

// plugin2valdi generated support - typed bridges (test_params module)

public func makeGetResult(_ dict: [String: Any]) -> SCGetResult {
    let info = SCGetResult()
    info.value = dict["value"] as? String
    return info
}

public func makeKeysResult(_ dict: [String: Any]) -> SCKeysResult {
    return SCKeysResult(keys: dict["keys"] as? [String] ?? [])
}
