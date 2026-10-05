export type TransportEvent =
  { type: 'payload'; payload: unknown } | { type: 'closed'; code: number } | { type: 'error' };

/** Runtime port shared by future native and deterministic mock transport adapters. */
export interface RealtimeTransport {
  connect(signal: AbortSignal): Promise<void>;
  disconnect(): void;
  subscribe(listener: (event: TransportEvent) => void): () => void;
}

// Protocol validation, auth, subscriptions, and resync belong above this port.
// No socket implementation or domain payload schema exists in Phase 1.
