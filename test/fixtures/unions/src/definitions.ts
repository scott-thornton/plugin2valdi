// Covers every union shape from the real plugins whose collapse is VERIFIED
// necessary (probe matrix in FLAGS.md union-rejections-verified):
//  - named alias of string literals (device: OperatingSystem)
//  - inline literal-union field (device: platform)
//  - unannotated TS string enum, required + optional field (keyboard:
//    KeyboardStyle / KeyboardResize)
//  - method param + Promise return literal unions
//  - T | null (the one union shape the compiler accepts, as T | undefined)
export type Flavor = 'sweet' | 'salty' | 'umami';

export enum Heat {
  Low = 'low',
  High = 'high',
}

export type Taste = {
  flavor: Flavor;
  heat: Heat;
  origin: 'north' | 'south';
  region?: 'east' | 'west';
  note: string | null;
};

// keyboard setStyle pattern: the union lives in a FIELD of the param struct.
export interface FlavorOptions {
  flavor: Flavor;
}

export interface UnionsPlugin {
  getTaste(): Promise<Taste>;
  setFlavor(options: FlavorOptions): Promise<void>;
  // union RETURNS (probe-verified rejected by the compiler): the model-level
  // collapse must fix the native emitters too — Swift/Java conformances emit
  // Promise<string> (NSString / String), never raw union text
  getDirection(): Promise<Flavor>;
  getRawDirection(): Promise<'north' | 'south'>;
  getNote(): Promise<string | undefined>;
}
