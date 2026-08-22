//
// test_params_factory.m - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Returns the Swift conformance implementation. Wiring:
//   ios/<module>_conformance.swift  implements test_paramsTestParamsModule (SCValdiPromise bodies)
//   ios/<module>_factory.m          this file - registration + instantiation
// both compiled via ios_deps in BUILD.bazel.
//

#import <Foundation/Foundation.h>
#import <valdi_core/SCValdiModuleFactoryRegistry.h>
#import <test_paramsTypes/test_paramsTypes.h>
@class TestParamsModule; // forward declaration - the class is linked from :test_params_conformance; dynamic dispatch resolves sends

@interface TestParamsFactoryImpl : test_paramsTestParamsModuleFactory
@end

@implementation TestParamsFactoryImpl

VALDI_REGISTER_MODULE()

- (id<test_paramsTestParamsModule>)onLoadModule
{
    return [[NSClassFromString(@"TestParamsModule") alloc] init]; // @objc(TestParamsModule) Swift class, linked from :test_params_conformance
}

@end
