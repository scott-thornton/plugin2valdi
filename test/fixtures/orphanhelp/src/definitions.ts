// Covers the java-orphan-call-site shapes (@capacitor/keyboard,
// @capacitor/status-bar, @capacitor/splash-screen patterns):
//   - `final PluginCall call` params (sig tracking must accept the modifier)
//   - call.unimplemented() bodies (honest rejection mapping)
//   - @PermissionCallback helpers that keep the call object (dead-shim +
//     scoped java-helper-call-flow flag)
//   - unportable helper classes (drop-with-rejection, fields dropped,
//     constants literalized at use sites)
//   - same-method bridge window-JS event dedup
// The Layer-0 validator is intentionally NOT run on this fixture (same
// precedent as objcpush): drop-with-rejection stubs remove call.resolve
// sites by design, which the ritual-count check treats as loss.
export interface PingResult {
  pong: boolean;
}

export interface GreetedPayload {
  which: string;
}

export interface OrphanHelpPlugin {
  ping(): Promise<PingResult>;
  notHere(): Promise<void>;
  greet(): Promise<void>;
  addListener(
    eventName: 'greeted',
    listenerFunc: (state: GreetedPayload) => void,
  ): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
