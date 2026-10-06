import { z } from 'zod';
import { type Incident } from '@/entities/incident/model';
import {
  canViewIncident,
  canInitiatePostmortem,
  canEditPostmortem,
  type IncidentActor,
} from '@/entities/incident/policy';
import {
  postmortemSchema,
  actionItemSchema,
  savePostmortemSchema,
  saveActionSchema,
  createActionSchema,
  emptyPostmortemFields,
} from '@/entities/postmortem/model';
import { type WorkspaceUser } from '@/entities/current-user/model';
import { AppError } from '@/shared/errors/app-error';
import { IndexedDbAtomicStore, type AtomicStore } from '@/shared/persistence/atomic-store';

const changeSchema = z.discriminatedUnion('resourceType', [
  z.object({
    resourceType: z.literal('postmortem'),
    payload: postmortemSchema,
    initiated: z.boolean(),
    actorId: z.string(),
    number: z.string(),
    recipients: z.array(z.string()),
  }),
  z.object({
    resourceType: z.literal('action_item'),
    payload: actionItemSchema,
    assigned: z.boolean(),
    actorId: z.string(),
    number: z.string(),
  }),
]);
export const postmortemAuthoritySchema = z.object({
  documents: z.array(postmortemSchema),
  items: z.array(actionItemSchema),
  changes: z.array(changeSchema),
  receipts: z.record(z.string(), z.object({ id: z.string(), fingerprint: z.string() })),
});
export type PostmortemData = z.infer<typeof postmortemAuthoritySchema>;
export const seedPostmortems = (): PostmortemData => ({
  documents: [],
  items: [],
  changes: [],
  receipts: {},
});
export const makePostmortemStore = () =>
  new IndexedDbAtomicStore('incident-room-fictional-postmortems-v1', seedPostmortems, (raw) =>
    postmortemAuthoritySchema.parse(raw),
  );
