/**
 * @ExportModule
 */

// Translated from the Capacitor plugin contract "EventsPlugin" via plugin2valdi.
// Grammar verified against valdi_webview/src/WebViewNative.d.ts + valdi_http.
// NOTE: the annotation parser treats any at-sign-prefixed word in comments
// as an annotation (verified by build error) - never put handles in prose.

/**
 * @ExportModel({
 *   ios: 'SCScanResult',
 *   android: 'com.plugin2valdi.modules.test_events.ScanResult'
 * })
 */
export interface ScanResult {
  barcode: string;
  format: string;
}

export function startScanning(): Promise<void>;
export function getLastScan(): Promise<ScanResult>;

/**
 * @ExportProxy({
 *   ios: 'SCTestEventsListener',
 *   android: 'com.plugin2valdi.modules.test_events.TestEventsListener'
 * })
 */
export interface TestEventsListener {
  scanCompleted(payload: ScanResult): void;
  decodeError(payload: string): void;
}

export function setListener(listener?: TestEventsListener): void;
