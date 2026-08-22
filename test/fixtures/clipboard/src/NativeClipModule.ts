import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { Int32 } from "react-native/Libraries/Types/CodegenTypes";

export interface Spec extends TurboModule {
  getString(): Promise<string>;
  setString(content: string): void;
  hasString(): Promise<boolean>;
  setListener(): void;
  removeListener(): void;
  addListener(eventName: string): void;
  removeListeners(count: Int32): void;
}

const ClipTurboModule = TurboModuleRegistry.getEnforcing<Spec>("RNCClip");
export default ClipTurboModule;
