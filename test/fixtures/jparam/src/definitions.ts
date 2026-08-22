// Java-side per-method resolve wrapping: 3 methods, 3 DISTINCT result types
// (array field, number field, string+boolean fields) + one parameterized
// method. The old transform wrapped every call.resolve(...) with the
// primary maker — this fixture proves each method gets its own
// (makeListResult / makeCountResult / makeDescribeResult). Mirrors
// test/fixtures/params (options + array-field shapes proven E2E by
// @capacitor/preferences).
export interface DescribeOptions {
  label: string;
}

export interface ListResult {
  items: string[];
}

export interface CountResult {
  count: number;
}

export interface DescribeResult {
  label: string;
  active: boolean;
}

export interface JparamPlugin {
  list(): Promise<ListResult>;
  count(): Promise<CountResult>;
  describe(options: DescribeOptions): Promise<DescribeResult>;
}
