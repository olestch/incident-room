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
  constructor(private readonly label = 'Timeline') {}
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
    report(`Locating ${this.label} target…`, null);
    // A deadline bounds failure; readiness comes from Query, mount and measurement, never timer chains.
    const deadline = setTimeout(
      () =>
        controller.abort(
          new Error(`${this.label} target navigation timed out. Retry is available.`),
        ),
      20_000,
    );
    try {
      if (!new RegExp(`^[\\w:-]{1,${this.label === 'Thread' ? 400 : 160}}$`).test(target))
        throw new AppError('validation', `Malformed ${this.label} target.`);
      const result = await abortable(load(controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      await abortable(viewport.reveal(target, controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      report(
        result.deleted
          ? this.label === 'Thread'
            ? 'Target found: deleted message.'
            : 'Target found: deleted entry.'
          : `Target found in ${this.label}.`,
        target,
      );
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
            ? `${this.label} target missing.`
            : error.category === 'authorization'
              ? `${this.label} target access denied.`
              : error.category === 'authentication'
                ? 'Session expired while locating target.'
                : error.message
          : controller.signal.aborted
            ? `${this.label} target navigation timed out. Retry is available.`
            : `${this.label} target unavailable. Check connection and retry.`,
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
