import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { z } from 'zod';

export const demoSchema = z.object({
  latency: z.union([z.literal(0), z.literal(500), z.literal(2000), z.literal(5000)]),
  failureRate: z.union([z.literal(0), z.literal(10), z.literal(30)]),
  realtimeConnection: z.enum(['connected', 'disconnected']),
  datasetSize: z.union([z.literal(100), z.literal(1000), z.literal(10000), z.literal(50000)]),
  eventGeneration: z.enum(['monitoring', 'deployment', 'human', 'status']),
});
export type DemoConfig = z.infer<typeof demoSchema>;
export const defaultDemo: DemoConfig = {
  latency: 0,
  failureRate: 0,
  realtimeConnection: 'connected',
  datasetSize: 10000,
  eventGeneration: 'monitoring',
};
const slice = createSlice({
  name: 'demo',
  initialState: defaultDemo,
  reducers: {
    demoConfigured: (_state, action: PayloadAction<DemoConfig>) => demoSchema.parse(action.payload),
  },
});
export const { demoConfigured } = slice.actions;
export const demoReducer = slice.reducer;

/** Deterministic operation-local schedule: first request fails, then N of every ten.
 * Polling and auth never consume the counter. Reapplying configuration resets it. */
export class DemoPolicy {
  private counts = new Map<string, number>();
  config = defaultDemo;
  configure(raw: unknown) {
    this.config = demoSchema.parse(raw);
    this.counts.clear();
  }
  decision(method: string, pathname: string) {
    if (
      !pathname.startsWith('/mock-api/') ||
      pathname.startsWith('/mock-api/auth/') ||
      pathname.startsWith('/mock-api/demo/') ||
      pathname.includes('/realtime')
    )
      return { latency: 0, fail: false };
    const key = `${method}:${pathname}`;
    const count = this.counts.get(key) ?? 0;
    this.counts.set(key, count + 1);
    return { latency: this.config.latency, fail: count % 10 < this.config.failureRate / 10 };
  }
}
