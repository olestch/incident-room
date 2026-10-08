'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AtSign, Send, X } from 'lucide-react';
import { Button, InlineAlert } from './primitives';
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
  const mentionId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const fitEditor = useCallback(() => {
    const field = editor.current;
    if (!field) return;
    field.style.height = '0px';
    field.style.height = `${field.scrollHeight}px`;
  }, []);
  useLayoutEffect(() => fitEditor(), [body, writable, fitEditor]);
  useEffect(() => {
    const field = editor.current;
    if (!field) return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === field.clientWidth) return;
      width = field.clientWidth;
      fitEditor();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [writable, fitEditor]);
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
      <label htmlFor={`${label}-body`} className="sr-only">
        Message
      </label>
      <textarea
        ref={editor}
        id={`${label}-body`}
        className="incident-input compose-editor"
        rows={1}
        placeholder={label === 'Timeline' ? 'Write an incident update…' : 'Write a Thread reply…'}
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
      <p id={`${label}-compose-help`} className="compose-help">
        Plain text · {body.length}/4,000
        <span className="compose-shortcuts"> · Enter: newline · Ctrl/Cmd+Enter: Send</span>
      </p>
      <div id={`${label}-compose-error`}>
        {(validation || issue) && <InlineAlert>{validation ?? issue}</InlineAlert>}
      </div>
      <div className="compose-actions">
        <Button
          variant="quiet"
          aria-label="Mention"
          popoverTarget={mentionId}
          disabled={!ready || busy}
        >
          <AtSign size={16} aria-hidden="true" />
          <span className="compose-mention-label">Mention</span>
        </Button>
        <Button variant="quiet" disabled={!ready || busy || !body} onClick={discard}>
          Discard draft
        </Button>
        <span className="compose-draft">
          {!ready ? 'Restoring local draft…' : busy ? 'Saving locally…' : body ? 'Local draft' : ''}
        </span>
        <Button variant="primary" type="submit" disabled={!ready || busy}>
          <Send size={16} aria-hidden="true" />
          Send
        </Button>
      </div>
      <div
        id={mentionId}
        ref={picker}
        popover="auto"
        className="mention-picker"
        aria-label="Mention picker"
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
        onToggle={(event) => {
          if (event.newState === 'open') event.currentTarget.querySelector('select')?.focus();
        }}
      >
        <div className="mention-picker-heading">
          <strong>Mention a workspace user</strong>
          <Button
            variant="quiet"
            aria-label="Close mentions"
            popoverTarget={mentionId}
            popoverTargetAction="hide"
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        <label>
          Workspace user
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
              picker.current?.hidePopover();
              editor.current?.focus({ preventScroll: true });
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
