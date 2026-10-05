export interface RealtimeClock {
  now(): number;
  random(): number;
  schedule(callback: () => void, ms: number): () => void;
}
export const systemClock: RealtimeClock = {
  now: Date.now,
  random: Math.random,
  schedule(callback, ms) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
export function backoff(attempt: number, random: number) {
  return Math.round(
    Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)) *
      (0.75 + Math.max(0, Math.min(1, random)) * 0.25),
  );
}
