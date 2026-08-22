// Covers: plugin whose Android side uses Kotlin-style multi-line annotation
// blocks (permissions array) that the validator allowlist must absorb.
export interface KResult { value: string; }

export interface KotlinAnnoPlugin {
  read(): Promise<KResult>;
}
