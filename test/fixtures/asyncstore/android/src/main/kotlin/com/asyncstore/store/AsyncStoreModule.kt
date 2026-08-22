package com.asyncstore.store

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = AsyncStoreModule.NAME)
class AsyncStoreModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = NAME

    override fun getValues(db: String, keys: ReadableArray, promise: Promise) {
        StoreHub.getEngine(reactContext, db).run { get(keys, promise) }
    }

    companion object {
        const val NAME = "RNCAsyncStore"
    }
}
