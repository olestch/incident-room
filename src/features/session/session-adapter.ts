export interface SessionIdentity {
  userId: string;
  workspaceId: string;
  expiresAt: number;
}

/** Credentials belong to the adapter, never Redux, Query, or durable user storage. */
export interface SessionAdapter {
  restore(signal: AbortSignal): Promise<SessionIdentity | null>;
  login(input: { email: string; password: string }, signal: AbortSignal): Promise<SessionIdentity>;
  register(
    input: { name: string; email: string; password: string },
    signal: AbortSignal,
  ): Promise<SessionIdentity>;
  refresh(signal: AbortSignal): Promise<SessionIdentity>;
  requestPasswordReset(email: string, signal: AbortSignal): Promise<void>;
  logout(signal: AbortSignal): Promise<void>;
}
