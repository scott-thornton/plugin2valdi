//
// async_storage_factory.m - plugin2valdi generated factory (ObjC CONFORMANCE MODE)
//
// ObjC-to-ObjC: the conformance class and this factory live in the same ios_deps
// set, so the factory returns the class DIRECTLY - no NSClassFromString lookup
// (that indirection exists only for the Swift path, where the @objc class lives
// behind a swift_library boundary).
//
//   ios/async_storage_conformance.h/.m  implements async_storageAsyncStorageModule (SCValdiPromise bodies)
//   ios/async_storage_factory.m         this file - registration + instantiation
//

#import <Foundation/Foundation.h>
#import <valdi_core/SCValdiModuleFactoryRegistry.h>
#import <async_storageTypes/async_storageTypes.h>
#import "async_storage_conformance.h"

@interface AsyncStorageFactoryImpl : async_storageAsyncStorageModuleFactory
@end

@implementation AsyncStorageFactoryImpl

VALDI_REGISTER_MODULE()

- (id<async_storageAsyncStorageModule>)onLoadModule
{
    return [[AsyncStorageModule alloc] init];
}

@end
