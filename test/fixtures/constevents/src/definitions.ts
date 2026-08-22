// Covers: eventName param spelling (not `event`), union event names in one
// signature, constant event references at notifyListeners call sites, and
// the retain-until-consumed boolean — plus PermissionCallback annotation.
export interface AppState { active: boolean; }

export interface ConstEventsPlugin {
  exit(): Promise<void>;
  addListener(
    eventName: 'stateChange' | 'pause',
    listenerFunc: (state: AppState) => void,
  ): Promise<unknown>;
  addListener(
    eventName: 'urlOpen',
    listenerFunc: (url: { url: string }) => void,
  ): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
