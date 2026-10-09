'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useConfirmation } from '@/shared/ui/confirmation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { useCommands } from '@/app/_discovery/commands-context';
import {
  currentUserKey,
  workspaceUsersKey,
  workspaceUsersSchema,
  type WorkspaceUser,
} from '@/entities/current-user/model';
import { incidentKeys, incidentSchema, type Incident } from '@/entities/incident/model';
import { canEditPostmortem, canInitiatePostmortem } from '@/entities/incident/policy';
import {
  postmortemKeys,
  postmortemDetailSchema,
  postmortemSchema,
  actionItemSchema,
  mergePostmortemDetail,
  type PostmortemDetail,
  type Postmortem,
  type ActionItem,
  type PostmortemFields,
  type ActionFields,
} from '@/entities/postmortem/model';
import { timelineWindowSchema, timelineEntrySchema } from '@/entities/timeline/model';
import {
  PostmortemEditor,
  StructuredSections,
  ActionEditor,
  ActionItemView,
} from '@/features/postmortem/views';
import { FileText, ListChecks, ArrowLeft, Link2 } from 'lucide-react';
import { Button, Badge, InlineAlert } from '@/shared/ui/primitives';
import { EmptyState, RowSkeletons } from '@/shared/ui/secondary-feedback';
import { TimelineEvidence } from '@/features/postmortem/evidence';
import { IncidentTime } from '@/features/incident-management/views';
import { AppError } from '@/shared/errors/app-error';

