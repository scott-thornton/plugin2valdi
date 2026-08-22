package com.plugin2valdi.modules.async_storage

import com.snap.valdi.modules.RegisterValdiModule

//
// async_storage_factory.kt - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Instantiates the translated Java implementation. Wiring:
//   1. AsyncStorageModuleImpl (package-private, same package, declared in
//      android/AsyncStorageModule.java) implements the generated
//      AsyncStorageModule interface (Promise<T> via ResolvablePromise).
//   2. This factory + the impl + copied helpers are compiled by the
//      :async_storage_android_impl valdi_android_library and attached to the
//      module through android_deps in BUILD.bazel.
//

@RegisterValdiModule
class AsyncStorageModuleFactoryImpl : AsyncStorageModuleFactory() {
    override fun onLoadModule(): AsyncStorageModule {
        val impl = AsyncStorageModuleImpl()
        impl.onLoad()
        return impl
    }
}
