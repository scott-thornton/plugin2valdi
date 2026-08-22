// Covers: annotation closure against DOM-ish globals. (a) an exported type
// that is UNREACHABLE from the plugin surface and references DOM globals
// (Console, RequestInit, PropertyDescriptor) must be dropped silently as a
// dead declaration — no unresolved-types error, nothing emitted; (b) a
// REACHABLE options struct with a DOM global in an optional field must
// collapse to string with a type-collapsed warning naming the original type
// (a dangling reference would make Valdi codegen emit empty output
// silently); (c) ordinary methods/events must be unaffected.

// (a) dead declaration — exported, but no plugin method ever touches it
export interface DebugHooks {
  console: Console;
  fetchInit: RequestInit;
  descriptor: PropertyDescriptor;
}

// (b) reachable via fetch(options) — `init?` must collapse + warn
export interface FetchOptions {
  url: string;
  init?: RequestInit;
}

export interface PingResult {
  alive: boolean;
}

export interface DanglingPlugin {
  ping(): Promise<PingResult>;
  fetch(options: FetchOptions): Promise<void>;
  addListener(
    eventName: 'fetched',
    listenerFunc: (info: PingResult) => void,
  ): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
