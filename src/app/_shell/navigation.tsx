'use client';
import Link from 'next/link';
import { Bell, FlaskConical, ListTodo, Search, Settings, Users } from 'lucide-react';

const destinations = [
  { label: 'Incidents', href: '/app/incidents', icon: ListTodo },
  { label: 'Search', href: '/app/search', icon: Search },
  { label: 'Notifications', href: '/app/notifications', icon: Bell },
  { label: 'Team', href: '/app/team', icon: Users },
] as const;

export function ShellNavigation({
  pathname,
  unread,
  navigate,
  openDemo,
}: {
  pathname: string;
  unread: number | undefined;
  navigate(event: { preventDefault(): void }): void;
  openDemo(): void;
}) {
  const active = (label: string, href: string) => {
    if (label === 'Incidents') return pathname.startsWith('/app/incidents');
    return pathname === href;
  };
  return (
    <nav aria-label="Application" className="shell-navigation">
      <div className="shell-nav-primary">
        {destinations.map(({ label, href, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            aria-label={label}
            aria-current={active(label, href) ? 'page' : undefined}
            onNavigate={navigate}
            className="shell-nav-item"
          >
            <Icon size={16} aria-hidden="true" />
            <span className="shell-nav-label">{label}</span>
            {label === 'Notifications' && unread !== undefined && unread > 0 && (
              <span className="shell-nav-count" aria-label={`${unread} unread notifications`}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
            <span className="shell-nav-tooltip" aria-hidden="true">
              {label}
            </span>
          </Link>
        ))}
      </div>
      <div className="shell-nav-utilities">
        <Link
          href="/app/settings"
          aria-label="Settings"
          onNavigate={navigate}
          aria-current={pathname === '/app/settings' ? 'page' : undefined}
          className="shell-nav-item"
        >
          <Settings size={16} aria-hidden="true" />
          <span className="shell-nav-label">Settings</span>
          <span className="shell-nav-tooltip" aria-hidden="true">
            Settings
          </span>
        </Link>
        <button type="button" className="shell-nav-item" aria-label="Demo tools" onClick={openDemo}>
          <FlaskConical size={16} aria-hidden="true" />
          <span className="shell-nav-label">Demo tools</span>
          <span className="shell-nav-tooltip" aria-hidden="true">
            Demo tools
          </span>
        </button>
        <p className="shell-nav-note">Fictional workspace</p>
      </div>
    </nav>
  );
}
