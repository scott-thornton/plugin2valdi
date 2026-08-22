#import <Foundation/Foundation.h>
#import <React/RCTBridge.h>

@implementation AsyncStore
RCT_EXPORT_MODULE(RNCAsyncStore)

RCT_EXPORT_METHOD(getValues
                  : (nonnull NSString *)dbName keys
                  : (nonnull NSArray *)keys resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
    RNStoreEngine *db = [StoreHub.shared engineWithDbName:dbName];
    [db fetchWithKeys:keys resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(getAllKeys
                  : (nonnull NSString *)dbName resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
    NSArray *keys = @[@"a", @"b"];
    resolve(keys);
}

RCT_EXPORT_METHOD(legacy_multiGet
                  : (nonnull NSArray *)keys resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
    NSMutableArray *out = [NSMutableArray array];
    for (NSString *key in keys) {
        [out addObject:@[key, @"v"]];
    }
    resolve(out);
}

@end
