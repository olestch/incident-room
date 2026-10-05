import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';

export const workspaceUserSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['member', 'admin']),
  status: z.enum(['active', 'deactivated']),
});
export const currentUserSchema = workspaceUserSchema.extend({ status: z.literal('active') });
export type WorkspaceUser = z.infer<typeof workspaceUserSchema>;
export const workspaceUsersSchema = z.array(workspaceUserSchema).max(200);
export const workspaceUsersKey = (userId: string, workspaceId: string) =>
  [...queryScope(userId, workspaceId), 'workspace-users'] as const;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export const currentUserKey = (userId: string, workspaceId: string) =>
  [...queryScope(userId, workspaceId), 'current-user'] as const;
