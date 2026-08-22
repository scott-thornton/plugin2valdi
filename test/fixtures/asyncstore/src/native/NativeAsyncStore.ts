import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface Spec extends TurboModule {
  getValues: (dbName: string, keys: string[]) => Promise<{ key: string; value: string | null }[]>;
  setValues: (dbName: string, values: { key: string; value: string | null }[]) => Promise<void>;
  legacy_multiGet: (keys: string[]) => Promise<[string, string][]>;
  legacy_multiRemove: (keys: readonly string[]) => Promise<void>;
  getAllKeys: (dbName: string) => Promise<string[]>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("RNCAsyncStore");
