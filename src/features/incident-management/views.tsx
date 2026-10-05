'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { AppError } from '@/shared/errors/app-error';
import type { WorkspaceUser } from '@/entities/current-user/model';
import {
  createIncidentSchema,
  severities,
  severityLabels,
  services,
  statuses,
  statusLabels,
  type CreateIncidentInput,
  type Incident,
} from '@/entities/incident/model';
import { emptyFilters, type IncidentFilters } from '@/entities/incident/filters';

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
export function IncidentFiltersView({
  filters,
  users,
  change,
}: {
  filters: IncidentFilters;
  users: WorkspaceUser[];
  change: (value: IncidentFilters) => void;
}) {
  return (
    <section
      aria-label="Incident filters"
      className="my-6 space-y-4 rounded-lg border border-line bg-canvas p-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset>
          <legend className="mb-2 font-semibold">Status</legend>
          <div className="flex flex-wrap gap-3">
            {statuses.map((value) => (
              <label key={value} className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.status.includes(value)}
                  onChange={(e) =>
                    change({
                      ...filters,
                      status: e.target.checked
                        ? [...filters.status, value]
                        : filters.status.filter((s) => s !== value),
                    })
                  }
                />
                {statusLabels[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 font-semibold">Severity</legend>
          <div className="flex flex-wrap gap-3">
            {severities.map((value) => (
              <label key={value} className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.severity.includes(value)}
                  onChange={(e) =>
                    change({
                      ...filters,
                      severity: e.target.checked
                        ? [...filters.severity, value]
                        : filters.severity.filter((s) => s !== value),
                    })
                  }
                />
                {value} · {severityLabels[value]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          Participant
          <select
            aria-label="Participant"
            className="incident-input"
            value={filters.participant}
            onChange={(e) => change({ ...filters, participant: e.target.value })}
          >
            <option value="">Any participant</option>
            {users
              .filter((u) => u.status === 'active')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="space-y-1">
          Created from (UTC)
          <input
            className="incident-input"
            type="date"
            value={filters.from}
            onChange={(e) => change({ ...filters, from: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          Created through (UTC)
          <input
            className="incident-input"
            type="date"
            value={filters.to}
            onChange={(e) => change({ ...filters, to: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          Sort
          <select
            aria-label="Sort"
            className="incident-input"
            value={filters.sort}
            onChange={(e) =>
              change({ ...filters, sort: e.target.value as IncidentFilters['sort'] })
            }
          >
            <option value="updated">Last updated</option>
            <option value="newest">Newest created</option>
            <option value="severity">Severity</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={filters.assignedToMe}
            onChange={(e) => change({ ...filters, assignedToMe: e.target.checked })}
          />
          Assigned to me
        </label>
        <button
          className="incident-button"
          onClick={() => change({ ...emptyFilters, sort: filters.sort })}
        >
          Clear filters
        </button>
      </div>
    </section>
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
      className="incident-dialog"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="create-incident-heading" className="text-2xl font-semibold">
          Create Incident
        </h2>
        <button
          className="incident-button"
          disabled={isSubmitting || sending}
          onClick={cancel}
          aria-label="Close Create Incident"
        >
          Close
        </button>
      </div>
      <p className="my-4 text-sm text-muted">
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
        className="space-y-4"
      >
        <fieldset disabled={isSubmitting || sending || !!ambiguous} className="min-w-0 space-y-4">
          <label className="block">
            Title (required)
            <input
              className="incident-input"
              {...register('title')}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'create-title-error' : undefined}
            />
          </label>
          {errors.title && (
            <p role="alert" id="create-title-error">
              {errors.title.message}
            </p>
          )}
          <label className="block">
            Description
            <textarea
              className="incident-input min-h-24"
              {...register('description')}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? 'create-description-error' : undefined}
            />
          </label>
          {errors.description && (
            <p role="alert" id="create-description-error">
              {errors.description.message}
            </p>
          )}
          <label className="block">
            Severity (required)
            <select
              className="incident-input"
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
            <p role="alert" id="create-severity-error">
              {errors.severity.message}
            </p>
          )}
          <fieldset>
            <legend className="font-semibold">Affected services</legend>
            {services.map((s) => (
              <label className="flex min-h-11 items-center gap-2" key={s.id}>
                <input type="checkbox" value={s.id} {...register('serviceIds')} />
                {s.label}
              </label>
            ))}
            {errors.serviceIds && <p role="alert">{errors.serviceIds.message}</p>}
          </fieldset>
          <fieldset>
            <legend className="font-semibold">Additional participants</legend>
            {users
              .filter((u) => u.status === 'active' && u.id !== creatorId)
              .map((u) => (
                <label className="flex min-h-11 items-center gap-2" key={u.id}>
                  <input type="checkbox" value={u.id} {...register('participantIds')} />
                  {u.name}
                </label>
              ))}
            {errors.participantIds && <p role="alert">{errors.participantIds.message}</p>}
          </fieldset>
        </fieldset>
        {failure && (
          <p ref={error} tabIndex={-1} role="alert">
            {failure}
            {ambiguous &&
              ' Fields are locked until this submission is confirmed; retry safely using the same submission.'}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            className="incident-button incident-primary"
            disabled={isSubmitting || sending}
            type="submit"
          >
            {isSubmitting || sending
              ? 'Creating…'
              : ambiguous
                ? 'Retry submission'
                : 'Create Incident'}
          </button>
          <button
            type="button"
            className="incident-button"
            disabled={isSubmitting || sending}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
