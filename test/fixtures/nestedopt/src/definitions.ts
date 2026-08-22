// Covers: nested object discovered through an OPTIONAL field typed
// `Inner | undefined` - the make* bridge closure must strip the
// `| undefined` suffix or makeInner is never emitted (control-char
// regression in the closure regex, found in external review).
export interface Inner {
  value: string;
}

export interface Outer {
  label: string;
  inner?: Inner | undefined;
}

export interface NestedoptPlugin {
  getOuter(): Promise<Outer>;
}
