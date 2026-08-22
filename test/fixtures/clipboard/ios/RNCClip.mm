#import "RNCClipboard.h"
#import <UIKit/UIKit.h>
#import <React/RCTBridge.h>
#import <React/RCTEventDispatcher.h>

@implementation RNCClipboard {
    BOOL isObserving;
}

RCT_EXPORT_MODULE();

NSString *const CLIP_TEXT_CHANGED = @"RNCClipboard_TEXT_CHANGED";

- (void)startObserving {
    isObserving = YES;
}
- (void)stopObserving {
    isObserving = NO;
}

- (void) listener:(NSNotification *) notification
{
    if (isObserving) {
        [self sendEventWithName:CLIP_TEXT_CHANGED body:nil];
    }
}

RCT_EXPORT_METHOD(setListener)
{
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(listener:) name:UIPasteboardChangedNotification object:nil];
}

RCT_EXPORT_METHOD(removeListener)
{
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

RCT_EXPORT_METHOD(setString:(NSString *)content)
{
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  clipboard.string = (content ? : @"");
}

RCT_EXPORT_METHOD(getString:(RCTPromiseResolveBlock)resolve
                  reject:(__unused RCTPromiseRejectBlock)reject)
{
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  resolve((clipboard.string ? : @""));
}

RCT_EXPORT_METHOD(hasString:(RCTPromiseResolveBlock)resolve
                  reject:(__unused RCTPromiseRejectBlock)reject)
{
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  resolve([NSNumber numberWithBool: clipboard.hasStrings]);
}

RCT_EXPORT_METHOD(addListener : (NSString *)eventName) {
  // Keep: Required for RN built in Event Emitter Calls.
}

RCT_EXPORT_METHOD(removeListeners : (double)count) {
  // Keep: Required for RN built in Event Emitter Calls.
}

#if RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeClipModuleSpecJSI>(params);
}
#endif

@end
