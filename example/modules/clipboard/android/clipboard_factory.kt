package com.plugin2valdi.modules.clipboard

import com.snap.valdi.modules.RegisterValdiModule

//
// clipboard_factory.kt - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Instantiates the translated Java implementation. Wiring:
//   1. ClipboardModuleImpl (package-private, same package, declared in
//      android/ClipboardModule.java) implements the generated
//      ClipboardModule interface (Promise<T> via ResolvablePromise).
//   2. This factory + the impl + copied helpers are compiled by the
//      :clipboard_android_impl valdi_android_library and attached to the
//      module through android_deps in BUILD.bazel.
//

@RegisterValdiModule
class ClipboardModuleFactoryImpl : ClipboardModuleFactory() {
    override fun onLoadModule(): ClipboardModule {
        val impl = ClipboardModuleImpl()
        impl.onLoad()
        return impl
    }
}
