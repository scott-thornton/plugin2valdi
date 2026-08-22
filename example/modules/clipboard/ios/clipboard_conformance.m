//
// clipboard_conformance.m - plugin2valdi generated (ObjC body path)
//
// Translated from RNCClipboard.mm (plugin class RNCClipboard).
// Registration replaced by clipboard_factory.m; CAPPluginCall ritual mapped onto
// SCValdiResolvablePromise (fulfillWithSuccessValue:/fulfillWithError: - both
// first-class ObjC selectors, no Swift-importer invisibility here).

#import "clipboard_conformance.h"
#import <valdi_core/SCValdiResolvablePromise.h>
#import <valdi_core/SCValdiUndefinedValue.h>
#import <valdi_core/SCValdiMarshallable.h>


#import <MobileCoreServices/MobileCoreServices.h>
#import <MobileCoreServices/UTType.h>
#import <UIKit/UIKit.h>


@implementation ClipboardModule
{
    id<SCClipboardListener> _c2vListener; // set through setListenerWithListener: (generated protocol)
    BOOL isObserving;
}


NSString *const CLIPBOARD_TEXT_CHANGED = @"RNCClipboard_TEXT_CHANGED";

/* plugin2valdi: RN lifecycle surface requiresMainQueueSetup dropped */
-(id) init {
    if (self = [super init]) {
       isObserving = NO;
   }
   return self;
}

/* plugin2valdi: RN lifecycle surface methodQueue dropped */
/* plugin2valdi: RN lifecycle surface supportedEvents dropped */
/* plugin2valdi: RN lifecycle surface startObserving dropped */
/* plugin2valdi: RN lifecycle surface stopObserving dropped */
- (void) listener:(NSNotification *) notification
{
    if (isObserving) {
        [[self c2vLockedListener] textChangedWithPayload:@""];
    }
}

- (void)c2vRnAttach
{isObserving = YES;

    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(listener:) name:UIPasteboardChangedNotification object:nil];

}

- (void)c2vRnDetach
{isObserving = NO;

    [[NSNotificationCenter defaultCenter] removeObserver:self];

}

- (void)setStringWithOptions:(SCSetStringOptions *)options
{
    NSString *content = options.content;
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  clipboard.string = (content ? : @"");

}

- (SCValdiPromise<NSString *> *)getString
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  [promise fulfillWithSuccessValue:(clipboard.string ? : @"")];

    return promise;
}

- (void)setStringsWithOptions:(SCSetStringsOptions *)options
{
    NSArray<NSString *> *array = options.content;
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  clipboard.strings = (array ? : @[]);

}

- (SCValdiPromise<NSArray<NSString *> *> *)getStrings
{
    SCValdiResolvablePromise<NSArray<NSString *> *> *promise = [SCValdiResolvablePromise new];
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  [promise fulfillWithSuccessValue:(clipboard.strings ? : @[])];

    return promise;
}

- (SCValdiPromise<SCValdiUndefinedValue *> *)setImageWithOptions:(SCSetImageOptions *)options
{
    SCValdiResolvablePromise<SCValdiUndefinedValue *> *promise = [SCValdiResolvablePromise new];
    NSString *content = options.content;
  @try {
    UIPasteboard *pasteboard = [UIPasteboard generalPasteboard];
    NSData *imageData = [[NSData alloc]initWithBase64EncodedString:content options:NSDataBase64DecodingIgnoreUnknownCharacters];
    [pasteboard setImage:[UIImage imageWithData:imageData]];
    [promise fulfillWithSuccessValue:nil];
  }
  @catch (NSException *exception) {
    [promise fulfillWithError:[NSError errorWithDomain:@"plugin2valdi" code:0 userInfo:@{NSLocalizedDescriptionKey: exception.reason}]];
  }

    return promise;
}


- (SCValdiPromise<NSString *> *)getImagePNG
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  NSString *pngPrefix = @"data:image/png;base64,";
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  UIImage *clipboardImage = clipboard.image;
  if (!clipboardImage) {
    [promise fulfillWithSuccessValue:NULL];
  } else {
    NSString *imageDataBase64 = [UIImagePNGRepresentation(clipboardImage) base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];
    NSString *withPrefix = [pngPrefix stringByAppendingString:imageDataBase64];
    [promise fulfillWithSuccessValue:(withPrefix ? : NULL)];
  }

    return promise;
}

- (SCValdiPromise<NSString *> *)getImageJPG
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  NSString *jpgPrefix = @"data:image/jpeg;base64,";
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  UIImage *clipboardImage = clipboard.image;
  if (!clipboardImage) {
    [promise fulfillWithSuccessValue:NULL];
  } else {
    NSString *imageDataBase64 = [UIImageJPEGRepresentation(clipboardImage, 1.0) base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];
    NSString *withPrefix = [jpgPrefix stringByAppendingString:imageDataBase64];
    [promise fulfillWithSuccessValue:(withPrefix ? : NULL)];
  }

    return promise;
}

