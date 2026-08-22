/**
 * @ExportModule
 */

// Translated from the React Native TurboModule spec "Spec" via plugin2valdi.
// Grammar verified against valdi_webview/src/WebViewNative.d.ts + valdi_http.
// NOTE: the annotation parser treats any at-sign-prefixed word in comments
// as an annotation (verified by build error) - never put handles in prose.

/**
 * @ExportModel({
 *   ios: 'SCSetImageOptions',
 *   android: 'com.plugin2valdi.modules.clipboard.SetImageOptions'
 * })
 */
export interface SetImageOptions {
  content: string;
}

/**
 * @ExportModel({
 *   ios: 'SCSetStringOptions',
 *   android: 'com.plugin2valdi.modules.clipboard.SetStringOptions'
 * })
 */
export interface SetStringOptions {
  content: string;
}

/**
 * @ExportModel({
 *   ios: 'SCSetStringsOptions',
 *   android: 'com.plugin2valdi.modules.clipboard.SetStringsOptions'
 * })
 */
export interface SetStringsOptions {
  content: string[];
}

export function getString(): Promise<string>;
export function getStrings(): Promise<string[]>;
export function getImagePNG(): Promise<string>;
export function getImageJPG(): Promise<string>;
export function setImage(options: SetImageOptions): Promise<void>;
export function getImage(): Promise<string>;
export function setString(options: SetStringOptions): void;
export function setStrings(options: SetStringsOptions): void;
export function hasString(): Promise<boolean>;
export function hasImage(): Promise<boolean>;
export function hasURL(): Promise<boolean>;
export function hasNumber(): Promise<boolean>;
export function hasWebURL(): Promise<boolean>;

/**
 * @ExportProxy({
 *   ios: 'SCClipboardListener',
 *   android: 'com.plugin2valdi.modules.clipboard.ClipboardListener'
 * })
 */
export interface ClipboardListener {
  textChanged(payload: string): void;
}

export function setListener(listener?: ClipboardListener): void;
