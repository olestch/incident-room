export type TransportEvent =
  | { type: 'payload'; payload: unknown }
  | { type: 'closed'; code: number }
  | { type: 'error' }
  | { type: 'watermark'; sequence: number };

/** Semantic lifecycle port implemented by the mock; replaceable by native WebSocket. */
export interface RealtimeTransport {
  connect(signal: AbortSignal): Promise<void>;
  disconnect(): void;
  subscribe(listener: (event: TransportEvent) => void): () => void;
  typing?(active: boolean, root?: string | undefined): void;
}

// Validation/checkpoints/resync belong to the coordinator, never raw component callbacks.
