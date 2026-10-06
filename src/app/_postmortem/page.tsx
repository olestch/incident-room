'use client';
import Link from 'next/link';
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
import { EntryContent } from '@/features/timeline/views';
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
  const dirty = useRef(new Set<string>());
  const setDirty = useCallback((id: string, value: boolean) => {
    if (value) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);
  const formChanged = useCallback((value: boolean) => setDirty('document', value), [setDirty]);
  const createChanged = useCallback((value: boolean) => setDirty('create', value), [setDirty]);
  const canLeave = useCallback(
    () =>
      dirty.current.size === 0 ||
      window.confirm('Leave this Postmortem and discard unsaved fields?'),
    [],
  );
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
      if (anchor.href !== location.href && !canLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    window.document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.document.removeEventListener('click', click, true);
    };
  }, [canLeave]);
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
      <section>
        <h1 className="text-3xl font-semibold">Postmortem</h1>
        {failure ? (
          <div role="alert">
            <p>
              {unavailable
                ? 'Postmortem not found or access denied.'
                : 'Unable to load Postmortem.'}
            </p>
            {!unavailable && (
              <button
                className="incident-button"
                onClick={() => {
                  void incident.refetch();
                  void users.refetch();
                  void current.refetch();
                }}
              >
                Retry Postmortem
              </button>
            )}
          </div>
        ) : (
          <p role="status">Loading Postmortem…</p>
        )}
      </section>
    );
  if (record.status !== 'resolved')
    return (
      <section>
        <h1>Postmortem</h1>
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
    <section className="mx-auto max-w-3xl min-w-0 space-y-5 break-words">
      <Link href={`/app/incidents/${number}`} className="underline">
        Back to Incident Room
      </Link>
      <h1 className="text-3xl font-semibold">{number} · Postmortem</h1>
      {detail.isPending && <p role="status">Loading Postmortem…</p>}
      {detail.isError && (
        <div role="alert">
          <p>Unable to refresh Postmortem. Existing fields remain available.</p>
          <button className="incident-button" onClick={() => void detail.refetch()}>
            Retry Postmortem
          </button>
        </div>
      )}
      {detail.data && !document && (
        <div>
          <p>Postmortem has not been initiated.</p>
          {canInitiatePostmortem(current.data, record) ? (
            <button
              disabled={mutation.isPending}
              className="incident-button incident-primary mt-3"
              onClick={() => mutation.mutate({ type: 'initiate' })}
            >
              {mutation.isPending ? 'Initiating…' : 'Initiate Postmortem'}
            </button>
          ) : (
            <p>Read-only. A commander or admin must initiate this shared draft.</p>
          )}
          {mutation.error && <p role="alert">{mutation.error.message}</p>}
        </div>
      )}
      {document && (
        <>
          <p>
            Shared draft · Revision {document.revision} · Updated by {name(document.updatedBy)} ·{' '}
            <IncidentTime value={document.updatedAt} />
          </p>
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
              <p>Read-only · Workspace member viewing this Postmortem.</p>
              <StructuredSections fields={document} />
              <section>
                <h2 className="text-xl font-semibold">Timeline</h2>
                <TimelineSelection
                  ids={document.timelineEntryIds}
                  record={record}
                  users={users.data}
                  userId={userId}
                />
              </section>
            </>
          )}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Action Items</h2>
            <p className="text-sm text-muted">
              Date-only calendar dates, no timezone conversion. Open → In progress → Done; any
              explicit status change is supported. No deletion.
            </p>
            {!detail.data?.items.length && <p>No Action Items yet.</p>}
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
                <button
                  className="incident-button"
                  onClick={() => setCreationId(crypto.randomUUID())}
                >
                  Add Action Item
                </button>
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
  return <ActionEditor item={item} users={users} save={save} changed={changed} />;
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
    <div className="space-y-3">
      <p>
        References to source events, ordered by authoritative occurrence time. Up to 100 selections;
        removing a reference does not delete its source.
      </p>
      {selected.isPending && <p role="status">Loading selected Timeline references…</p>}
      {selected.error && (
        <p role="alert">
          Unable to load selected references.{' '}
          <button type="button" className="underline" onClick={() => void selected.refetch()}>
            Retry references
          </button>
        </p>
      )}
      {!ids.length && <p>No Timeline entries selected.</p>}
      <ol aria-label="Selected Timeline entries" className="space-y-3">
        {selected.data?.map((entry) => (
          <li key={entry.id} className="rounded border border-line p-3">
            <IncidentTime value={entry.occurredAt} />
            <EntryContent entry={entry} users={users} />
            <Link
              className="underline"
              href={`/app/incidents/${record.number}?event=${encodeURIComponent(entry.id)}`}
            >
              View source event
            </Link>
            {change && (
              <button
                type="button"
                className="incident-button ml-2"
                onClick={() => change(ids.filter((id) => id !== entry.id))}
              >
                Remove reference
              </button>
            )}
          </li>
        ))}
        {selected.data &&
          ids
            .filter((id) => !selected.data.some((entry) => entry.id === id))
            .map((id) => (
              <li key={id}>
                Source event unavailable.
                {change && (
                  <button
                    type="button"
                    className="incident-button"
                    onClick={() => change(ids.filter((value) => value !== id))}
                  >
                    Remove unavailable reference
                  </button>
                )}
              </li>
            ))}
      </ol>
      {change && (
        <>
          <button type="button" className="incident-button" onClick={() => setBrowse(!browse)}>
            {browse ? 'Hide Timeline selection' : 'Select Timeline entries'}
          </button>
          {browse && (
            <div>
              {candidates.isPending && <p role="status">Loading Timeline choices…</p>}
              {candidates.error && (
                <p role="alert">
                  Timeline choices unavailable.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void candidates.refetch()}
                  >
                    Retry choices
                  </button>
                </p>
              )}
              <ul aria-label="Timeline choices" className="max-h-96 space-y-3 overflow-y-auto">
                {candidates.data?.items.map((entry) => (
                  <li key={entry.id} className="rounded border border-line p-3">
                    <label className="block">
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
                    <EntryContent entry={entry} users={users} />
                  </li>
                ))}
              </ul>
              {candidates.data?.olderCursor && (
                <button
                  type="button"
                  className="incident-button mt-2"
                  onClick={() => setCursor(candidates.data!.olderCursor)}
                >
                  Older Timeline choices
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
