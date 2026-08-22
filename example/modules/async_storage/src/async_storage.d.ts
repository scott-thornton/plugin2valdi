/**
 * @ExportModule
 */

// Translated from the React Native TurboModule spec "Spec" via plugin2valdi.
// Grammar verified against valdi_webview/src/WebViewNative.d.ts + valdi_http.
// NOTE: the annotation parser treats any at-sign-prefixed word in comments
// as an annotation (verified by build error) - never put handles in prose.

/**
 * @ExportModel({
 *   ios: 'SCGetValuesOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.GetValuesOptions'
 * })
 */
export interface GetValuesOptions {
  dbName: string;
  keys: string[];
}

/**
 * @ExportModel({
 *   ios: 'SCSetValuesOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.SetValuesOptions'
 * })
 */
export interface SetValuesOptions {
  dbName: string;
  values: SetValuesOptionsValuesItem[];
}

/**
 * @ExportModel({
 *   ios: 'SCRemoveValuesOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.RemoveValuesOptions'
 * })
 */
export interface RemoveValuesOptions {
  dbName: string;
  keys: string[];
}

/**
 * @ExportModel({
 *   ios: 'SCGetKeysOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.GetKeysOptions'
 * })
 */
export interface GetKeysOptions {
  dbName: string;
}

/**
 * @ExportModel({
 *   ios: 'SCClearStorageOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.ClearStorageOptions'
 * })
 */
export interface ClearStorageOptions {
  dbName: string;
}

/**
 * @ExportModel({
 *   ios: 'SCLegacyMultiGetOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.LegacyMultiGetOptions'
 * })
 */
export interface LegacyMultiGetOptions {
  keys: string[];
}

/**
 * @ExportModel({
 *   ios: 'SCLegacyMultiSetOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.LegacyMultiSetOptions'
 * })
 */
export interface LegacyMultiSetOptions {
  kvPairs: string[][];
}

/**
 * @ExportModel({
 *   ios: 'SCLegacyMultiRemoveOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.LegacyMultiRemoveOptions'
 * })
 */
export interface LegacyMultiRemoveOptions {
  keys: string[];
}

/**
 * @ExportModel({
 *   ios: 'SCLegacyMultiMergeOptions',
 *   android: 'com.plugin2valdi.modules.async_storage.LegacyMultiMergeOptions'
 * })
 */
export interface LegacyMultiMergeOptions {
  kvPairs: string[][];
}

/**
 * @ExportModel({
 *   ios: 'SCGetValuesResultItem',
 *   android: 'com.plugin2valdi.modules.async_storage.GetValuesResultItem'
 * })
 */
export interface GetValuesResultItem {
  key: string;
  value?: string;
}

/**
 * @ExportModel({
 *   ios: 'SCSetValuesResultItem',
 *   android: 'com.plugin2valdi.modules.async_storage.SetValuesResultItem'
 * })
 */
export interface SetValuesResultItem {
  key: string;
  value?: string;
}

/**
 * @ExportModel({
 *   ios: 'SCSetValuesOptionsValuesItem',
 *   android: 'com.plugin2valdi.modules.async_storage.SetValuesOptionsValuesItem'
 * })
 */
export interface SetValuesOptionsValuesItem {
  key: string;
  value?: string;
}

export function getValues(options: GetValuesOptions): Promise<GetValuesResultItem[]>;
export function setValues(options: SetValuesOptions): Promise<SetValuesResultItem[]>;
export function removeValues(options: RemoveValuesOptions): Promise<void>;
export function getKeys(options: GetKeysOptions): Promise<string[]>;
export function clearStorage(options: ClearStorageOptions): Promise<void>;
export function legacy_multiGet(options: LegacyMultiGetOptions): Promise<string[][]>;
export function legacy_multiSet(options: LegacyMultiSetOptions): Promise<void>;
export function legacy_multiRemove(options: LegacyMultiRemoveOptions): Promise<void>;
export function legacy_multiMerge(options: LegacyMultiMergeOptions): Promise<void>;
export function legacy_getAllKeys(): Promise<string[]>;
export function legacy_clear(): Promise<void>;
