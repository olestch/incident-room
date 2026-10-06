export type DiagnosticEvent =
  | 'connection-change'
  | 'sync-completed'
  | 'duplicate-ignored'
  | 'mutation-outcome-unknown'
  | 'invalid-boundary-data'
  | 'render-recovery'
  | 'transport_connected'
  | 'transport_disconnected'
  | 'reconnect_attempt'
  | 'resync_started'
  | 'resync_completed'
  | 'duplicate_event'
  | 'stale_revision'
  | 'invalid_event'
  | 'checkpoint_advanced'
  | 'search_requested'
  | 'search_failed'
  | 'notification_received'
  | 'notification_read'
  | 'notification_bulk_read'
  | 'command_palette_opened'
  | 'command_executed';
// Realtime categories contain no content or identity fields.

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
