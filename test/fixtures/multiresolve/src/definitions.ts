// Covers: multiple distinct result types — the uniform resolve-wrap
// assumption must escalate to a blocking flag.
export interface AResult { a: string; }
export interface BResult { b: number; }
export interface CResult { c: boolean; }

export interface MultiPlugin {
  getA(): Promise<AResult>;
  getB(): Promise<BResult>;
  getC(): Promise<CResult>;
}
