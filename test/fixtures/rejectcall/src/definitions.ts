// Covers: call.reject ritual sites — the Swift conformance pass must turn
// every reject into the rig's TODO comment (fulfillWithError: is not
// Swift-visible; compile-probed — see scratch2/modules/device reject_probe),
// including the multi-arg Capacitor form and a trailing-semicolon call.
export type LookupResult = {
  value: string;
  detail?: string;
};

export interface RejectcallPlugin {
  lookup(key: string): Promise<LookupResult>;
  risky(): Promise<void>;
}
