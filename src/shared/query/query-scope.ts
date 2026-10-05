export function queryScope(userId: string, workspaceId: string) {
  return ['identity', userId, workspaceId] as const;
}
