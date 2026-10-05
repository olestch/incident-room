import type { SessionEnvelope } from './session-model';

/** Credentials belong to the adapter, never Redux, Query, or durable user storage. */
export interface SessionAdapter {
  restore(signal: AbortSignal): Promise<SessionEnvelope | null>;
  login(input: { email: string; password: string }, signal: AbortSignal): Promise<SessionEnvelope>;
  register(
    input: { name: string; email: string; password: string },
    signal: AbortSignal,
  ): Promise<SessionEnvelope>;
  refresh(signal: AbortSignal): Promise<SessionEnvelope>;
  requestPasswordReset(email: string, signal: AbortSignal): Promise<void>;
  logout(signal: AbortSignal): Promise<void>;
}
