export type DiagnosticEvent =
  | 'connection-change'
  | 'sync-completed'
  | 'duplicate-ignored'
  | 'mutation-outcome-unknown'
  | 'invalid-boundary-data'
  | 'render-recovery';

export interface DiagnosticRecord {
  event: DiagnosticEvent;
  attempt?: number;
  durationMs?: number;
  count?: number;
}

export type DiagnosticSink = (record: DiagnosticRecord) => void;

/** Safe structured events only: no message bodies, credentials, raw URLs, or user data. */
export function createDiagnostics(sink: DiagnosticSink = () => undefined) {
  return {
    record(record: DiagnosticRecord) {
      // Reconstruct the allowlist: structural typing may allow extra runtime properties.
      const safe: DiagnosticRecord = { event: record.event };
      if (record.attempt !== undefined && Number.isFinite(record.attempt))
        safe.attempt = record.attempt;
      if (record.durationMs !== undefined && Number.isFinite(record.durationMs))
        safe.durationMs = record.durationMs;
      if (record.count !== undefined && Number.isFinite(record.count)) safe.count = record.count;
      sink(safe);
    },
  };
}
