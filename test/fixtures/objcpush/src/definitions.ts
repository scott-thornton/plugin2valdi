// Covers: the ObjC-native plugin path (ios/Sources/ObjcpushPlugin/ObjcpushPlugin.m,
// no Swift). This fixture doubles as the ObjC toolchain-validation module: it is
// translated into a <module>_conformance.{h,m} pair implementing the generated
// protocol and compiled through the real Valdi toolchain (see
// lib/transform-objc.mjs). Shapes exercised:
//   - an options-param promise method (echo: typed getString + dictionary resolve)
//   - a no-param promise method with a reject site (ping)
//   - one event with an object payload (notifyListeners + dict local)
//   - a webview-dependent method (resizeProbe touches self.webView + self.bridge)
//     -> DROP-WITH-REJECTION stub under the no-webview scope policy
//   - a constant-name bridge window-JS event (windowPing fires
//     triggerWindowJSEventWithEventName without a matching notifyListeners)
//     -> reroute through the locked-listener emit
export interface EchoOptions {
  message: string;
}

export interface EchoResult {
  message: string;
  count: number;
}

export interface PushPayload {
  token: string;
}

export interface ResizeProbeOptions {
  payload: string;
}

export interface ObjcpushPlugin {
  echo(options: EchoOptions): Promise<EchoResult>;
  ping(): Promise<void>;
  resizeProbe(options: ResizeProbeOptions): Promise<void>;
  windowPing(): Promise<void>;
  addListener(
    eventName: 'pushReceived',
    listenerFunc: (payload: PushPayload) => void,
  ): Promise<unknown>;
  addListener(
    eventName: 'windowPinged',
    listenerFunc: (payload: string) => void,
  ): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
