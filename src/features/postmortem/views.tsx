'use client';
import { useEffect, useId, useRef, useState, type ReactNode, type BaseSyntheticEvent } from 'react';
import {
  useForm,
  type Resolver,
  type FieldValues,
  type DefaultValues,
  type FieldErrors,
} from 'react-hook-form';
import { z } from 'zod';
import { AppError } from '@/shared/errors/app-error';
import { SafeText } from '@/shared/ui/safe-text';
import type { WorkspaceUser } from '@/entities/current-user/model';
import {
  sections,
  postmortemFieldsSchema,
  actionFieldsSchema,
  emptyActionFields,
  type Postmortem,
  type PostmortemFields,
  type ActionItem,
  type ActionFields,
} from '@/entities/postmortem/model';

function resolver<T extends FieldValues>(schema: z.ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    return {
      values: {},
      errors: Object.fromEntries(
        result.error.issues.map((issue) => [
          String(issue.path[0]),
          { type: 'validation', message: issue.message },
        ]),
      ) as FieldErrors<T>,
    };
  };
}
function useRevisionForm<T extends FieldValues, R extends T & { revision: number }>(
  record: R,
  schema: z.ZodType<T>,
  save: (fields: T, revision: number) => Promise<R>,
  changed: (dirty: boolean) => void,
) {
  const form = useForm<T>({
    defaultValues: record as DefaultValues<T>,
    resolver: resolver(schema),
  });
  const [base, setBase] = useState(record.revision);
  const [issue, setIssue] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState(false);
  const [localCopy, setLocalCopy] = useState<T | null>(null);
  const busy = useRef(false);
  const dirty = form.formState.isDirty;
  useEffect(() => {
    changed(dirty);
    return () => changed(false);
  }, [dirty, changed]);
  useEffect(() => {
    if (!dirty && !busy.current && record.revision > base) {
      form.reset(record);
      setBase(record.revision);
      setIssue(null);
      setSaved(false);
    }
  }, [record, base, dirty, form]);
  const submit = (event?: BaseSyntheticEvent) =>
    form.handleSubmit(async (fields) => {
      if (busy.current) return;
      busy.current = true;
      setIssue(null);
      setSaved(false);
      try {
        const confirmed = await save(fields, base);
        form.reset(confirmed);
        setBase(confirmed.revision);
        setSaved(true);
        setReview(false);
      } catch (error) {
        setIssue(error instanceof Error ? error : new AppError('unexpected', 'Save failed.'));
      } finally {
        busy.current = false;
      }
    })(event);
  const newer =
    record.revision > base || (issue instanceof AppError && issue.category === 'conflict');
  const reload = () => {
    if (newer && record.revision <= base) return;
    if (
      dirty &&
      !window.confirm(
        'Replace unsaved fields with the latest version? A local reference copy will remain on this page.',
      )
    )
      return;
    if (dirty) setLocalCopy(form.getValues());
    form.reset(record);
    setBase(record.revision);
    setIssue(null);
    setReview(false);
    setSaved(false);
  };
  return { form, base, issue, saved, review, setReview, localCopy, newer, reload, submit };
}
function RevisionFeedback({
  newer,
  issue,
  saved,
  saving,
  review,
  setReview,
  reload,
  latest,
  localCopy,
}: {
  newer: boolean;
  issue: Error | null;
  saved: boolean;
  saving: boolean;
  review: boolean;
  setReview: (value: boolean) => void;
  reload: () => void;
  latest: ReactNode;
  localCopy: ReactNode;
}) {
  return (
    <>
      {newer && (
        <div role="alert" className="rounded-lg border border-line p-3">
          <p>
            A newer server revision exists. Your unsaved fields are preserved; saving this older
            version will conflict.
          </p>
          <button
            type="button"
            className="incident-button mr-2 mt-2"
            onClick={() => setReview(!review)}
          >
            Review latest
          </button>
          <button type="button" className="incident-button mt-2" disabled={saving} onClick={reload}>
            Reload latest
          </button>
          {review && (
            <div className="mt-3" aria-label="Latest server version">
              {latest}
            </div>
          )}
        </div>
      )}
      {issue && (
        <p role="alert">
          {issue instanceof AppError
            ? issue.message
            : 'Save failed. Your local edits remain in the form.'}
        </p>
      )}
      <p role="status">
        {saving
          ? 'Saving…'
          : saved
            ? 'Saved.'
            : 'Explicit Save only. Unsaved fields stay on this page until navigation.'}
      </p>
      {localCopy && (
        <details className="rounded border border-line p-3">
          <summary>Retained local reference (not saved)</summary>
          {localCopy}
        </details>
      )}
    </>
  );
}
export function StructuredSections({ fields }: { fields: PostmortemFields }) {
  return (
    <div className="space-y-3">
      {sections.map(([key, label]) => (
        <section key={key}>
          <h3 className="font-semibold">{label}</h3>
          <p className="whitespace-pre-wrap break-words">
            <SafeText text={fields[key] || 'Not yet written.'} />
          </p>
        </section>
      ))}
    </div>
  );
}
export function PostmortemEditor({
  record,
  save,
  changed,
  timeline,
}: {
  record: Postmortem;
  save: (fields: PostmortemFields, revision: number) => Promise<Postmortem>;
  changed: (dirty: boolean) => void;
  timeline: (ids: string[], change: (ids: string[]) => void) => ReactNode;
}) {
  const editor = useRevisionForm<PostmortemFields, Postmortem>(
    record,
    postmortemFieldsSchema,
    save,
    changed,
  );
  const id = useId();
  const { register, formState, watch, setValue } = editor.form;
  return (
    <form aria-label="Postmortem editor" onSubmit={editor.submit} className="space-y-5 min-w-0">
      <p>Shared draft · Based on revision {editor.base}</p>
      <RevisionFeedback
        {...editor}
        saving={formState.isSubmitting}
        latest={
          <>
            <StructuredSections fields={record} />
            <p>Timeline: {record.timelineEntryIds.join(', ') || 'No entries selected.'}</p>
          </>
        }
        localCopy={
          editor.localCopy ? (
            <>
              <StructuredSections fields={editor.localCopy} />
              <p>Timeline: {editor.localCopy.timelineEntryIds.join(', ')}</p>
            </>
          ) : null
        }
      />
      <fieldset disabled={formState.isSubmitting} className="space-y-5 min-w-0">
        {sections.map(([key, label, help]) => (
          <section key={key}>
            <h2 className="text-xl font-semibold">
              <label htmlFor={`${id}-${key}`}>{label}</label>
            </h2>
            <p id={`${id}-${key}-help`} className="text-sm text-muted">
              {help} Plain text, up to 8,000 characters.
            </p>
            <textarea
              id={`${id}-${key}`}
              {...register(key)}
              rows={5}
              className="mt-2 w-full min-w-0 rounded border border-line p-3"
              aria-describedby={`${id}-${key}-help ${id}-${key}-error`}
              aria-invalid={!!formState.errors[key]}
            />
            <p id={`${id}-${key}-error`} role={formState.errors[key] ? 'alert' : undefined}>
              {formState.errors[key]?.message}
            </p>
          </section>
        ))}
        <section>
          <h2 className="text-xl font-semibold">Timeline</h2>
          {timeline(watch('timelineEntryIds'), (ids) =>
            setValue('timelineEntryIds', ids, { shouldDirty: true, shouldValidate: true }),
          )}
          {formState.errors.timelineEntryIds && (
            <p role="alert">{formState.errors.timelineEntryIds.message}</p>
          )}
        </section>
        <button className="incident-button incident-primary" type="submit">
          Save Postmortem
        </button>
      </fieldset>
    </form>
  );
}
function ActionSnapshot({ fields }: { fields: ActionFields }) {
  return (
    <div className="break-words">
      <p className="font-semibold">{fields.title}</p>
      <p className="whitespace-pre-wrap">
        <SafeText text={fields.description} />
      </p>
      <p>
        Status: {fields.status.replaceAll('_', ' ')} · Assignee:{' '}
        {fields.assigneeUserId ?? 'Unassigned'} · Due: {fields.dueDate ?? 'None'}
      </p>
    </div>
  );
}
export function ActionEditor({
  item,
  users,
  save,
  changed,
}: {
  item?: ActionItem;
  users: WorkspaceUser[];
  save: (fields: ActionFields, revision: number) => Promise<ActionItem>;
  changed: (dirty: boolean) => void;
}) {
  const [initial] = useState(() => ({ ...emptyActionFields(), revision: 1 }));
  const editor = useRevisionForm<ActionFields, ActionFields & { revision: number }>(
    item ?? initial,
    actionFieldsSchema,
    save,
    changed,
  );
  const id = useId();
  const { register, formState } = editor.form;
  return (
    <form
      aria-label={item ? `Edit Action Item ${item.title}` : 'Create Action Item'}
      onSubmit={editor.submit}
      className="space-y-3 rounded-lg border border-line p-4 min-w-0"
    >
      <h3 className="font-semibold">
        {item ? `Action Item · revision ${editor.base}` : 'New Action Item'}
      </h3>
      <RevisionFeedback
        {...editor}
        saving={formState.isSubmitting}
        latest={item ? <ActionSnapshot fields={item} /> : null}
        localCopy={editor.localCopy ? <ActionSnapshot fields={editor.localCopy} /> : null}
      />
      <fieldset disabled={formState.isSubmitting} className="space-y-3 min-w-0">
        <div>
          <label htmlFor={`${id}-title`}>Action title</label>
          <input
            id={`${id}-title`}
            {...register('title')}
            className="block w-full rounded border border-line p-2"
            aria-invalid={!!formState.errors.title}
            aria-describedby={`${id}-title-error`}
          />
          <p id={`${id}-title-error`} role={formState.errors.title ? 'alert' : undefined}>
            {formState.errors.title?.message}
          </p>
        </div>
        <div>
          <label htmlFor={`${id}-description`}>Action description</label>
          <textarea
            id={`${id}-description`}
            {...register('description')}
            rows={3}
            className="block w-full rounded border border-line p-2"
            aria-invalid={!!formState.errors.description}
            aria-describedby={`${id}-description-error`}
          />
          <p
            id={`${id}-description-error`}
            role={formState.errors.description ? 'alert' : undefined}
          >
            {formState.errors.description?.message}
          </p>
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          <div>
            <label htmlFor={`${id}-assignee`}>Assignee</label>
            <select
              id={`${id}-assignee`}
              {...register('assigneeUserId', { setValueAs: (value: string) => value || null })}
              className="block w-full min-w-0 rounded border border-line p-2"
            >
              <option value="">Unassigned</option>
              {item?.assigneeUserId &&
                !users.some(
                  (user) => user.id === item.assigneeUserId && user.status === 'active',
                ) && (
                  <option value={item.assigneeUserId} disabled>
                    Unavailable assignee — choose another
                  </option>
                )}
              {users
                .filter((user) => user.status === 'active')
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-due`}>Due date</label>
            <input
              type="date"
              id={`${id}-due`}
              {...register('dueDate', { setValueAs: (value: string) => value || null })}
              className="block w-full min-w-0 rounded border border-line p-2"
              aria-invalid={!!formState.errors.dueDate}
              aria-describedby={`${id}-due-error`}
            />
            <p id={`${id}-due-error`} role={formState.errors.dueDate ? 'alert' : undefined}>
              {formState.errors.dueDate?.message}
            </p>
          </div>
          <div>
            <label htmlFor={`${id}-status`}>Action status</label>
            <select
              id={`${id}-status`}
              {...register('status')}
              className="block w-full min-w-0 rounded border border-line p-2"
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>
        <button type="submit" className="incident-button">
          {item ? 'Save Action Item' : 'Create Action Item'}
        </button>
      </fieldset>
    </form>
  );
}
export function ActionItemView({ item, users }: { item: ActionItem; users: WorkspaceUser[] }) {
  return (
    <article className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">{item.title}</h3>
      <p className="whitespace-pre-wrap break-words">
        <SafeText text={item.description} />
      </p>
      <p>
        Status: {item.status.replaceAll('_', ' ')} · Assignee:{' '}
        {users.find((user) => user.id === item.assigneeUserId)?.name ?? 'Unassigned or unavailable'}{' '}
        · Due: {item.dueDate ?? 'None'}
      </p>
    </article>
  );
}
