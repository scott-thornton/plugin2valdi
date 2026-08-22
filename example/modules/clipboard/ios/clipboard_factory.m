//
// clipboard_factory.m - plugin2valdi generated factory (ObjC CONFORMANCE MODE)
//
// ObjC-to-ObjC: the conformance class and this factory live in the same ios_deps
// set, so the factory returns the class DIRECTLY - no NSClassFromString lookup
// (that indirection exists only for the Swift path, where the @objc class lives
// behind a swift_library boundary).
//
//   ios/clipboard_conformance.h/.m  implements clipboardClipboardModule (SCValdiPromise bodies)
//   ios/clipboard_factory.m         this file - registration + instantiation
//

#import <Foundation/Foundation.h>
#import <valdi_core/SCValdiModuleFactoryRegistry.h>
#import <clipboardTypes/clipboardTypes.h>
#import "clipboard_conformance.h"

@interface ClipboardFactoryImpl : clipboardClipboardModuleFactory
@end

@implementation ClipboardFactoryImpl

VALDI_REGISTER_MODULE()

- (id<clipboardClipboardModule>)onLoadModule
{
    return [[ClipboardModule alloc] init];
}

@end
