// Covers: simple Promise methods, struct with optional + nullable fields,
// union type, single event via `event:` param name, JSDoc containing an
// apostrophe (string-tracking regression), eventName-free listener param.
export type Mode = 'fast' | 'slow' | 'off';

export type Status = {
  enabled: boolean;
  mode: Mode;
  label: string;
  note: string | null;
  count?: number;
};

export interface BasicPlugin {
  /**
   * This comment doesn't break the parser (apostrophe regression test).
   */
  getStatus(): Promise<Status>;
  /** No result — void promise. */
  refresh(): Promise<void>;
  addListener(
    event: 'statusChanged',
    listener: (data: Status) => void,
  ): Promise<unknown>;
  removeAllListeners(): Promise<void>;
}
