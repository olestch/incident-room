import { afterEach, expect, it, vi } from 'vitest';
import { bindDemoConnection, configureDemo, resetDemoConfig } from './runtime';
import { defaultDemo } from '@/features/demo/model';
afterEach(() => {
  resetDemoConfig();
  vi.restoreAllMocks();
});
it('controls actual coordinator capability without replacing it or adding a transport', () => {
  const online = vi.fn();
  const remove = bindDemoConnection(online);
  expect(online).toHaveBeenLastCalledWith(true);
  configureDemo({ ...defaultDemo, realtimeConnection: 'disconnected' });
  expect(online).toHaveBeenLastCalledWith(false);
  configureDemo(defaultDemo);
  expect(online).toHaveBeenLastCalledWith(true);
  remove();
  online.mockClear();
  configureDemo(defaultDemo);
  expect(online).not.toHaveBeenCalled();
});
it('reconnect respects actual browser offline state', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const online = vi.fn();
  const remove = bindDemoConnection(online);
  configureDemo(defaultDemo);
  expect(online).toHaveBeenLastCalledWith(false);
  remove();
});
