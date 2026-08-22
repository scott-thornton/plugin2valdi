// Covers: parameterized methods (options objects), required vs optional
// option fields (guard-drop vs kept guard), getString default-arg form,
// array-typed result fields, bare get/set names (importer setWith(_:)
// family), no-result void promises. Shapes proven E2E by @capacitor/
// preferences (UserDefaults round-trip on iOS simulator).
export interface GetOptions {
  key: string;
}

export interface SetOptions {
  key: string;
  value: string;
}

export interface ConfigureOptions {
  group?: string;
}

export interface GetResult {
  value: string | undefined;
}

export interface KeysResult {
  keys: string[];
}

export interface ParamsPlugin {
  get(options: GetOptions): Promise<GetResult>;
  set(options: SetOptions): Promise<void>;
  configure(options: ConfigureOptions): Promise<void>;
  keys(): Promise<KeysResult>;
}
