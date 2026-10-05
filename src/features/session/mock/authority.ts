import { z } from 'zod';
import { currentUserSchema, type CurrentUser } from '@/entities/current-user/model';
import type { SessionEnvelope } from '@/features/session/session-model';

export const DEMO_PASSWORD = 'Fictional-pass-42';
const accountSchema = z.object({ user: currentUserSchema, verifier: z.string() });
const leaseSchema = z.object({
  userId: z.string(),
  expiresAt: z.number(),
  refreshUntil: z.number(),
});
export const authoritySchema = z.object({
  accounts: z.array(accountSchema),
  clients: z.record(z.string(), leaseSchema),
  nextUser: z.number(),
});
export type AuthorityData = z.infer<typeof authoritySchema>;
export interface AuthorityStore {
  transact<T>(operation: (data: AuthorityData) => T): Promise<T>;
}
const seedUsers: CurrentUser[] = [
  {
    id: 'demo-river',
    workspaceId: 'demo-orbit',
    name: 'River Vale',
    email: 'river.vale@example.test',
    role: 'admin',
    status: 'active',
  },
  {
    id: 'demo-sage',
    workspaceId: 'demo-orbit',
    name: 'Sage Linden',
    email: 'sage.linden@example.test',
    role: 'member',
    status: 'active',
  },
];
// One-way verifier belongs only to the fictional authority; raw passwords are never retained.
// This is NOT production password hashing or a browser security boundary.
export async function passwordVerifier(email: string, password: string) {
  const bytes = new TextEncoder().encode(`incident-room-fictional-v1:${email}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function seedAuthority(): Promise<AuthorityData> {
  return {
    accounts: await Promise.all(
      seedUsers.map(async (user) => ({
        user,
        verifier: await passwordVerifier(user.email, DEMO_PASSWORD),
      })),
    ),
    clients: {},
    nextUser: 1,
  };
}
export class MemoryAuthorityStore implements AuthorityStore {
  private data = seedAuthority();
  async transact<T>(operation: (data: AuthorityData) => T) {
    return operation(await this.data);
  }
}
export class AuthorityError extends Error {
  constructor(
    readonly code: 'INVALID_CREDENTIALS' | 'INVALID_INPUT' | 'SESSION_EXPIRED' | 'UNAUTHENTICATED',
    readonly status: number,
  ) {
    super(code);
  }
}
export class MockAuthAuthority {
  constructor(
    private readonly store: AuthorityStore,
    private readonly now = Date.now,
  ) {}
  private establish(data: AuthorityData, client: string, user: CurrentUser): SessionEnvelope {
    const expiresAt = this.now() + 300_000;
    data.clients[client] = { userId: user.id, expiresAt, refreshUntil: this.now() + 86_400_000 };
    return {
      identity: { userId: user.id, workspaceId: user.workspaceId, role: user.role, expiresAt },
      user,
    };
  }
  async login(client: string, email: string, password: string) {
    const verifier = await passwordVerifier(email, password);
    return this.store.transact((data) => {
      const account = data.accounts.find(
        (value) => value.user.email === email && value.verifier === verifier,
      );
      if (!account) throw new AuthorityError('INVALID_CREDENTIALS', 401);
      return this.establish(data, client, account.user);
    });
  }
  async register(client: string, input: { name: string; email: string; password: string }) {
    const verifier = await passwordVerifier(input.email, input.password);
    return this.store.transact((data) => {
      if (data.accounts.some((value) => value.user.email === input.email))
        throw new AuthorityError('INVALID_INPUT', 400);
      const user: CurrentUser = {
        id: `demo-registered-${data.nextUser++}`,
        workspaceId: 'demo-orbit',
        name: input.name,
        email: input.email,
        role: 'member',
        status: 'active',
      };
      data.accounts.push({ user, verifier });
      return this.establish(data, client, user);
    });
  }
  current(client: string) {
    return this.store.transact((data) => {
      const lease = data.clients[client];
      if (!lease) return null;
      if (lease.refreshUntil <= this.now()) {
        delete data.clients[client];
        throw new AuthorityError('UNAUTHENTICATED', 401);
      }
      if (lease.expiresAt <= this.now()) throw new AuthorityError('SESSION_EXPIRED', 401);
      const user = data.accounts.find((value) => value.user.id === lease.userId)?.user;
      if (!user) throw new AuthorityError('UNAUTHENTICATED', 401);
      return {
        identity: {
          userId: user.id,
          workspaceId: user.workspaceId,
          role: user.role,
          expiresAt: lease.expiresAt,
        },
        user,
      };
    });
  }
  refresh(client: string) {
    return this.store.transact((data) => {
      const lease = data.clients[client];
      const user = data.accounts.find((value) => value.user.id === lease?.userId)?.user;
      if (!lease || !user || lease.refreshUntil <= this.now())
        throw new AuthorityError('UNAUTHENTICATED', 401);
      return this.establish(data, client, user);
    });
  }
  logout(client: string) {
    return this.store.transact((data) => {
      delete data.clients[client];
    });
  }
  users() {
    return this.store.transact((data) => data.accounts.map((account) => account.user));
  }
  /** Injection-only test API. Not an HTTP endpoint, UI control, or window global. */
  expire(client: string, refreshEligible = true) {
    return this.store.transact((data) => {
      const lease = data.clients[client];
      if (lease) {
        lease.expiresAt = 0;
        if (!refreshEligible) lease.refreshUntil = 0;
      }
    });
  }
}
