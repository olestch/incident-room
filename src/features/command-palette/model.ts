export type Command = {
  id: string;
  label: string;
  category: 'Navigation' | 'Current Incident' | 'Search' | 'Incidents';
  destination?: string;
  action?: 'create' | 'close-thread';
};
export function commandRegistry(
  pathname: string,
  params: URLSearchParams,
  canCreate: boolean,
  userId?: string,
): Command[] {
  const commands: Command[] = [
    {
      id: 'incidents',
      label: 'Go to Incidents',
      category: 'Navigation',
      destination: '/app/incidents',
    },
    {
      id: 'mine',
      label: 'Go to My Incidents',
      category: 'Navigation',
      destination: '/app/incidents?assignedToMe=true',
    },
    {
      id: 'notifications',
      label: 'Open Notifications',
      category: 'Navigation',
      destination: '/app/notifications',
    },
    { id: 'search', label: 'Search', category: 'Search', destination: '/app/search' },
    { id: 'team', label: 'Go to Team', category: 'Navigation', destination: '/app/team' },
  ];
  if (userId)
    commands.push({
      id: 'profile',
      label: 'Open my Profile',
      category: 'Navigation',
      destination: `/app/profile/${encodeURIComponent(userId)}`,
    });
  if (canCreate)
    commands.push({
      id: 'create',
      label: 'Create Incident',
      category: 'Navigation',
      action: 'create',
    });
  if (/^\/app\/incidents\/INC-\d+$/.test(pathname)) {
    const timeline = new URLSearchParams(params);
    timeline.delete('thread');
    timeline.delete('message');
    commands.push({
      id: 'timeline',
      label: 'Open current Incident Timeline',
      category: 'Current Incident',
      ...(params.get('thread') ? { action: 'close-thread' as const } : {}),
      destination: `${pathname}${timeline.size ? `?${timeline}` : ''}`,
    });
    if (params.get('thread'))
      commands.push({
        id: 'close-thread',
        action: 'close-thread',
        label: 'Close current Thread',
        category: 'Current Incident',
        destination: `${pathname}${timeline.size ? `?${timeline}` : ''}`,
      });
  }
  return commands;
}
export function filterCommands(commands: readonly Command[], query: string) {
  const tokens = query.trim().toLocaleLowerCase('en-US').split(/\s+/);
  return commands.filter((command) =>
    tokens.every((token) =>
      `${command.label} ${command.category}`.toLocaleLowerCase('en-US').includes(token),
    ),
  );
}
export function paletteShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'
  >,
  editable: boolean,
  modal: boolean,
) {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !editable &&
    !modal &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'k'
  );
}
