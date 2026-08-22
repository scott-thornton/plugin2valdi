export * from './shared';

export interface HostDefs {
  ping(): Promise<boolean>;
  doThing(): Promise<void>;
}

export interface ExtraDefs {
  extra(): Promise<number>;
}

export enum HostMode {
  Fast = 'fast',
  Slow = 'slow',
}
