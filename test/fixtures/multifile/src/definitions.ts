// Covers the Stripe-shaped grammar: multi-file contracts (export * chains),
// interface extends, intersection aliases (NOT exported — regression), enums,
// union-of-enum-members, optional methods, inline object returns, inline
// object-literal arrays.
import type { Shared } from './shared';

export * from './host';

type AllDefs = HostDefs & ExtraDefs;

export interface MultiPlugin extends AllDefs {
  initialize(opts: InitOptions): Promise<void>;
  run(): Promise<{ ok: Shared; }>;
  optionalThing?(x: string): Promise<void>;
}

export interface InitOptions {
  key: string;
  summary?: { label: string; amount: number; }[];
}

export type Mode = HostMode.Fast | HostMode.Slow;
