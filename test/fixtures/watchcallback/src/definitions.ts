// Covers: function-typed alias used as a callback param (watch pattern) —
// must produce the callback-aliases blocking flag; external type import —
// must produce the unresolved-types blocking flag.
import type { PermissionState } from '@capacitor/core';

export interface Position { lat: number; lng: number; }

export type WatchCallback = (position: Position, err: any) => void;

export interface WatchPlugin {
  getPosition(): Promise<Position>;
  watch(callback: WatchCallback): Promise<string>;
  stopWatch(): Promise<void>;
  getSecurity(): Promise<{ state: PermissionState }>;
}
