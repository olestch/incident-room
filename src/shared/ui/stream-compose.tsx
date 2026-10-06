'use client';
import { useState } from 'react';
import { messageBodySchema } from '@/shared/messaging/model';
export function StreamCompose({
  body,
  edit,
  send,
  discard,
  users,
  ready,
  busy,
  writable,
  resolved,
  issue,
  label = 'Timeline',
}: {
  body: string;
  edit(body: string): void;
  send(): void;
  discard(): void;
  users: { id: string; name: string; status: string }[];
  ready: boolean;
  busy: boolean;
  writable: boolean;
  resolved: boolean;
  issue: string | null;
  label?: string;
}) {
  const [validation, setValidation] = useState<string | null>(null);
  const submit = () => {
    const result = messageBodySchema.safeParse(body);
    if (!result.success) {
      setValidation('Write a message (1–4,000 characters).');
      return;
    }
    setValidation(null);
    send();
  };
  if (!writable)
    return (
      <p className="p-4" role="note">
        {resolved
          ? `Resolved incident: ${label} is read-only.`
          : `Read-only ${label}: participants, commander and admins may send messages.`}
      </p>
    );
  return (
    <form
      className="timeline-compose"
      aria-label={`${label} compose`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`${label}-body`} className="font-semibold">
        Message
      </label>
      <textarea
        id={`${label}-body`}
        className="incident-input mt-2"
        rows={3}
        maxLength={4000}
        value={body}
        disabled={!ready || busy}
        aria-describedby={`${label}-compose-help ${label}-compose-error`}
        aria-invalid={!!validation}
        onChange={(event) => {
          setValidation(null);
          edit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (!busy && ready) submit();
          }
        }}
      />
      <p id={`${label}-compose-help`} className="text-sm text-muted">
        Plain text · {body.length}/4,000 · Enter: newline · Ctrl/Cmd+Enter: Send
      </p>
      <p id={`${label}-compose-error`} role={validation || issue ? 'alert' : undefined}>
        {validation ?? issue}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          className="incident-button incident-primary"
          type="submit"
          disabled={!ready || busy}
        >
          Send
        </button>
        <button
          className="incident-button"
          type="button"
          disabled={!ready || busy || !body}
          onClick={discard}
        >
          Discard draft
        </button>
        <label className="text-sm">
          Mention{' '}
          <select
            className="incident-input"
            aria-label="Mention workspace user"
            value=""
            disabled={!ready || busy}
            onChange={(event) => {
              const user = users.find((candidate) => candidate.id === event.target.value);
              if (user)
                edit(
                  `${body}${body && !body.endsWith(' ') ? ' ' : ''}@${user.name} [${user.id}] `.slice(
                    0,
                    4000,
                  ),
                );
            }}
          >
            <option value="">Choose a person</option>
            {users
              .filter((user) => user.status === 'active')
              .slice(0, 200)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>
        </label>
      </div>
    </form>
  );
}
