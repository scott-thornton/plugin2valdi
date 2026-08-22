package com.plugin2valdi.modules.test_events

import com.snap.valdi.modules.RegisterValdiModule

//
// test_events_factory.kt - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Instantiates the translated Java implementation. Wiring:
//   1. TestEventsModuleImpl (package-private, same package, declared in
//      android/TestEventsModule.java) implements the generated
//      TestEventsModule interface (Promise<T> via ResolvablePromise).
//   2. This factory + the impl + copied helpers are compiled by the
//      :test_events_android_impl valdi_android_library and attached to the
//      module through android_deps in BUILD.bazel.
//

@RegisterValdiModule
class TestEventsModuleFactoryImpl : TestEventsModuleFactory() {
    override fun onLoadModule(): TestEventsModule {
        val impl = TestEventsModuleImpl()
        impl.onLoad()
        return impl
    }
}
