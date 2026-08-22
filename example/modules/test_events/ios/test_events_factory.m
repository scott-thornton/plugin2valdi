//
// test_events_factory.m - plugin2valdi generated factory (CONFORMANCE MODE)
//
// Returns the Swift conformance implementation. Wiring:
//   ios/<module>_conformance.swift  implements test_eventsTestEventsModule (SCValdiPromise bodies)
//   ios/<module>_factory.m          this file - registration + instantiation
// both compiled via ios_deps in BUILD.bazel.
//

#import <Foundation/Foundation.h>
#import <valdi_core/SCValdiModuleFactoryRegistry.h>
#import <test_eventsTypes/test_eventsTypes.h>
@class TestEventsModule; // forward declaration - the class is linked from :test_events_conformance; dynamic dispatch resolves sends

@interface TestEventsFactoryImpl : test_eventsTestEventsModuleFactory
@end

@implementation TestEventsFactoryImpl

VALDI_REGISTER_MODULE()

- (id<test_eventsTestEventsModule>)onLoadModule
{
    return [[NSClassFromString(@"TestEventsModule") alloc] init]; // @objc(TestEventsModule) Swift class, linked from :test_events_conformance
}

@end