- (SCValdiPromise<NSString *> *)hasImage
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  BOOL imagePresent = YES;
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  if (@available(iOS 10, *)) {
    imagePresent = clipboard.hasImages;
  } else {
    UIImage *imageInPasteboard = clipboard.image;
    imagePresent = imageInPasteboard != nil;
  }
  [promise fulfillWithSuccessValue:[NSNumber numberWithBool: imagePresent]];

    return promise;
}

- (SCValdiPromise<NSString *> *)hasString
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  BOOL stringPresent = YES;
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  if (@available(iOS 10, *)) {
    stringPresent = clipboard.hasStrings;
  } else {
    NSString* stringInPasteboard = clipboard.string;
    stringPresent = [stringInPasteboard length] == 0;
  }

  [promise fulfillWithSuccessValue:[NSNumber numberWithBool: stringPresent]];

    return promise;
}

- (SCValdiPromise<NSString *> *)hasURL
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  BOOL urlPresent = NO;
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  if (@available(iOS 10, *)) {
    urlPresent = clipboard.hasURLs;
  }
  [promise fulfillWithSuccessValue:[NSNumber numberWithBool: urlPresent]];

    return promise;
}

- (SCValdiPromise<NSString *> *)hasNumber
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  if (@available(iOS 14, *)) {
    UIPasteboard *board = [UIPasteboard generalPasteboard];
    [board detectPatternsForPatterns:[NSSet setWithObjects:UIPasteboardDetectionPatternProbableWebURL, UIPasteboardDetectionPatternNumber, UIPasteboardDetectionPatternProbableWebSearch, nil]
                    completionHandler:^(NSSet<UIPasteboardDetectionPattern> * _Nullable set, __unused NSError * _Nullable error) {
        BOOL numberPresent = NO;
        for (NSString *type in set) {
            if ([type isEqualToString:UIPasteboardDetectionPatternNumber]) {
                numberPresent = YES;
            }
        }
        [promise fulfillWithSuccessValue:[NSNumber numberWithBool: numberPresent]];
    }];
  } else {
    [promise fulfillWithSuccessValue:[NSNumber numberWithBool: NO]];
  }

    return promise;
}

- (SCValdiPromise<NSString *> *)hasWebURL
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  if (@available(iOS 14, *)) {
    UIPasteboard *board = [UIPasteboard generalPasteboard];
    [board detectPatternsForPatterns:[NSSet setWithObjects:UIPasteboardDetectionPatternProbableWebURL, UIPasteboardDetectionPatternNumber, UIPasteboardDetectionPatternProbableWebSearch, nil]
                    completionHandler:^(NSSet<UIPasteboardDetectionPattern> * _Nullable set, __unused NSError * _Nullable error) {
        BOOL webURLPresent = NO;
        for (NSString *type in set) {
            if ([type isEqualToString:UIPasteboardDetectionPatternProbableWebURL]) {
                webURLPresent = YES;
            }
        }
        [promise fulfillWithSuccessValue:[NSNumber numberWithBool: webURLPresent]];
    }];
  } else {
    [promise fulfillWithSuccessValue:[NSNumber numberWithBool: NO]];
  }
  

    return promise;
}

- (SCValdiPromise<NSString *> *)getImage
{
    SCValdiResolvablePromise<NSString *> *promise = [SCValdiResolvablePromise new];
  UIPasteboard *clipboard = [UIPasteboard generalPasteboard];
  NSString *withPrefix;
  for (NSItemProvider *itemProvider in clipboard.itemProviders) {
    if ([itemProvider hasItemConformingToTypeIdentifier:(NSString *)kUTTypeImage]) {
      for (NSString *identifier in itemProvider.registeredTypeIdentifiers) {
        if (UTTypeConformsTo((__bridge CFStringRef)identifier, kUTTypeImage)) {
          NSString *MIMEType = (__bridge_transfer NSString *)UTTypeCopyPreferredTagWithClass((__bridge CFStringRef)identifier, kUTTagClassMIMEType);
          NSString *imageDataBase64 = [[clipboard dataForPasteboardType:identifier] base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];
          withPrefix = [NSString stringWithFormat:@"data:%@;base64,%@", MIMEType, imageDataBase64];
          break;
        }
      }
      break;
    }
  }
  [promise fulfillWithSuccessValue:(withPrefix ? : NULL)];

    return promise;
}

/* plugin2valdi: RN emitter boilerplate addListener absorbed into the Valdi listener machinery */

/* plugin2valdi: RN emitter boilerplate removeListeners absorbed into the Valdi listener machinery */




// plugin2valdi: verified listener conformance - the generated protocol declares
// - (void)setListenerWithListener:(id<SCClipboardListener>)listener (verified in the
// generated keyboardTypes.h / test_eventsTypes.h toolchain builds); thread-safe
// access follows the reference impl (valdi_webview SCValdiWebViewControllerImpl.m).
- (void)setListenerWithListener:(id<SCClipboardListener> _Nullable)listener
{
    @synchronized (self) {
        _c2vListener = listener;
    }
}

- (id<SCClipboardListener> _Nullable)c2vLockedListener
{
    @synchronized (self) {
        return _c2vListener;
    }
}
@end

