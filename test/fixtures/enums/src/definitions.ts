// Covers the @ExportEnum fidelity path (probe-verified grammar, see
// enum-grammar-verified in lib/emit-dts.mjs):
//  - TS string enums (the keyboard KeyboardResize/KeyboardStyle shapes:
//    lowercase wire values + UPPERCASE wire values) upgrade to @ExportEnum
//    instead of collapsing — required field, optional field, Promise<Enum>
//    return, options-struct param field, listener event payload
//  - literal unions (device platform: 'android' | 'ios' | 'web') STAY
//    collapsed to string — synthesizing an enum from a union renames concepts
export enum Mode {
  Body = 'body',
  Ionic = 'ionic',
  Native = 'native',
}

export enum Style {
  Dark = 'DARK',
  Light = 'LIGHT',
}

export type Origin = 'north' | 'south';

export interface ScanOptions {
  mode: Mode;
  style?: Style;
}

export interface EchoResult {
  mode: Mode;
  style?: Style;
  origin: Origin;
}

export interface EnumsPlugin {
  configure(options: ScanOptions): Promise<void>;
  getMode(): Promise<Mode>;
  echoMode(options: ScanOptions): Promise<EchoResult>;
  addListener(eventName: 'modeDetected', listenerFunc: (mode: Mode) => void): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
