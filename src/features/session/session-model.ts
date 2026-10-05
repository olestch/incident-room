import { z } from 'zod';
import { currentUserSchema } from '@/entities/current-user/model';

export const identitySchema = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  role: z.enum(['member', 'admin']),
  expiresAt: z.number().finite().nonnegative(),
});
export const sessionEnvelopeSchema = z
  .object({ identity: identitySchema, user: currentUserSchema })
  .refine(
    ({ identity, user }) =>
      identity.userId === user.id &&
      identity.workspaceId === user.workspaceId &&
      identity.role === user.role,
  );
export type SessionIdentity = z.infer<typeof identitySchema>;
export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;
export type SessionState = { generation: number } & (
  | { status: 'restoring' | 'anonymous' | 'expired' }
  | { status: 'authenticated' | 'refreshing'; identity: SessionIdentity }
);
