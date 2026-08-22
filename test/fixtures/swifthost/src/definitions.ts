// Covers the Swift no-host policy (status-bar shapes): an unportable helper
// class (imports Capacitor, holds CAPBridgeProtocol), a bridge-born instance
// consumed by contract methods (-> drop-with-rejection), host statements in
// lifecycle/private bodies (-> dropped in place), and a pure method that
// survives untouched. Also covers the importer get/set FAMILY naming
// (setPrefix -> setPrefixWith(_:), compile-verified on status-bar).
export interface StyleOptions {
  style: string;
}

export interface Info {
  overlays: boolean;
}

export interface SwiftHostPlugin {
  setMagic(options: StyleOptions): Promise<void>;
  getInfo(): Promise<Info>;
}