export function PostmortemPage({ number }: { number: string }) {
  const { state } = useSessionRuntime();
  if (!('identity' in state)) return null;
  return (
    <IdentityPostmortem
      key={`${state.generation}:${state.identity.userId}:${number}`}
      number={number}
      userId={state.identity.userId}
      workspaceId={state.identity.workspaceId}
    />
  );
}
function IdentityPostmortem({
  number,
  userId,
  workspaceId,
}: {
  number: string;
  userId: string;
  workspaceId: string;
}) {
  const { coordinator, adapter, state } = useSessionRuntime();
  const cache = useQueryClient();
  const commands = useCommands();
  const router = useRouter();
  const { request: requestConfirmation, dialog: leaveDialog } = useConfirmation();
  const dirty = useRef(new Set<string>());
  const setDirty = useCallback((id: string, value: boolean) => {
    if (value) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);
  const formChanged = useCallback((value: boolean) => setDirty('document', value), [setDirty]);
  const createChanged = useCallback((value: boolean) => setDirty('create', value), [setDirty]);
  const canLeave = useCallback(async () => {
    if (!dirty.current.size) return true;
    const discard = await requestConfirmation({
      title: 'Discard unsaved review changes?',
      description:
        'Your Postmortem and Action Item edits have not all been saved. Leaving will discard local fields; an in-flight save may still complete.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
    if (discard) dirty.current.clear();
    return discard;
  }, [requestConfirmation]);
  useEffect(() => commands?.registerLeave(canLeave), [commands, canLeave]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      const destination = new URL(anchor.href);
      if (
        destination.origin === location.origin &&
        destination.pathname === location.pathname &&
        destination.search === location.search
      )
        return;
      if (anchor.href !== location.href && dirty.current.size) {
        event.preventDefault();
        event.stopPropagation();
        void canLeave().then((allowed) => {
          if (!allowed) return;
          if (destination.origin === location.origin)
            router.push(destination.pathname + destination.search + destination.hash);
          else window.location.assign(destination.href);
        });
      }
    };
    window.addEventListener('beforeunload', unload);
    window.document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.document.removeEventListener('click', click, true);
    };
  }, [canLeave, router]);
  const read = <T,>(path: string, schema: z.ZodType<T>, signal: AbortSignal) =>
    coordinator.request((s) => adapter.resource(path, schema, s), 'safe-read', signal);
  const current = useQuery({
    queryKey: currentUserKey(userId, workspaceId),
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) => adapter.currentUser(s, 'identity' in state ? state.identity : undefined),
        'safe-read',
        signal,
      ),
  });
  const users = useQuery({
    queryKey: workspaceUsersKey(userId, workspaceId),
    queryFn: ({ signal }) =>
      read(
        '/workspace-users',
        workspaceUsersSchema.refine((records) =>
          records.every((user) => user.workspaceId === workspaceId),
        ),
        signal,
      ),
  });
  const incident = useQuery({
    queryKey: incidentKeys.detail(userId, workspaceId, number),
    queryFn: ({ signal }) =>
      read(
        `/incidents/${encodeURIComponent(number)}`,
        incidentSchema.refine(
          (value) => value.workspaceId === workspaceId && value.number === number,
        ),
        signal,
      ).then((value) => {
        const previous = cache.getQueryData<Incident>(
          incidentKeys.detail(userId, workspaceId, number),
        );
        return previous && previous.revision > value.revision ? previous : value;
      }),
  });
  const record = incident.data;
  const key = postmortemKeys.detail(userId, workspaceId, record?.id ?? '');
  const root = `/incidents/${encodeURIComponent(number)}/postmortem`;
  const detail = useQuery({
    queryKey: key,
    enabled: record?.status === 'resolved',
    queryFn: async ({ signal }) =>
      mergePostmortemDetail(
        cache.getQueryData<PostmortemDetail>(key),
        await read(
          root,
          postmortemDetailSchema.refine(
            (value) =>
              !value.postmortem ||
              (value.postmortem.incidentId === record?.id &&
                value.postmortem.workspaceId === workspaceId),
          ),
          signal,
        ),
      ),
  });
  const valid = () => {
    const snapshot = coordinator.snapshot();
    return (
      'identity' in snapshot &&
      snapshot.generation === state.generation &&
      snapshot.identity.userId === userId &&
      snapshot.identity.workspaceId === workspaceId
    );
  };
  type Operation =
    | { type: 'initiate' }
    | { type: 'save'; fields: PostmortemFields; revision: number }
    | { type: 'action-create'; fields: ActionFields; requestId: string }
    | { type: 'action-save'; fields: ActionFields; item: ActionItem; revision: number };
  const mutation = useMutation({
    retry: false,
    mutationFn: async (operation: Operation) => {
      const document = detail.data?.postmortem;
      const isAction = operation.type === 'action-create' || operation.type === 'action-save';
      const path =
        operation.type === 'initiate'
          ? '/initiate'
          : operation.type === 'save'
            ? '/save'
            : operation.type === 'action-create'
              ? '/actions/create'
              : '/actions/save';
      const body =
        operation.type === 'initiate'
          ? {}
          : operation.type === 'save'
            ? {
                postmortemId: document?.id,
                expectedRevision: operation.revision,
                fields: operation.fields,
              }
            : operation.type === 'action-create'
              ? {
                  postmortemId: document?.id,
                  requestId: operation.requestId,
                  fields: operation.fields,
                }
              : {
                  id: operation.item.id,
                  expectedRevision: operation.revision,
                  fields: operation.fields,
                };
      try {
        const result = await coordinator.request(
          (s) =>
            adapter.resource(
              root + path,
              isAction
                ? (actionItemSchema as z.ZodType<Postmortem | ActionItem>)
                : postmortemSchema,
              s,
              body,
            ),
          'mutation',
        );
        if (!valid()) throw new DOMException('Superseded identity', 'AbortError');
        if (
          result.incidentId !== record?.id ||
          result.workspaceId !== workspaceId ||
          (isAction && (!('postmortemId' in result) || result.postmortemId !== document?.id))
        )
          throw new AppError('validation', 'Resource scope mismatch.');
        cache.setQueryData<PostmortemDetail>(key, (previous) =>
          mergePostmortemDetail(previous, {
            postmortem: 'postmortemId' in result ? (previous?.postmortem ?? null) : result,
            items: 'postmortemId' in result ? [result] : [],
          }),
        );
        return result;
      } catch (error) {
        if (valid() && error instanceof AppError && error.category === 'conflict')
          await detail.refetch();
        throw error;
      }
    },
  });
  const [creationId, setCreationId] = useState('');
  const inaccessible = (error: Error | null) =>
    error instanceof AppError &&
    ['authorization', 'authentication', 'not-found'].includes(error.category);
  const failure = incident.error ?? users.error ?? current.error ?? detail.error;
  const unavailable = inaccessible(failure);
  if (!record || !users.data || !current.data || unavailable)
    return (
      <section className="secondary-page postmortem-page">
        {leaveDialog}
        <header className="secondary-page-header">
          <p className="secondary-eyebrow">Incident review</p>
          <h1>Postmortem</h1>
        </header>
        {failure ? (
          <InlineAlert>
            <p>
              {unavailable
                ? 'Postmortem not found or access denied.'
                : 'Unable to load Postmortem.'}
            </p>
            {!unavailable && (
              <Button
                onClick={() => {
                  void incident.refetch();
                  void users.refetch();
                  void current.refetch();
                }}
              >
                Retry Postmortem
              </Button>
            )}
          </InlineAlert>
        ) : (
          <RowSkeletons label="Loading Postmortem…" rows={4} />
        )}
      </section>
    );
  if (record.status !== 'resolved')
    return (
      <section className="secondary-page postmortem-page">
        {leaveDialog}
        <header className="secondary-page-header">
          <h1>Postmortem</h1>
        </header>
        <p role="alert">Postmortem is available only for Resolved incidents.</p>
        <Link href={`/app/incidents/${number}`} className="underline">
          Back to Incident Room
        </Link>
      </section>
    );
  const document = detail.data?.postmortem;
  const editable = canEditPostmortem(current.data, record, !!document);
  const name = (id: string) =>
    users.data?.find((user) => user.id === id)?.name ?? 'Unavailable user';
  return (
    <section className="secondary-page postmortem-page">
      {leaveDialog}
      <Link href={`/app/incidents/${number}`} className="secondary-text-link">
        <ArrowLeft size={16} aria-hidden="true" /> Back to Incident Room
      </Link>
      <header className="secondary-page-header postmortem-header">
        <p className="secondary-eyebrow">Incident review · {number}</p>
        <h1>{number} · Postmortem</h1>
        <p>{record.title}</p>
      </header>
      {detail.isPending && <RowSkeletons label="Loading Postmortem…" rows={4} />}
      {detail.isError && (
        <InlineAlert>
          <p>Unable to refresh Postmortem. Existing fields remain available.</p>
          <Button onClick={() => void detail.refetch()}>Retry Postmortem</Button>
        </InlineAlert>
      )}
      {detail.data && !document && (
        <div className="secondary-surface">
          <EmptyState icon={FileText} title="Start the shared review">
            <p>Postmortem has not been initiated.</p>
          </EmptyState>
          {canInitiatePostmortem(current.data, record) ? (
            <Button
              disabled={mutation.isPending}
              variant="primary"
              onClick={() => mutation.mutate({ type: 'initiate' })}
            >
              {mutation.isPending ? 'Initiating…' : 'Initiate Postmortem'}
            </Button>
          ) : (
            <p>Read-only. A commander or admin must initiate this shared draft.</p>
          )}
          {mutation.error && <p role="alert">{mutation.error.message}</p>}
        </div>
      )}
      {document && (
        <>
          <div className="postmortem-metadata">
            <p>
              Shared draft · Revision {document.revision} · Updated by {name(document.updatedBy)} ·{' '}
              <IncidentTime value={document.updatedAt} />
            </p>
            <Badge>{editable ? 'Editable' : 'Read-only'}</Badge>
          </div>
          {editable ? (
            <PostmortemEditor
              record={document}
              changed={formChanged}
              save={async (fields, revision) =>
                postmortemSchema.parse(
                  await mutation.mutateAsync({ type: 'save', fields, revision }),
                )
              }
              timeline={(ids, change) => (
                <TimelineSelection
                  ids={ids}
                  change={change}
                  record={record}
                  users={users.data!}
                  userId={userId}
                />
              )}
            />
          ) : (
            <>
              <p className="postmortem-read-only">
                Read-only · Workspace member viewing this Postmortem.
              </p>
              <StructuredSections fields={document} />
              <section className="postmortem-section postmortem-evidence">
                <h2 className="postmortem-section-title">Timeline</h2>
                <TimelineSelection
                  ids={document.timelineEntryIds}
                  record={record}
                  users={users.data}
                  userId={userId}
                />
              </section>
            </>
          )}
          <section className="postmortem-actions">
            <h2 className="postmortem-section-title">Action Items</h2>
            <p className="text-sm text-muted">
              Follow-up work from this review. Assign an owner, set a calendar due date and track
              progress.
            </p>
            {!detail.data?.items.length && (
              <EmptyState icon={ListChecks} title="No Action Items yet">
                <p>Add a concrete follow-up when the review identifies one.</p>
              </EmptyState>
            )}
            {detail.data?.items.map((item) =>
              editable ? (
                <ExistingAction
                  key={item.id}
                  item={item}
                  users={users.data!}
                  setDirty={setDirty}
                  save={async (fields, revision) =>
                    actionItemSchema.parse(
                      await mutation.mutateAsync({ type: 'action-save', item, fields, revision }),
                    )
                  }
                />
              ) : (
                <ActionItemView key={item.id} item={item} users={users.data!} />
              ),
            )}
            {editable &&
              (creationId ? (
                <ActionEditor
                  key={creationId}
                  users={users.data}
                  changed={createChanged}
                  save={async (fields) => {
                    const result = actionItemSchema.parse(
                      await mutation.mutateAsync({
                        type: 'action-create',
                        fields,
                        requestId: creationId,
                      }),
                    );
                    setCreationId('');
                    return result;
                  }}
                />
              ) : (
                <Button onClick={() => setCreationId(crypto.randomUUID())}>Add Action Item</Button>
              ))}
          </section>
        </>
      )}
    </section>
  );
}
function ExistingAction({
  item,
  users,
  setDirty,
  save,
}: {
  item: ActionItem;
  users: WorkspaceUser[];
  setDirty: (id: string, dirty: boolean) => void;
  save: (fields: ActionFields, revision: number) => Promise<ActionItem>;
}) {
  const changed = useCallback((value: boolean) => setDirty(item.id, value), [item.id, setDirty]);
  return (
    <ActionEditor
      initiallyExpanded={false}
      item={item}
      users={users}
      save={save}
      changed={changed}
    />
  );
}
function TimelineSelection({
  ids,
  change,
  record,
  users,
  userId,
}: {
  ids: string[];
  change?: (ids: string[]) => void;
  record: Incident;
  users: WorkspaceUser[];
  userId: string;
}) {
  const { coordinator, adapter } = useSessionRuntime();
  const [browse, setBrowse] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const selected = useQuery({
    queryKey: [...postmortemKeys.references(userId, record.workspaceId, record.id), ids],
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) =>
          adapter.resource(
            `/incidents/${record.number}/postmortem/references?${new URLSearchParams(ids.map((entry) => ['entry', entry]))}`,
            z
              .array(timelineEntrySchema)
              .max(100)
              .refine((entries) =>
                entries.every((entry) => entry.incidentId === record.id && ids.includes(entry.id)),
              ),
            s,
          ),
        'safe-read',
        signal,
      ),
  });
  const candidates = useQuery({
    queryKey: [
      ...postmortemKeys.references(userId, record.workspaceId, record.id),
      'candidates',
      cursor,
    ],
    enabled: browse,
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) =>
          adapter.resource(
            `/incidents/${record.number}/timeline${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
            timelineWindowSchema.refine((window) =>
              window.items.every((entry) => entry.incidentId === record.id),
            ),
            s,
          ),
        'safe-read',
        signal,
      ),
  });
  return (
    <div className="evidence-selection">
      <p>
        Link source events as evidence for this review. Up to 100 references; removing one keeps the
        source event.
      </p>
      {selected.isPending && (
        <RowSkeletons label="Loading selected Timeline references…" rows={2} />
      )}
      {selected.error && (
        <p role="alert">
          Unable to load selected references.{' '}
          <Button type="button" className="underline" onClick={() => void selected.refetch()}>
            Retry references
          </Button>
        </p>
      )}
      {!ids.length && <p>No Timeline entries selected.</p>}
      <ol aria-label="Selected Timeline entries" className="evidence-list">
        {selected.data?.map((entry) => (
          <li key={entry.id} className="evidence-row">
            <IncidentTime value={entry.occurredAt} />
            <TimelineEvidence entry={entry} users={users} />
            <Link
              className="secondary-text-link"
              href={`/app/incidents/${record.number}?event=${encodeURIComponent(entry.id)}`}
            >
              <Link2 size={15} aria-hidden="true" /> View source event
            </Link>
            {change && (
              <Button
                type="button"
                variant="quiet"
                onClick={() => change(ids.filter((id) => id !== entry.id))}
              >
                Remove reference
              </Button>
            )}
          </li>
        ))}
        {selected.data &&
          ids
            .filter((id) => !selected.data.some((entry) => entry.id === id))
            .map((id) => (
              <li key={id} className="evidence-row evidence-unavailable">
                Source event unavailable.
                {change && (
                  <Button
                    type="button"

                    onClick={() => change(ids.filter((value) => value !== id))}
                  >
                    Remove unavailable reference
                  </Button>
                )}
              </li>
            ))}
      </ol>
      {change && (
        <>
          <Button type="button" onClick={() => setBrowse(!browse)}>
            {browse ? 'Hide Timeline selection' : 'Select Timeline entries'}
          </Button>
          {browse && (
            <div>
              {candidates.isPending && <p role="status">Loading Timeline choices…</p>}
              {candidates.error && (
                <p role="alert">
                  Timeline choices unavailable.{' '}
                  <Button
                    type="button"
                    className="underline"
                    onClick={() => void candidates.refetch()}
                  >
                    Retry choices
                  </Button>
                </p>
              )}
              <ul aria-label="Timeline choices" className="evidence-choices">
                {candidates.data?.items.map((entry) => (
                  <li key={entry.id} className="evidence-row">
                    <label className="evidence-checkbox">
                      <input
                        type="checkbox"
                        aria-label={`Include ${entry.id}`}
                        checked={ids.includes(entry.id)}
                        disabled={!ids.includes(entry.id) && ids.length >= 100}
                        onChange={(event) =>
                          change(
                            event.target.checked
                              ? [...ids, entry.id]
                              : ids.filter((id) => id !== entry.id),
                          )
                        }
                      />{' '}
                      Include event {entry.important ? '· Important' : ''}
                    </label>
                    <IncidentTime value={entry.occurredAt} />
                    <TimelineEvidence entry={entry} users={users} />
                  </li>
                ))}
              </ul>
              {candidates.data?.olderCursor && (
                <Button
                  type="button"
                  className="secondary-more"
                  onClick={() => setCursor(candidates.data!.olderCursor)}
                >
                  Older Timeline choices
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
