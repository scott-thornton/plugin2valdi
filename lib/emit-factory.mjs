// Emit factory scaffolding - the registration boilerplate every Valdi module
// needs (verified pattern: valdi_webview/ios/SCValdiWebViewNativeModule.m and
// android/WebViewNativeModuleFactoryImpl.kt; generated base-class names
// confirmed against real codegen output, e.g. stripeStripeModuleFactory).
//
// These are REFERENCE files: they compile once the translated body conforms
// to the generated protocol and the module's ios_deps/android_deps are wired.

export function emitObjcFactory(moduleName, moduleClass) {
  const proto = `${moduleName}${moduleClass}Module`;
  const factory = `${moduleName}${moduleClass}ModuleFactory`;
  return `//
// ${moduleName}_factory.m - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Returns the Swift conformance implementation. Wiring:
//   ios/<module>_conformance.swift  implements ${proto} (SCValdiPromise bodies)
//   ios/<module>_factory.m          this file - registration + instantiation
// both compiled via ios_deps in BUILD.bazel.
//

#import <Foundation/Foundation.h>
#import <valdi_core/SCValdiModuleFactoryRegistry.h>
#import <${moduleName}Types/${moduleName}Types.h>
@class ${moduleClass}Module; // forward declaration - the class is linked from :${moduleName}_conformance; dynamic dispatch resolves sends

@interface ${moduleClass}FactoryImpl : ${factory}
@end

@implementation ${moduleClass}FactoryImpl

VALDI_REGISTER_MODULE()

- (id<${proto}>)onLoadModule
{
    return [[NSClassFromString(@"${moduleClass}Module") alloc] init]; // @objc(${moduleClass}Module) Swift class, linked from :${moduleName}_conformance
}

@end
`;
}

export function emitKotlinFactory(moduleName, moduleClass, androidPkg = 'com.plugin2valdi.modules') {
  return `package ${androidPkg}.${moduleName}

import com.snap.valdi.modules.RegisterValdiModule

//
// ${moduleName}_factory.kt - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Instantiates the translated Java implementation. Wiring:
//   1. ${moduleClass}ModuleImpl (package-private, same package, declared in
//      android/${moduleClass}Module.java) implements the generated
//      ${moduleClass}Module interface (Promise<T> via ResolvablePromise).
//   2. This factory + the impl + copied helpers are compiled by the
//      :${moduleName}_android_impl valdi_android_library and attached to the
//      module through android_deps in BUILD.bazel.
//

@RegisterValdiModule
class ${moduleClass}ModuleFactoryImpl : ${moduleClass}ModuleFactory() {
    override fun onLoadModule(): ${moduleClass}Module {
        val impl = ${moduleClass}ModuleImpl()
        impl.onLoad()
        return impl
    }
}
`;
}
