package com.plugin2valdi.modules.test_params

import com.snap.valdi.modules.RegisterValdiModule

//
// test_params_factory.kt - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Instantiates the translated Java implementation. Wiring:
//   1. TestParamsModuleImpl (package-private, same package, declared in
//      android/TestParamsModule.java) implements the generated
//      TestParamsModule interface (Promise<T> via ResolvablePromise).
//   2. This factory + the impl + copied helpers are compiled by the
//      :test_params_android_impl valdi_android_library and attached to the
//      module through android_deps in BUILD.bazel.
//

@RegisterValdiModule
class TestParamsModuleFactoryImpl : TestParamsModuleFactory() {
    override fun onLoadModule(): TestParamsModule {
        val impl = TestParamsModuleImpl()
        impl.onLoad()
        return impl
    }
}
