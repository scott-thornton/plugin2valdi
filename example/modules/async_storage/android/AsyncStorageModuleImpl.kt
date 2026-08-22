package com.plugin2valdi.modules.async_storage

// plugin2valdi Kotlin rejection-conformance skeleton - the plugin body is
// Kotlin (not machine-translated); every contract method rejects until
// the body is hand-ported onto this class. The factory instantiates
// AsyncStorageModuleImpl unchanged.
import com.snap.valdi.promise.Promise
import com.snap.valdi.promise.ResolvablePromise
import com.snap.valdi.utils.ValdiMarshaller

internal class AsyncStorageModuleImpl : AsyncStorageModule {

    fun onLoad() {}

    override fun getValues(options: GetValuesOptions): Promise<kotlin.collections.List<GetValuesResultItem>> {
        val promise = ResolvablePromise<kotlin.collections.List<GetValuesResultItem>>()
        promise.fulfillFailure(RuntimeException("getValues: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun setValues(options: SetValuesOptions): Promise<kotlin.collections.List<SetValuesResultItem>> {
        val promise = ResolvablePromise<kotlin.collections.List<SetValuesResultItem>>()
        promise.fulfillFailure(RuntimeException("setValues: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun removeValues(options: RemoveValuesOptions): Promise<Unit> {
        val promise = ResolvablePromise<Unit>()
        promise.fulfillFailure(RuntimeException("removeValues: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun getKeys(options: GetKeysOptions): Promise<kotlin.collections.List<String>> {
        val promise = ResolvablePromise<kotlin.collections.List<String>>()
        promise.fulfillFailure(RuntimeException("getKeys: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun clearStorage(options: ClearStorageOptions): Promise<Unit> {
        val promise = ResolvablePromise<Unit>()
        promise.fulfillFailure(RuntimeException("clearStorage: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun legacy_multiGet(options: LegacyMultiGetOptions): Promise<kotlin.collections.List<kotlin.collections.List<String>>> {
        val promise = ResolvablePromise<kotlin.collections.List<kotlin.collections.List<String>>>()
        promise.fulfillFailure(RuntimeException("legacy_multiGet: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun legacy_multiSet(options: LegacyMultiSetOptions): Promise<Unit> {
        val promise = ResolvablePromise<Unit>()
        promise.fulfillFailure(RuntimeException("legacy_multiSet: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun legacy_multiRemove(options: LegacyMultiRemoveOptions): Promise<Unit> {
        val promise = ResolvablePromise<Unit>()
        promise.fulfillFailure(RuntimeException("legacy_multiRemove: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun legacy_multiMerge(options: LegacyMultiMergeOptions): Promise<Unit> {
        val promise = ResolvablePromise<Unit>()
        promise.fulfillFailure(RuntimeException("legacy_multiMerge: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun legacy_getAllKeys(): Promise<kotlin.collections.List<String>> {
        val promise = ResolvablePromise<kotlin.collections.List<String>>()
        promise.fulfillFailure(RuntimeException("legacy_getAllKeys: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    override fun legacy_clear(): Promise<Unit> {
        val promise = ResolvablePromise<Unit>()
        promise.fulfillFailure(RuntimeException("legacy_clear: not implemented - Kotlin plugin body awaiting hand port (plugin2valdi skeleton)"))
        return promise
    }

    // pushToMarshaller has a body in the generated interface - a Kotlin
    // implementor inherits it (the Java-side DefaultImpls delegation does
    // not apply from Kotlin source; found by the async_storage compile).
}
