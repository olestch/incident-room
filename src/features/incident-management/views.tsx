'use client';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Button, IconButton, InlineAlert } from '@/shared/ui/primitives';
export { IncidentFiltersView } from './list-filters';
import { useEffect, useRef, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { AppError } from '@/shared/errors/app-error';
import type { WorkspaceUser } from '@/entities/current-user/model';
import {
  createIncidentSchema,
  severities,
  severityLabels,
  services,
  statusLabels,
  type CreateIncidentInput,
  type Incident,
} from '@/entities/incident/model';

export function IncidentContext({
  incident,
  users,
  detail = false,
}: {
  incident: Incident;
  users: WorkspaceUser[];
  detail?: boolean;
}) {
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unavailable workspace user';
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (!detail || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 48rem)');
    const sync = () => setExpanded(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [detail]);
  const metadata = (
    <>
      {detail && (
        <p className="whitespace-pre-wrap">{incident.description || 'No description provided.'}</p>
      )}
      <p>Commander: {name(incident.commanderId)}</p>
      <p className="text-sm">
        Services:{' '}
        {incident.serviceIds.map((id) => services.find((s) => s.id === id)?.label).join(', ') ||
          'None selected'}
      </p>
      <p className="text-sm">
        Participants ({incident.participantIds.length}):{' '}
        {(detail ? incident.participantIds : incident.participantIds.slice(0, 3))
          .map(name)
          .join(', ')}
        {!detail && incident.participantIds.length > 3
          ? ` and ${incident.participantIds.length - 3} more`
          : ''}
      </p>
      {detail && (
        <p className="text-sm">
          Created <IncidentTime value={incident.createdAt} />
        </p>
      )}
      <p className="text-sm text-muted">
        Updated <IncidentTime value={incident.updatedAt} />
      </p>
      {detail && incident.resolvedAt && (
        <p className="text-sm">
          Resolved <IncidentTime value={incident.resolvedAt} /> · Operational writes are closed.
        </p>
      )}
    </>
  );
  return (
    <div className="min-w-0 space-y-2 break-words">
      <p className={`text-sm font-semibold severity-${incident.severity}`}>
        <span>
          {incident.severity} · {severityLabels[incident.severity]}
        </span>{' '}
        <span className="ml-2 rounded border border-line px-2 py-1 text-ink">
          {statusLabels[incident.status]}
        </span>
      </p>
      {detail ? (
        <h1 tabIndex={-1} id="incident-heading" className="text-2xl font-semibold">
          {incident.number} · {incident.title}
        </h1>
      ) : (
        <h2 className="text-lg font-semibold">
          <Link className="underline" href={`/app/incidents/${incident.number}`}>
            {incident.number} · {incident.title}
          </Link>
        </h2>
      )}
      {detail ? (
        <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary className="cursor-pointer py-2 font-semibold">Incident context</summary>
          <div className="space-y-2">{metadata}</div>
        </details>
      ) : (
        metadata
      )}
    </div>
  );
}
export function IncidentTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(value))}{' '}
      UTC
    </time>
  );
}
const resolver =
  (users: WorkspaceUser[]): Resolver<CreateIncidentInput> =>
  (values) => {
    const result = createIncidentSchema.safeParse(values);
    if (result.success) {
      if (
        result.data.participantIds.some(
          (id) => !users.some((u) => u.id === id && u.status === 'active'),
        )
      )
        return {
          values: {},
          errors: {
            participantIds: {
              type: 'validation',
              message: 'Choose active workspace participants.',
            },
          },
        };
      return { values: result.data, errors: {} };
    }
    const errors: Partial<Record<keyof CreateIncidentInput, { type: string; message: string }>> =
      {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (
        field === 'title' ||
        field === 'description' ||
        field === 'severity' ||
        field === 'serviceIds' ||
        field === 'participantIds'
      )
        errors[field] ??= { type: 'validation', message: issue.message };
    }
    return { values: {}, errors };
  };
