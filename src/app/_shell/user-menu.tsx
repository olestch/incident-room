'use client';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { Avatar, Button } from '@/shared/ui/primitives';

export function UserMenu({
  name,
  role,
  userId,
  pending,
  logout,
  canLeave,
}: {
  name: string;
  role: string;
  userId: string;
  pending: boolean;
  logout(): void;
  canLeave(): boolean;
}) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="shell-user" aria-label="Current user">
      <Button
        variant="quiet"
        className="shell-user-trigger"
        popoverTarget={id}
        aria-label={`User menu for ${name}`}
        aria-expanded={open}
        aria-controls={id}
      >
        <Avatar name={name} />
        <span className="shell-user-name">{name}</span>
        <ChevronDown size={14} className="shell-user-chevron" aria-hidden="true" />
      </Button>
      <div
        id={id}
        ref={popover}
        popover="auto"
        className="shell-user-popover"
        onToggle={(event) => {
          setOpen(event.newState === 'open');
          if (event.newState === 'open')
            event.currentTarget.querySelector<HTMLAnchorElement>('a')?.focus();
        }}
      >
        <div className="shell-user-identity">
          <p className="font-semibold">{name}</p>
          <p className="type-meta">{role}</p>
        </div>
        <Link
          className="shell-menu-action"
          href={`/app/profile/${encodeURIComponent(userId)}`}
          onNavigate={(event) => {
            if (!canLeave()) event.preventDefault();
            else popover.current?.hidePopover();
          }}
        >
          <UserRound size={16} aria-hidden="true" />
          My profile
        </Link>
        <Button variant="quiet" className="shell-menu-action" disabled={pending} onClick={logout}>
          <LogOut size={16} aria-hidden="true" />
          {pending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </div>
  );
}
