export type ScrollSurface = 'Timeline' | 'Thread';
export type TechnicalData = Record<string, number | boolean | string | null>;
export interface VirtualGeometry {
  key: string;
  index: number;
  start: number;
  end: number;
  size: number;
}
export interface GeometrySample {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  clientWidth: number;
  top: number;
  bottom: number;
  distanceFromBottom: number;
  offset: number | null;
  adjustments: number;
  totalSize: number;
  rowCount: number;
  isScrolling: boolean;
  direction: string | null;
  first: VirtualGeometry | null;
  last: VirtualGeometry | null;
  anchor:
    (VirtualGeometry & { top: number; bottom: number; height: number; transform: string }) | null;
}
export interface ScrollEvent {
  sequence: number;
  time: number;
  relativeTime: number;
  surface: ScrollSurface | null;
  type: string;
  data: TechnicalData | GeometrySample;
}
export const scrollDebugEnabled = (environment: string | undefined, flag: string | null) =>
  environment === 'development' && flag === '1';
/** Technical-only callers; never pass app records, URLs, event targets or text. */
export class ScrollRecorder {
  readonly sessionId = crypto.randomUUID();
  recording = false;
  private events: ScrollEvent[] = [];
  private cursor = 0;
  private sequence = 0;
  private origin = 0;
  private startedAt: string | null = null;
  private previous = new Map<ScrollSurface, GeometrySample>();
  private input = new Map<ScrollSurface, { time: number; direction: number; active: boolean }>();
  private lastSignal = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(
    readonly capacity = 7500,
    readonly thresholds = {
      scroll: 6,
      anchor: 8,
      stableScroll: 1,
      postInputMs: 120,
      cooldownMs: 300,
    },
    private readonly now = () => performance.now(),
  ) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Positive buffer capacity required');
  }
  get count() {
    return this.events.length;
  }
  get totalCount() {
    return this.sequence;
  }
  get droppedCount() {
    return Math.max(0, this.sequence - this.events.length);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }
  start() {
    if (this.recording) return;
    if (!this.startedAt) {
      this.origin = this.now();
      this.startedAt = new Date().toISOString();
    }
    this.previous.clear();
    this.input.clear();
    this.recording = true;
    this.record(null, 'recording-start', {});
    this.notify();
  }
  stop() {
    if (!this.recording) return;
    this.record(null, 'recording-stop', {});
    this.recording = false;
    this.notify();
  }
  clear() {
    this.events = [];
    this.cursor = 0;
    this.sequence = 0;
    this.previous.clear();
    this.input.clear();
    this.lastSignal.clear();
    this.origin = this.now();
    this.startedAt = this.recording ? new Date().toISOString() : null;
    if (this.recording) this.record(null, 'recording-cleared', {});
    this.notify();
  }
  // Pseudonymous stable keys avoid exporting local keys containing account IDs.
  key(raw: string | number | bigint) {
    let hash = 2166136261,
      second = 2246822519;
    for (const char of `${this.sessionId}:${raw}`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      second = Math.imul(second ^ char.charCodeAt(0), 3266489917);
    }
    return `row-${(hash >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
  }
  record(surface: ScrollSurface | null, type: string, data: TechnicalData | GeometrySample) {
    if (!this.recording) return;
    const time = this.now();
    const event = {
      sequence: ++this.sequence,
      time,
      relativeTime: time - this.origin,
      surface,
      type,
      data,
    };
    if (this.events.length < this.capacity) this.events.push(event);
    else {
      this.events[this.cursor] = event;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
  }
  userInput(
    surface: ScrollSurface,
    type: string,
    direction: number,
    active: boolean,
    distance = 0,
  ) {
    if (!this.recording) return;
    this.input.set(surface, { time: this.now(), direction, active });
    this.record(surface, type, { direction, distance, active });
  }
  sample(surface: ScrollSurface, sample: GeometrySample, reason: string) {
    if (!this.recording) return;
    const before = this.previous.get(surface);
    this.previous.set(surface, sample);
    const delta = before ? sample.scrollTop - before.scrollTop : 0;
    const anchorDelta =
      before?.anchor && sample.anchor?.key === before.anchor.key
        ? sample.anchor.top - before.anchor.top
        : 0;
    if (before && JSON.stringify(before) === JSON.stringify(sample)) return;
    this.record(surface, 'geometry', sample);
    this.record(surface, 'sample-context', { reason, scrollDelta: delta, anchorDelta });
    if (!before) return;
    const input = this.input.get(surface);
    const elapsed = input ? this.now() - input.time : null;
    const signals: string[] = [];
    if (
      input?.direction &&
      Math.abs(delta) >= this.thresholds.scroll &&
      Math.sign(delta) !== input.direction
    )
      signals.push('scroll-reversal');
    if (Math.abs(anchorDelta) >= this.thresholds.anchor) {
      signals.push('anchor-jump');
      if (Math.abs(delta) <= this.thresholds.stableScroll) signals.push('geometry-mismatch');
    }
    if (
      input &&
      !input.active &&
      elapsed !== null &&
      elapsed >= this.thresholds.postInputMs &&
      (Math.abs(delta) >= this.thresholds.scroll || Math.abs(anchorDelta) >= this.thresholds.anchor)
    )
      signals.push('post-gesture-correction');
    for (const signal of signals) {
      const key = `${surface}:${signal}`;
      if (this.now() - (this.lastSignal.get(key) ?? -Infinity) < this.thresholds.cooldownMs)
        continue;
      this.lastSignal.set(key, this.now());
      this.record(surface, 'anomaly', {
        signal,
        scrollDelta: delta,
        anchorDelta,
        inputElapsedMs: elapsed,
        virtualScrolling: sample.isScrolling,
        source: 'unknown',
        diagnosticOnly: true,
      });
    }
  }
  export(metadata: {
    commit: string | null;
    userAgent: string;
    width: number;
    height: number;
    devicePixelRatio: number;
  }) {
    const events = this.cursor
      ? [...this.events.slice(this.cursor), ...this.events.slice(0, this.cursor)]
      : [...this.events];
    return JSON.stringify(
      {
        schemaVersion: 1,
        sessionId: this.sessionId,
        ...metadata,
        recordingStartTime: this.startedAt,
        recording: this.recording,
        totalEventCount: this.totalCount,
        retainedEventCount: this.count,
        droppedEventCount: this.droppedCount,
        thresholds: this.thresholds,
        anomalies: events.filter((event) => event.type === 'anomaly'),
        events,
      },
      null,
      2,
    );
  }
}