export function CreateIncidentDialog({
  users,
  creatorId,
  close,
  submit,
}: {
  users: WorkspaceUser[];
  creatorId: string;
  close: () => void;
  submit: (input: CreateIncidentInput, requestId: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  const pending = useRef(false);
  const requestId = useRef<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<CreateIncidentInput | null>(null);
  const [sending, setSending] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CreateIncidentInput>({
    resolver: resolver(users),
    defaultValues: { title: '', description: '', serviceIds: [], participantIds: [] },
  });
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>('[name="title"]')?.focus();
    return () => {
      element.close();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected)
        previouslyFocused.focus();
    };
  }, []);
  const cancel = () => {
    if (pending.current) return;
    if (
      (isDirty || ambiguous) &&
      !window.confirm(
        ambiguous
          ? 'The previous submission may have succeeded. Close and check the list before creating another incident?'
          : 'Discard this incident draft?',
      )
    )
      return;
    close();
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="create-incident-heading"
      className="creation-dialog"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, [tabindex="0"]',
          ),
        ).filter((element) => !element.matches(':disabled') && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (
          !first ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className="creation-header">
        <h2 id="create-incident-heading" className="text-section font-semibold">
          Create Incident
        </h2>
        <IconButton
          label="Close Create Incident"
          disabled={isSubmitting || sending}
          onClick={cancel}
        >
          <X size={20} aria-hidden="true" />
        </IconButton>
      </div>
      <p className="creation-intro">
        You will be commander and a participant. Status starts as Triggered.
      </p>
      <form
        aria-label="Create Incident"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const send = async (values: CreateIncidentInput) => {
            if (pending.current) return;
            pending.current = true;
            setSending(true);
            setFailure(null);
            requestId.current ??= crypto.randomUUID();
            try {
              await submit(ambiguous ?? values, requestId.current);
            } catch (issue) {
              if (issue instanceof DOMException && issue.name === 'AbortError') return;
              if (issue instanceof AppError && issue.category === 'network')
                setAmbiguous(ambiguous ?? values);
              setFailure(
                issue instanceof AppError ? issue.message : 'Unable to create incident. Try again.',
              );
              requestAnimationFrame(() => error.current?.focus());
            } finally {
              pending.current = false;
              setSending(false);
            }
          };
          if (ambiguous) void send(ambiguous);
          else void handleSubmit(send)(event);
        }}
        className="creation-form"
        aria-busy={isSubmitting || sending}
      >
        <div className="creation-body">
          <fieldset disabled={isSubmitting || sending || !!ambiguous} className="creation-fields">
            <label className="discovery-field">
              Title (required)
              <input
                className="creation-input"
                {...register('title')}
                aria-invalid={!!errors.title}
                aria-describedby={errors.title ? 'create-title-error' : undefined}
              />
            </label>
            {errors.title && (
              <p className="creation-field-error" role="alert" id="create-title-error">
                {errors.title.message}
              </p>
            )}
            <label className="discovery-field">
              <span>
                Description <span className="creation-optional">Optional</span>
              </span>
              <textarea
                aria-label="Description"
                className="creation-input creation-description"
                {...register('description')}
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? 'create-description-error' : undefined}
              />
            </label>
            {errors.description && (
              <p className="creation-field-error" role="alert" id="create-description-error">
                {errors.description.message}
              </p>
            )}
            <label className="discovery-field">
              Severity (required)
              <select
                className="creation-input"
                {...register('severity')}
                aria-invalid={!!errors.severity}
                aria-describedby={errors.severity ? 'create-severity-error' : undefined}
              >
                <option value="">Choose severity</option>
                {severities.map((s) => (
                  <option key={s} value={s}>
                    {s} · {severityLabels[s]}
                  </option>
                ))}
              </select>
            </label>
            {errors.severity && (
              <p className="creation-field-error" role="alert" id="create-severity-error">
                {errors.severity.message}
              </p>
            )}
            <fieldset
              aria-invalid={!!errors.serviceIds}
              aria-describedby={errors.serviceIds ? 'create-services-error' : undefined}
            >
              <legend>
                Affected services <span className="creation-optional">Optional</span>
              </legend>
              <div className="creation-options">
                {services.map((s) => (
                  <label className="creation-option" key={s.id}>
                    <input type="checkbox" value={s.id} {...register('serviceIds')} />
                    {s.label}
                  </label>
                ))}
              </div>
              {errors.serviceIds && (
                <p className="creation-field-error" id="create-services-error" role="alert">
                  {errors.serviceIds.message}
                </p>
              )}
            </fieldset>
            <fieldset
              aria-invalid={!!errors.participantIds}
              aria-describedby={errors.participantIds ? 'create-participants-error' : undefined}
            >
              <legend>
                Additional participants <span className="creation-optional">Optional</span>
              </legend>
              <div className="creation-options">
                {users
                  .filter((u) => u.status === 'active' && u.id !== creatorId)
                  .map((u) => (
                    <label className="creation-option" key={u.id}>
                      <input type="checkbox" value={u.id} {...register('participantIds')} />
                      {u.name}
                    </label>
                  ))}
              </div>
              {errors.participantIds && (
                <p className="creation-field-error" id="create-participants-error" role="alert">
                  {errors.participantIds.message}
                </p>
              )}
            </fieldset>
          </fieldset>
          {failure && (
            <InlineAlert>
              <p ref={error} tabIndex={-1}>
                {failure}
                {ambiguous &&
                  ' Fields are locked until this submission is confirmed; retry safely using the same submission.'}
              </p>
            </InlineAlert>
          )}
        </div>
        <div className="creation-footer">
          <Button type="button" variant="quiet" disabled={isSubmitting || sending} onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isSubmitting || sending} type="submit">
            {isSubmitting || sending
              ? 'Creating…'
              : ambiguous
                ? 'Retry submission'
                : 'Create Incident'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