export class MockPostmortemAuthority {
  constructor(
    private readonly store: AtomicStore<PostmortemData>,
    private readonly references: (
      actor: IncidentActor,
      incident: Incident,
      ids: string[],
    ) => Promise<string[]>,
    private readonly now = Date.now,
  ) {}
  private workspace(actor: IncidentActor, incident?: Incident) {
    if (actor.status !== 'active' || (incident && !canViewIncident(actor, incident)))
      throw new AppError('authorization', 'Postmortem access denied.', 403);
    if (incident && incident.status !== 'resolved')
      throw new AppError(
        'authorization',
        'Postmortem is available only for Resolved incidents.',
        403,
      );
    return actor.workspaceId;
  }
  private document(data: PostmortemData, actor: IncidentActor, incident: Incident) {
    const document = data.documents.find((record) => record.incidentId === incident.id);
    if (!document) throw new AppError('not-found', 'Postmortem has not been initiated.', 404);
    if (!canEditPostmortem(actor, incident, true))
      throw new AppError('authorization', 'Postmortem edit permission is required.', 403);
    return document;
  }
  async detail(actor: IncidentActor, incident: Incident) {
    return this.store.transact(this.workspace(actor, incident), (data) => ({
      postmortem: data.documents.find((record) => record.incidentId === incident.id) ?? null,
      items: data.items.filter((item) => item.incidentId === incident.id),
    }));
  }
  async initiate(actor: IncidentActor, incident: Incident) {
    return this.store.transact(this.workspace(actor, incident), (data) => {
      // Check initiation permission before returning an existing resource on an ambiguous retry.
      if (!canInitiatePostmortem(actor, incident))
        throw new AppError('authorization', 'Commander or admin initiation is required.', 403);
      const existing = data.documents.find((record) => record.incidentId === incident.id);
      if (existing) return existing;
      const time = new Date(this.now()).toISOString();
      const record = postmortemSchema.parse({
        ...emptyPostmortemFields(),
        id: crypto.randomUUID(),
        incidentId: incident.id,
        workspaceId: actor.workspaceId,
        status: 'draft',
        revision: 1,
        createdAt: time,
        updatedAt: time,
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      data.documents.push(record);
      data.changes.push({
        resourceType: 'postmortem',
        payload: record,
        initiated: true,
        actorId: actor.id,
        number: incident.number,
        recipients: [...incident.participantIds, incident.commanderId],
      });
      return record;
    });
  }
  async save(actor: IncidentActor, incident: Incident, raw: unknown) {
    const workspace = this.workspace(actor, incident);
    if (!canEditPostmortem(actor, incident, true))
      throw new AppError('authorization', 'Postmortem edit permission is required.', 403);
    const input = savePostmortemSchema.parse(raw);
    const ids = await this.references(actor, incident, input.fields.timelineEntryIds);
    return this.store.transact(workspace, (data) => {
      const record = this.document(data, actor, incident);
      if (record.id !== input.postmortemId)
        throw new AppError('not-found', 'Postmortem unavailable.', 404);
      if (record.revision !== input.expectedRevision)
        throw new AppError(
          'conflict',
          'A newer Postmortem revision exists. Your local edits were not saved.',
          409,
        );
      const next = postmortemSchema.parse({
        ...record,
        ...input.fields,
        timelineEntryIds: ids,
        revision: record.revision + 1,
        updatedAt: new Date(this.now()).toISOString(),
        updatedBy: actor.id,
      });
      data.documents[data.documents.indexOf(record)] = next;
      data.changes.push({
        resourceType: 'postmortem',
        payload: next,
        initiated: false,
        actorId: actor.id,
        number: incident.number,
        recipients: [],
      });
      return next;
    });
  }
  private assignee(id: string | null, users: WorkspaceUser[], workspace: string) {
    if (
      id &&
      !users.some(
        (user) => user.id === id && user.workspaceId === workspace && user.status === 'active',
      )
    )
      throw new AppError('validation', 'Select an active workspace assignee.', 400);
  }
  async createAction(
    actor: IncidentActor,
    incident: Incident,
    raw: unknown,
    users: WorkspaceUser[],
  ) {
    const workspace = this.workspace(actor, incident);
    return this.store.transact(workspace, (data) => {
      const document = this.document(data, actor, incident);
      const input = createActionSchema.parse(raw);
      if (document.id !== input.postmortemId)
        throw new AppError('not-found', 'Postmortem unavailable.', 404);
      const receiptKey = JSON.stringify([actor.id, incident.id, input.requestId]);
      const fingerprint = JSON.stringify(input.fields);
      const receipt = data.receipts[receiptKey];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new AppError(
            'conflict',
            'Creation identity cannot be reused for different fields.',
            409,
          );
        return data.items.find((item) => item.id === receipt.id)!;
      }
      this.assignee(input.fields.assigneeUserId, users, workspace);
      if (data.items.filter((item) => item.postmortemId === document.id).length >= 200)
        throw new AppError('validation', 'This Postmortem supports at most 200 Action Items.', 400);
      const time = new Date(this.now()).toISOString();
      const item = actionItemSchema.parse({
        ...input.fields,
        id: crypto.randomUUID(),
        workspaceId: workspace,
        incidentId: incident.id,
        postmortemId: document.id,
        revision: 1,
        createdAt: time,
        updatedAt: time,
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      data.items.push(item);
      data.receipts[receiptKey] = { id: item.id, fingerprint };
      data.changes.push({
        resourceType: 'action_item',
        payload: item,
        assigned: !!item.assigneeUserId,
        actorId: actor.id,
        number: incident.number,
      });
      return item;
    });
  }
  async saveAction(actor: IncidentActor, incident: Incident, raw: unknown, users: WorkspaceUser[]) {
    const workspace = this.workspace(actor, incident);
    return this.store.transact(workspace, (data) => {
      const document = this.document(data, actor, incident);
      const input = saveActionSchema.parse(raw);
      const item = data.items.find(
        (item) => item.id === input.id && item.postmortemId === document.id,
      );
      if (!item) throw new AppError('not-found', 'Action Item unavailable.', 404);
      if (item.revision !== input.expectedRevision)
        throw new AppError(
          'conflict',
          'A newer Action Item revision exists. Your local edits were not saved.',
          409,
        );
      this.assignee(input.fields.assigneeUserId, users, workspace);
      const next = actionItemSchema.parse({
        ...item,
        ...input.fields,
        revision: item.revision + 1,
        updatedAt: new Date(this.now()).toISOString(),
        updatedBy: actor.id,
      });
      data.items[data.items.indexOf(item)] = next;
      data.changes.push({
        resourceType: 'action_item',
        payload: next,
        assigned: !!next.assigneeUserId && next.assigneeUserId !== item.assigneeUserId,
        actorId: actor.id,
        number: incident.number,
      });
      return next;
    });
  }
  changes(actor: IncidentActor) {
    return this.store.transact(this.workspace(actor), (data) => data.changes);
  }
  acknowledge(actor: IncidentActor, ids: string[]) {
    return this.store.transact(this.workspace(actor), (data) => {
      const acknowledged = new Set(ids);
      data.changes = data.changes.filter(
        (change) =>
          !acknowledged.has(
            `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
          ),
      );
    });
  }
}
