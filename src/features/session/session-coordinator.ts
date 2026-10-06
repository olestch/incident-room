import { AppError } from '@/shared/errors/app-error';
import { AuthHttpError } from './http-session-adapter';
import type { SessionAdapter } from './session-adapter';
import type { SessionEnvelope, SessionIdentity, SessionState } from './session-model';

export type TeardownReason = 'expired' | 'logout' | 'switch' | 'dispose';
export interface IdentityLifecycle {
  /** Stop subscriptions/timers; expire/switch quarantine durable records, never delete them. */
  stop(identity: SessionIdentity, reason: TeardownReason): void | Promise<void>;
  /** Only explicit logout deletes this identity's future drafts/outbox. Failures must surface. */
  clearDurableOnLogout(identity: SessionIdentity): Promise<void>;
}
interface Coordination {
  changed(state: SessionState): void;
  activated(envelope: SessionEnvelope): void;
  cleared(identity: SessionIdentity | null): void;
}

export class SessionCoordinator {
  private state: SessionState = { status: 'restoring', generation: 0 };
  private controller = new AbortController();
  private refreshTask: Promise<void> | null = null;
  private refreshRevision = 0;
  private barrier: Promise<void> = Promise.resolve();
  private operation = false;
  private pendingLogoutIdentity: SessionIdentity | null = null;
  private lifecycles = new Set<IdentityLifecycle>();
  constructor(
    private readonly adapter: SessionAdapter,
    private readonly callbacks: Coordination,
    private readonly now = Date.now,
  ) {}
  snapshot() {
    return this.state;
  }
  registerLifecycle(service: IdentityLifecycle) {
    this.lifecycles.add(service);
    return () => {
      this.lifecycles.delete(service);
    };
  }
  private emit(state: SessionState) {
    this.state = state;
    this.callbacks.changed(state);
  }
  private check(generation: number) {
    if (generation !== this.state.generation || this.controller.signal.aborted)
      throw new DOMException('Superseded session work', 'AbortError');
  }
  private activate(envelope: SessionEnvelope, generation: number) {
    this.check(generation);
    this.callbacks.activated(envelope);
    this.emit({ status: 'authenticated', identity: envelope.identity, generation });
  }
  private teardown(reason: TeardownReason) {
    const identity =
      'identity' in this.state
        ? this.state.identity
        : reason === 'logout'
          ? this.pendingLogoutIdentity
          : null;
    if (reason === 'logout' && identity) this.pendingLogoutIdentity = identity;
    this.controller.abort();
    this.controller = new AbortController();
    this.refreshTask = null;
    const generation = this.state.generation + 1;
    // Effect cleanup invalidates runtime work, not the persisted authority session.
    // Keep access undecided across Strict Mode replay/retry until restore resolves.
    this.emit({
      status: reason === 'dispose' ? 'restoring' : reason === 'expired' ? 'expired' : 'anonymous',
      generation,
    });
    this.callbacks.cleared(identity);
    const previousBarrier = this.barrier;
    this.barrier = previousBarrier
      .catch((error) => {
        if (reason !== 'logout') throw error;
      })
      .then(async () => {
        if (identity) {
          await Promise.all([...this.lifecycles].map((service) => service.stop(identity, reason)));
          if (reason === 'logout')
            await Promise.all(
              [...this.lifecycles].map((service) => service.clearDurableOnLogout(identity)),
            );
        }
        if (reason === 'logout') this.pendingLogoutIdentity = null;
      });
    return this.barrier;
  }
  async restore() {
    await this.barrier;
    const generation = this.state.generation;
    this.emit({ status: 'restoring', generation });
    try {
      const envelope = await this.adapter.restore(this.controller.signal);
      this.check(generation);
      if (envelope) {
        this.activate(envelope, generation);
        if (envelope.identity.expiresAt <= this.now() + 30_000) await this.refresh();
      } else this.emit({ status: 'anonymous', generation });
    } catch (error) {
      if (generation !== this.state.generation) return;
      if (error instanceof AuthHttpError && error.code === 'SESSION_EXPIRED') await this.refresh();
      else {
        await this.teardown('expired');
        throw error;
      }
    }
  }
  private async authenticate(action: (signal: AbortSignal) => Promise<SessionEnvelope>) {
    if (this.operation) throw new AppError('conflict', 'Authentication is already in progress.');
    this.operation = true;
    try {
      await this.barrier;
      if ('identity' in this.state) await this.teardown('switch');
      const generation = this.state.generation;
      this.activate(await action(this.controller.signal), generation);
    } finally {
      this.operation = false;
    }
  }
  login(input: { email: string; password: string }) {
    return this.authenticate((signal) => this.adapter.login(input, signal));
  }
  register(input: { name: string; email: string; password: string }) {
    return this.authenticate((signal) => this.adapter.register(input, signal));
  }
  resetPassword(email: string) {
    return this.adapter.requestPasswordReset(email, this.controller.signal);
  }

  refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    const generation = this.state.generation;
    if ('identity' in this.state) this.emit({ ...this.state, status: 'refreshing' });
    const task = (async () => {
      try {
        const envelope = await this.adapter.refresh(this.controller.signal);
        this.check(generation);
        if (
          'identity' in this.state &&
          (envelope.identity.userId !== this.state.identity.userId ||
            envelope.identity.workspaceId !== this.state.identity.workspaceId)
        )
          throw new AppError('authentication', 'Your session changed. Please sign in again.');
        this.refreshRevision++;
        this.activate(envelope, generation);
      } catch (error) {
        if (generation === this.state.generation) await this.teardown('expired');
        throw error;
      }
    })();
    this.refreshTask = task;
    const clear = () => {
      if (this.refreshTask === task) this.refreshTask = null;
    };
    void task.then(clear, clear);
    return task;
  }

  /** Infrastructure-only: callers explicitly declare safe read vs non-replayable mutation. */
  async request<T>(
    send: (signal: AbortSignal) => Promise<T>,
    policy: 'safe-read' | 'mutation',
    signal?: AbortSignal,
  ): Promise<T> {
    if (!('identity' in this.state)) throw new AppError('authentication', 'Please sign in again.');
    const generation = this.state.generation;
    const revision = this.refreshRevision;
    const scopedSignal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    if (this.state.identity.expiresAt <= this.now() + 30_000) await this.refresh();
    this.check(generation);
    try {
      const result = await send(scopedSignal);
      this.check(generation);
      scopedSignal.throwIfAborted();
      return result;
    } catch (error) {
      this.check(generation);
      scopedSignal.throwIfAborted();
      if (!(error instanceof AuthHttpError)) throw error;
      if (error.code === 'UNAUTHENTICATED') {
        await this.teardown('expired');
        throw error;
      }
      if (error.code !== 'SESSION_EXPIRED') throw error;
      if (revision === this.refreshRevision) await this.refresh();
      this.check(generation);
      if (policy === 'mutation') throw error; // Never replay even after successful refresh.
      try {
        const result = await send(scopedSignal);
        this.check(generation);
        scopedSignal.throwIfAborted();
        return result;
      } catch (retryError) {
        if (
          generation === this.state.generation &&
          retryError instanceof AuthHttpError &&
          ['SESSION_EXPIRED', 'UNAUTHENTICATED'].includes(retryError.code)
        )
          await this.teardown('expired');
        throw retryError;
      }
    }
  }
  async logout() {
    if (this.operation) throw new AppError('conflict', 'Authentication is already in progress.');
    this.operation = true;
    // Remove private UI immediately; preserve former identity for cleanup before losing it.
    const cleanup = this.teardown('logout');
    try {
      await Promise.all([cleanup, this.adapter.logout(this.controller.signal)]);
    } finally {
      this.operation = false;
    }
  }
  async dispose() {
    await this.teardown('dispose');
  }
}
