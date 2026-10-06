import { expect, it } from 'vitest';
import { defaultDemo, demoSchema, DemoPolicy, demoConfigured, demoReducer } from './model';
it('validates bounded serializable demo configuration', () => {
  expect(demoSchema.parse(defaultDemo)).toEqual(defaultDemo);
  for (const patch of [
    { latency: -1 },
    { latency: 100 },
    { failureRate: 100 },
    { datasetSize: 50001 },
    { eventGeneration: 'invalid' },
  ])
    expect(demoSchema.safeParse({ ...defaultDemo, ...patch }).success).toBe(false);
});
it('runs exactly reproducible 10 and 30 percent operation-local schedules', () => {
  for (const rate of [10, 30] as const) {
    const policy = new DemoPolicy();
    policy.configure({ ...defaultDemo, failureRate: rate });
    const sequence = Array.from(
      { length: 100 },
      () => policy.decision('GET', '/mock-api/search').fail,
    );
    expect(sequence.filter(Boolean)).toHaveLength(rate);
    policy.configure({ ...defaultDemo, failureRate: rate });
    expect(
      Array.from({ length: 100 }, () => policy.decision('GET', '/mock-api/search').fail),
    ).toEqual(sequence);
    expect(policy.decision('POST', '/mock-api/incidents').fail).toBe(true);
  }
});
it('delays real resource operations but protects auth, runtime polling and controls', () => {
  const policy = new DemoPolicy();
  policy.configure({ ...defaultDemo, latency: 2000, failureRate: 30 });
  expect(policy.decision('GET', '/mock-api/search')).toEqual({ latency: 2000, fail: true });
  expect(policy.decision('POST', '/mock-api/incidents/INC-2841/timeline').latency).toBe(2000);
  for (const path of [
    '/mock-api/auth/login',
    '/mock-api/auth/refresh',
    '/mock-api/incidents/INC-2841/realtime/open',
    '/mock-api/realtime/stream',
    '/mock-api/demo/event',
    '/assets/file',
  ])
    expect(policy.decision('GET', path)).toEqual({ latency: 0, fail: false });
});
it('Redux owns only validated configuration and defaults do not leak across runtimes', () => {
  const first = demoReducer(undefined, demoConfigured({ ...defaultDemo, latency: 5000 }));
  expect(first.latency).toBe(5000);
  expect(demoReducer(undefined, { type: 'initial' }).latency).toBe(0);
  expect(JSON.parse(JSON.stringify(first))).toEqual(first);
});
