import { expect, it, vi } from 'vitest';
import { createDiagnostics } from './diagnostics';

it('only sends allowed metadata to a diagnostic sink', () => {
  const sink = vi.fn();
  const diagnostics = createDiagnostics(sink);
  const unsafeRecord = {
    event: 'sync-completed' as const,
    count: 3,
    durationMs: Number.NaN,
    token: 'fictional-secret-that-must-not-be-logged',
  };
  diagnostics.record(unsafeRecord);
  expect(sink).toHaveBeenCalledExactlyOnceWith({ event: 'sync-completed', count: 3 });
});
