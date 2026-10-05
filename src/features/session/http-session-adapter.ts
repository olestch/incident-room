import { z } from 'zod';
import { AppError } from '@/shared/errors/app-error';
import { currentUserSchema } from '@/entities/current-user/model';
import type { SessionAdapter } from './session-adapter';
import { sessionEnvelopeSchema, type SessionIdentity } from './session-model';

export const AUTH_NAMESPACE = '/mock-api/auth';
const errorSchema = z.object({
  code: z.enum([
    'SESSION_EXPIRED',
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'INVALID_INPUT',
    'UNAVAILABLE',
  ]),
});
export class AuthHttpError extends AppError {
  constructor(
    readonly code: z.infer<typeof errorSchema>['code'],
    status: number,
  ) {
    super(
      status >= 500 ? 'network' : status === 400 ? 'validation' : 'authentication',
      code === 'INVALID_CREDENTIALS'
        ? 'Email or password is incorrect.'
        : code === 'INVALID_INPUT'
          ? 'Unable to create this account. Check your details.'
          : status >= 500
            ? 'The authentication service is unavailable. Try again.'
            : 'Your session has expired. Please sign in again.',
      status,
    );
  }
}

export class HttpSessionAdapter implements SessionAdapter {
  private activeClient: string | null = null;
  constructor(
    private readonly clientId: () => string,
    private readonly origin = '',
    private readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private readonly forgetClient: (client: string) => void = () => {},
  ) {}

  async read<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    return this.call(path, schema, signal);
  }
  async call<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    body?: unknown,
    namespace = AUTH_NAMESPACE,
  ): Promise<T> {
    const invalidResponse =
      namespace === AUTH_NAMESPACE
        ? 'Invalid authentication response.'
        : 'Invalid incident service response.';
    let response: Response;
    try {
      response = await this.request(`${this.origin}${namespace}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-fictional-client': (this.activeClient ??= this.clientId()),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      });
    } catch {
      if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      throw new AppError(
        'network',
        'Unable to reach the service. Retry this submission without changing its fields.',
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError('validation', invalidResponse);
    }
    if (!response.ok) {
      const result = errorSchema.safeParse(payload);
      if (!result.success && namespace !== AUTH_NAMESPACE) {
        const business = z
          .object({
            category: z.enum(['validation', 'authorization', 'not-found', 'conflict', 'network']),
            message: z.string().max(300),
          })
          .safeParse(payload);
        if (business.success)
          throw new AppError(business.data.category, business.data.message, response.status);
      }
      if (!result.success) throw new AppError('validation', invalidResponse);
      throw new AuthHttpError(result.data.code, response.status);
    }
    const result = schema.safeParse(payload);
    if (!result.success) throw new AppError('validation', invalidResponse);
    return result.data;
  }
  resource<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown) {
    return this.call(path, schema, signal, body, '/mock-api');
  }
  async restore(signal: AbortSignal) {
    return this.call('/session', sessionEnvelopeSchema.nullable(), signal);
  }
  login(input: { email: string; password: string }, signal: AbortSignal) {
    this.activeClient = this.clientId();
    return this.call('/login', sessionEnvelopeSchema, signal, input);
  }
  register(input: { name: string; email: string; password: string }, signal: AbortSignal) {
    this.activeClient = this.clientId();
    return this.call('/register', sessionEnvelopeSchema, signal, input);
  }
  refresh(signal: AbortSignal) {
    return this.call('/refresh', sessionEnvelopeSchema, signal, {});
  }
  async logout(signal: AbortSignal) {
    const client = this.activeClient ?? this.clientId();
    try {
      await this.call('/logout', z.object({ ok: z.literal(true) }), signal, {});
    } finally {
      this.forgetClient(client);
      // Retain this handle for logout-cleanup retries; login/register explicitly acquire a new one.
    } // Local reload cannot silently resurrect a failed logout.
  }
  async requestPasswordReset(email: string, signal: AbortSignal) {
    await this.call('/forgot-password', z.object({ ok: z.literal(true) }), signal, { email });
  }
  async currentUser(signal: AbortSignal, expected?: SessionIdentity) {
    const user = await this.read('/me', currentUserSchema, signal);
    if (
      expected &&
      (user.id !== expected.userId ||
        user.workspaceId !== expected.workspaceId ||
        user.role !== expected.role)
    )
      throw new AuthHttpError('UNAUTHENTICATED', 401);
    return user;
  }
}
