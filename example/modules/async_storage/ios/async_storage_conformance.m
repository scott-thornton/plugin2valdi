//
// async_storage_conformance.m - plugin2valdi generated (ObjC body path)
//
// Translated from AsyncStorage.mm (plugin class AsyncStorage).
// Registration replaced by async_storage_factory.m; CAPPluginCall ritual mapped onto
// SCValdiResolvablePromise (fulfillWithSuccessValue:/fulfillWithError: - both
// first-class ObjC selectors, no Swift-importer invisibility here).

#import "async_storage_conformance.h"
#import <valdi_core/SCValdiResolvablePromise.h>
#import <valdi_core/SCValdiUndefinedValue.h>






@implementation AsyncStorageModule

- (instancetype)init
{
    self = [super init];
    return self;
}
- (SCValdiPromise<SCGetValuesResultItem *> *)getValuesWithOptions:(SCGetValuesOptions *)options
{
    SCValdiResolvablePromise<SCGetValuesResultItem *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"getValues: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCSetValuesResultItem *> *)setValuesWithOptions:(SCSetValuesOptions *)options
{
    SCValdiResolvablePromise<SCSetValuesResultItem *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"setValues: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)removeValuesWithOptions:(SCRemoveValuesOptions *)options
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"removeValues: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)clearStorageWithOptions:(SCClearStorageOptions *)options
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"clearStorage: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<NSArray<NSString *> *> *)getKeysWithOptions:(SCGetKeysOptions *)options
{
    SCValdiResolvablePromise<NSArray<NSString *> *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"getKeys: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

#pragma mark - Legacy Storage

- (SCValdiPromise<NSArray<NSArray<NSString *> *> *> *)legacy_multiGetWithOptions:(SCLegacyMultiGetOptions *)options
{
    SCValdiResolvablePromise<NSArray<NSArray<NSString *> *> *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"legacy_multiGet: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)legacy_multiSetWithOptions:(SCLegacyMultiSetOptions *)options
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"legacy_multiSet: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)legacy_multiRemoveWithOptions:(SCLegacyMultiRemoveOptions *)options
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"legacy_multiRemove: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<NSArray<NSString *> *> *)legacy_getAllKeys
{
    SCValdiResolvablePromise<NSArray<NSString *> *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"legacy_getAllKeys: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)legacy_clear
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: @"legacy_clear: storage engine not ported - see the rn-objc-vendor-drop flag"}]];
    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)legacy_multiMergeWithOptions:(SCLegacyMultiMergeOptions *)options
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    NSArray *kvPairs = options.kvPairs;
    // merge is removed
    [promise fulfillWithSuccessValue:nil];

    return promise;
}


@end

