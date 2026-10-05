import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';

export const currentUserSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['member', 'admin']),
  status: z.literal('active'),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
export const currentUserKey = (userId: string, workspaceId: string) =>
  [...queryScope(userId, workspaceId), 'current-user'] as const;
