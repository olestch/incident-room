import { defaultDemo, DemoPolicy, type DemoConfig } from '@/features/demo/model';

export const demoPolicy = new DemoPolicy();
const connections = new Set<(online: boolean) => void>();
export function configureDemo(config: DemoConfig) {
  demoPolicy.configure(config);
  for (const update of connections) update(demoOnline());
}
export function demoOnline() {
  return navigator.onLine && demoPolicy.config.realtimeConnection === 'connected';
}
export function bindDemoConnection(update: (online: boolean) => void) {
  connections.add(update);
  update(demoOnline());
  return () => {
    connections.delete(update);
  };
}
export function resetDemoConfig() {
  configureDemo(defaultDemo);
}
