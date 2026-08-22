// The FIRST ObjC-native fixture — establishes the single-file convention:
// CAP_PLUGIN registration macro + @implementation in one .m (the @capacitor/
// keyboard two-file split — registration .m + body .m — is also supported).
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(ObjcpushPlugin, "Objcpush",
           CAP_PLUGIN_METHOD(echo, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(ping, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(resizeProbe, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(windowPing, CAPPluginReturnPromise);
)

@interface ObjcpushPlugin ()
@property (readwrite, assign, nonatomic) NSInteger pingCount;
@end

@implementation ObjcpushPlugin

- (void)echo:(CAPPluginCall *)call
{
  NSString *message = [call getString:@"message" defaultValue:@"hello"];
  self.pingCount = self.pingCount + 1;
  NSDictionary *response = @{@"message": message, @"count": [NSNumber numberWithInteger:self.pingCount]};
  [call resolve:response];
}

- (void)ping:(CAPPluginCall *)call
{
  if (self.pingCount <= 0) {
    [call reject:@"ping unavailable before echo"];
    return;
  }
  NSDictionary *payload = @{@"token": @"fixed-token"};
  [self notifyListeners:@"pushReceived" data:payload];
  [call resolve];
}

// webview-dependent body: frame math against self.webView + a self.bridge JS
// eval — under the no-webview scope policy this MUST become a
// DROP-WITH-REJECTION stub (selector kept, immediate fulfillWithError)
- (void)resizeProbe:(CAPPluginCall *)call
{
  NSString *spec = [call getString:@"payload" defaultValue:@"{}"];
  CGRect frame = self.webView.frame;
  [self.bridge evalWithJs:[NSString stringWithFormat:@"resize(%f)", frame.size.height]];
  [call resolve];
}

// bridge window-JS event with a CONSTANT name that this method does NOT also
// notifyListeners — MUST reroute through the locked-listener emit
- (void)windowPing:(CAPPluginCall *)call
{
  [self.bridge triggerWindowJSEventWithEventName:@"windowPinged" data:@"from-window"];
  [call resolve];
}

@end
