/**
 * @ExportModule
 */

// Translated from the Capacitor plugin contract "ParamsPlugin" via plugin2valdi.
// Grammar verified against valdi_webview/src/WebViewNative.d.ts + valdi_http.
// NOTE: the annotation parser treats any at-sign-prefixed word in comments
// as an annotation (verified by build error) - never put handles in prose.

/**
 * @ExportModel({
 *   ios: 'SCGetOptions',
 *   android: 'com.plugin2valdi.modules.test_params.GetOptions'
 * })
 */
export interface GetOptions {
  key: string;
}

/**
 * @ExportModel({
 *   ios: 'SCSetOptions',
 *   android: 'com.plugin2valdi.modules.test_params.SetOptions'
 * })
 */
export interface SetOptions {
  key: string;
  value: string;
}

/**
 * @ExportModel({
 *   ios: 'SCConfigureOptions',
 *   android: 'com.plugin2valdi.modules.test_params.ConfigureOptions'
 * })
 */
export interface ConfigureOptions {
  group?: string;
}

/**
 * @ExportModel({
 *   ios: 'SCGetResult',
 *   android: 'com.plugin2valdi.modules.test_params.GetResult'
 * })
 */
export interface GetResult {
  value?: string;
}

/**
 * @ExportModel({
 *   ios: 'SCKeysResult',
 *   android: 'com.plugin2valdi.modules.test_params.KeysResult'
 * })
 */
export interface KeysResult {
  keys: string[];
}

export function get(options: GetOptions): Promise<GetResult>;
export function set(options: SetOptions): Promise<void>;
export function configure(options: ConfigureOptions): Promise<void>;
export function keys(): Promise<KeysResult>;
