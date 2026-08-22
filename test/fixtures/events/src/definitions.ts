// Covers: the verified @ExportProxy listener surface — one object-payload
// event, one primitive-payload event, and Promise methods so the module is
// realistic. This fixture doubles as the events toolchain-validation module:
// it is translated and compiled through the real Valdi compiler (see the
// verified-pattern notes in lib/emit-dts.mjs).
export interface ScanResult {
  barcode: string;
  format: string;
}

export interface EventsPlugin {
  startScanning(): Promise<void>;
  getLastScan(): Promise<ScanResult>;
  addListener(
    eventName: 'scanCompleted',
    listenerFunc: (result: ScanResult) => void,
  ): Promise<unknown>;
  addListener(
    eventName: 'decodeError',
    listenerFunc: (message: string) => void,
  ): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
