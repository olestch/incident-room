import { AppError } from '@/shared/errors/app-error';

export interface TimelineViewport {
  reveal(id: string, signal: AbortSignal): Promise<void>;
  latest(): void;
}
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    void task.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
export class TargetNavigation {
  private current: AbortController | null = null;
  async navigate(
    target: string,
    load: (signal: AbortSignal) => Promise<{ deleted: boolean }>,
    viewport: TimelineViewport,
    report: (status: string, highlight: string | null) => void,
  ) {
    this.current?.abort();
    const controller = new AbortController();
    this.current = controller;
    report('Locating Timeline target…', null);
    // A deadline bounds failure; readiness comes from Query, mount and measurement, never timer chains.
    const deadline = setTimeout(
      () =>
        controller.abort(new Error('Timeline target navigation timed out. Retry is available.')),
      20_000,
    );
    try {
      if (!/^[\w:-]{1,160}$/.test(target))
        throw new AppError('validation', 'Malformed Timeline target.');
      const result = await abortable(load(controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      await abortable(viewport.reveal(target, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      report(result.deleted ? 'Target found: deleted entry.' : 'Target found in Timeline.', target);
    } catch (error) {
      if (
        this.current !== controller ||
        (controller.signal.aborted &&
          !(
            controller.signal.reason instanceof Error &&
            controller.signal.reason.name !== 'AbortError'
          ))
      )
        return;
      report(
        error instanceof AppError
          ? error.category === 'not-found'
            ? 'Timeline target missing.'
            : error.category === 'authorization'
              ? 'Timeline target access denied.'
              : error.category === 'authentication'
                ? 'Session expired while locating target.'
                : error.message
          : controller.signal.aborted
            ? 'Timeline target navigation timed out. Retry is available.'
            : 'Timeline target unavailable. Check connection and retry.',
        null,
      );
    } finally {
      clearTimeout(deadline);
    }
  }
  cancel() {
    this.current?.abort();
    this.current = null;
  }
}
