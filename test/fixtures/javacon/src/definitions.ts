// Java conformance fixture (wave 3): 3 methods, 3 DISTINCT result types,
// options params on two methods (required + optional fields), an array
// field, reject paths (1-arg + 2-arg), and an early return after reject.
// The emitted android/TestJavaconModule.java must IMPLEMENT the generated
// Kotlin interface: Promise<T> signatures, typed options accessors,
// ResolvablePromise.fulfillSuccess/fulfillFailure, pushToMarshaller via
// DefaultImpls — no ValdiCall shim anywhere in the compiled path.
export interface EchoOptions {
  message: string;
}

export interface ProbeOptions {
  count?: number;
  active?: boolean;
}

export interface EchoResult {
  message: string;
}

export interface ProbeResult {
  count: number;
  active: boolean;
}

export interface TallyResult {
  words: string[];
  total: number;
}

export interface JavaConPlugin {
  echo(options: EchoOptions): Promise<EchoResult>;
  probe(options: ProbeOptions): Promise<ProbeResult>;
  tally(): Promise<TallyResult>;
}
