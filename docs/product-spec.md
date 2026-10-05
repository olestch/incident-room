# Incident Room — Product Specification

**Document status:** Phase 0 — Final / Accepted  
**Product:** Incident Room  
**Scope:** Initial portfolio implementation  
**Implementation status:** Not started  

This document defines product behavior and acceptance boundaries. It intentionally does not define component structure, API payloads, database tables, WebSocket protocol names, or visual styling.

## 1. Product overview

Incident Room is a workspace-based application for coordinating and documenting technical incidents. Each incident has a dedicated room that combines incident context, a realtime operational timeline, contextual discussions, participants, presence, and a path to a postmortem.

The primary domain entity is the **Incident**. The primary user activity is investigating, coordinating, and recording an incident—not publishing public content or participating in a social network.

The initial application uses fictional data and simulated infrastructure while behaving like a coherent production product. Demo controls expose latency, failures, connection loss, and large datasets without leaking into the normal product experience.

## 2. Goals

### Product goals

- Let workspace members discover incidents relevant to them.
- Give incident participants one reliable, shared chronology of human and automated updates.
- Let an incident commander coordinate severity, status, participants, and resolution.
- Support contextual discussion without displacing or fragmenting the main timeline.
- Make notifications and search results deep-link to the exact operational context.
- Convert selected incident evidence into a structured postmortem after resolution.
- Remain usable across desktop, tablet, and mobile.

### Portfolio goals

- Demonstrate a realistic authentication and authorization lifecycle.
- Demonstrate server-state/client-state separation.
- Demonstrate cursor pagination, realtime synchronization, optimistic updates, and reconciliation.
- Demonstrate variable-height virtualization at 100–50,000 entries.
- Demonstrate cancellation, stale-response protection, race handling, persistence, accessibility, and frontend performance engineering.
- Demonstrate these capabilities as one product rather than unrelated technical demos.

## 3. Non-goals

- A public social network, public feed, forum, or generic messenger.
- Production incident-response infrastructure or real monitoring integrations.
- A replacement for paging/on-call services.
- A general document editor or project-management suite.
- A production backend, production identity provider, billing system, or native application.
- Full workspace administration UI in the initial release.
- Audio/video calling, AI assistance, analytics dashboards, or third-party chat integrations.

## 4. Personas and permissions

### 4.1 Member

A regular authenticated workspace user.

Members can view incidents available to them, search accessible content and users, receive notifications, and view profiles. Within an incident they can read its timeline and threads. A member who is an incident participant can also send timeline messages, add thread messages, and contribute to a draft postmortem.

### 4.2 Incident Commander

An assignment scoped to one incident, not a global user role. The commander has all participant abilities and can additionally change status and severity, add or remove participants, transfer command to another eligible participant, mark important timeline entries, resolve the incident, and initiate its postmortem.

Every incident has exactly one commander. The commander must be an active workspace member and an incident participant.

The current commander or an admin may transfer command. The target must already be an active incident participant and active workspace member. The previous commander remains a participant unless separately removed. A successful transfer creates exactly one persistent system timeline entry identifying the actor, previous commander, new commander, and event time. A stale or conflicting transfer reconciles to authoritative server state and does not create a duplicate audit entry.

### 4.3 Admin

A workspace-level role. The domain model recognizes admins, but a complete administration surface is outside the initial scope. In the initial product, an admin can access all workspace incidents and perform incident-level actions when needed for recovery or demonstration. Admin actions remain subject to the same audit-event behavior as commander actions.

### 4.4 Access assumptions

- The initial product models one active workspace per session.
- All incidents are private to their workspace.
- All active members can view every incident and its timeline/thread content within the single fictional workspace. Participation controls writing; private incident ACLs are not in the initial scope.
- Deactivated users cannot authenticate or perform actions. Their historical authorship remains visible.
- Presence and typing do not grant access and are never authorization inputs.

## 5. Domain glossary

| Term | Definition |
|---|---|
| Workspace | The organization boundary containing users and incidents. |
| Incident | A time-bounded technical problem being investigated and coordinated. |
| Incident number | Human-readable stable identifier, for example `INC-2841`. |
| Incident Room | The primary incident screen containing context, timeline, compose area, presence, and thread surface. |
| Participant | A member explicitly involved in an incident. |
| Incident Commander | The participant responsible for coordinating one incident. |
| Timeline | Ordered operational history of an incident. |
| Timeline Entry | Human or system-generated record in the incident timeline. |
| Thread | One contextual discussion attached to one timeline entry. |
| Thread Message | A message inside a thread. |
| Optimistic item | A locally visible mutation awaiting server confirmation. |
| Presence | Ephemeral indication that a user is currently viewing an incident. |
| Notification | A user-specific alert with read state and an optional deep-link destination. |
| Postmortem | Structured follow-up document for a resolved incident. |
| Important entry | Timeline entry selected by the commander as operationally significant and eligible for postmortem inclusion. |
| Demo mode | Isolated developer controls for deterministic simulation and fault injection. |

## 6. Entity definitions

The fields below are conceptual. They define responsibility and observable behavior, not transport or storage schemas.

### 6.1 Workspace

| Field | Meaning |
|---|---|
| `id` | Stable unique identifier. |
| `name` | Human-readable organization/team name. |
| `createdAt` | Creation timestamp. |

Owns users and incidents. The initial session operates in one workspace.

### 6.2 User

| Field | Meaning |
|---|---|
| `id` | Stable unique identifier. |
| `name` | Display name. |
| `email` | Workspace login/contact address. |
| `avatar` | Optional avatar reference. |
| `role` | Workspace role: `member` or `admin`. |
| `status` | Account status: `active` or `deactivated`. This is distinct from presence. |

### 6.3 Incident

| Field | Meaning |
|---|---|
| `id` | Stable internal identifier. |
| `number` | Stable human-readable number such as `INC-2841`. |
| `title` | Concise problem statement. |
| `description` | Current incident context and known impact. |
| `severity` | `P1`, `P2`, `P3`, or `P4`. |
| `status` | Lifecycle status. |
| `commander` | Assigned incident commander. |
| `participants` | Active incident participants. |
| `affectedServices` | Stable references to fictional services. |
| `createdAt` | Creation timestamp. |
| `updatedAt` | Last persistent incident/timeline change used for list sorting. Presence/typing do not change it. |
| `resolvedAt` | Resolution timestamp, otherwise absent. |

The incident owns its timeline, thread associations, presence channel, and optional postmortem.

### 6.4 TimelineEntry

Conceptually includes a stable ID, incident reference, entry type, author/actor where applicable, event time, creation time, display content, important flag, thread summary, and lifecycle metadata such as updated/deleted state.

Human messages may enter optimistic states. Once confirmed, human timeline messages cannot be edited or deleted in the initial scope. Only failed, unconfirmed local messages may be deleted locally. Persistent deletion/correction events remain available to server-side simulation; a server-deleted record leaves a tombstone so chronology, replies, and deep links do not silently break.

### 6.5 Thread

Exactly zero or one thread belongs to a timeline entry. It holds a stable ID, parent entry reference, message count, last activity time, and its messages. An empty thread need not exist until the first thread message is sent.

### 6.6 ThreadMessage

Conceptually includes a stable ID, thread reference, author, body, created/updated timestamps, optional `replyToMessageId`, and optimistic delivery state when locally authored.

Thread messages are displayed chronologically. A message may reply to another message, but visual nesting is limited to **one level**. Replies to a reply reference the original target but render at the same single indented reply level. This preserves context without becoming an unrestricted recursive forum tree.

### 6.7 Notification

Contains a stable ID, recipient, type, concise message, created timestamp, read/unread state, and validated destination describing an accessible product route and optional deep-link target.

### 6.8 Postmortem

One optional postmortem belongs to one resolved incident. Initial sections are Summary, Impact, Root Cause, Resolution, Timeline, and Action Items. The Timeline section references selected timeline entries rather than duplicating their mutable client objects.

The initial scope supports a shared draft but no formal publish/approval workflow.

## 7. Incident lifecycle

### 7.1 Statuses

```text
Triggered → Investigating → Identified → Monitoring → Resolved
```

Statuses describe increasing progress toward resolution. Intermediate statuses may be skipped.

### 7.2 Valid transitions

| Current status | Allowed next status |
|---|---|
| Triggered | Investigating, Identified, Monitoring, Resolved |
| Investigating | Identified, Monitoring, Resolved |
| Identified | Monitoring, Resolved |
| Monitoring | Resolved |
| Resolved | None in initial scope |

Backward transitions and reopening are not supported in the initial product. `Resolved` is terminal. This is explicit, not inferred from UI disabling.

### 7.3 Status-change behavior

- **Actor:** incident commander or admin.
- **Preconditions:** authenticated, authorized, incident accessible, transition valid, incident not already in target status.
- **Trigger:** actor selects and confirms a new status.
- **Expected behavior:** status updates and one system timeline entry records actor, prior status, new status, and event time.
- **Success:** incident context and all open views converge to the confirmed state without duplicate system entries.
- **Failure:** prior status remains authoritative; an inline/non-blocking error explains that the change was not applied.
- **Edges:** repeated identical commands are no-ops; conflicting remote change causes refresh/reconciliation before another attempt.

On transition to Resolved, `resolvedAt` is set. Existing timeline and thread content remains readable, but timeline compose and thread compose become read-only. No new operational timeline messages or thread messages may be created. Postmortem work remains available according to postmortem permissions. The initial scope has no follow-up-message exception, temporary reopening, or backward transition.

## 8. Severity model

| Severity | Label | Meaning | Presentation/behavior |
|---|---|---|---|
| P1 | Critical | Broad or business-critical impact requiring immediate coordination. | Highest visual priority; first in severity sorting; eligible for high-priority notifications. |
| P2 | High | Significant impact with urgent response required. | Strong priority presentation and notification treatment. |
| P3 | Medium | Limited or degraded impact requiring active investigation. | Standard active-incident treatment. |
| P4 | Low | Minor impact or precautionary investigation. | Lowest urgency presentation. |

Severity affects list filtering, severity sorting, incident presentation, and notification copy/priority. It does not silently change permissions or status.

Severity changes follow the same actor/precondition/success/failure model as status changes and always create exactly one system timeline entry containing actor, old severity, new severity, and event time.

## 9. Authentication user flows

### 9.1 Registration

- **Actor:** unauthenticated visitor.
- **Precondition:** visitor is not in an active session.
- **Trigger:** submits valid name, email, and password fields on `/register`.
- **Expected behavior:** a fictional account/session is created, the user enters the default demo workspace, and is redirected to `/app/incidents` unless a valid protected return destination exists.
- **Failure:** field errors are associated with fields; account/service error preserves non-sensitive input and focus moves to the error summary or first invalid field.

### 9.2 Login and protected return

When an unauthenticated user requests a route under `/app/*`, the application stores only the safe internal path, query, and hash, then redirects to `/login`.

Example:

```text
/app/incidents/INC-2841?thread=918
        ↓ unauthenticated
/login?returnTo=<encoded safe internal destination>
        ↓ successful login
/app/incidents/INC-2841?thread=918
```

External URLs, authentication routes, malformed paths, or destinations the user cannot access are not accepted as return targets. The fallback after login is `/app/incidents`.

### 9.3 Session restoration

On application start, protected content waits for session restoration to resolve. During this bounded state the UI shows an application-level loading state, not a misleading login flash. A valid restored session proceeds to the requested route. Durable drafts and outbox records may be restored only after the authenticated identity is known and matches their identity scope.

### 9.4 Token refresh simulation

- A near-expiry session triggers one coordinated refresh attempt.
- Concurrent requests wait on the same refresh result rather than launching multiple refreshes.
- A successful refresh resumes pending requests where safe.
- A failed/invalid refresh clears authenticated state and redirects to login with the protected return destination.
- Non-idempotent optimistic actions remain visibly failed or pending according to reconciliation rules; they are not silently replayed after reauthentication.
- After session expiration followed by successful reauthentication as the same user, matching durable drafts/outbox data may be restored and reconciled before any replay-capable operation.
- Authentication as a different user never exposes or activates durable data belonging to the prior identity.

### 9.5 Logout

Logout clears session credentials, user-specific caches, durable outbox/drafts belonging to that identity, presence, and protected navigation state, then redirects to `/login`. Shared browser data must not leak into the next account session.

### 9.6 Forgot password

`/forgot-password` accepts an email and always displays a neutral confirmation to avoid account enumeration. No real email is sent in the portfolio implementation.

### 9.7 Invalid or expired session

The user receives a concise session-expired message on the login screen. Protected content is removed from view. After successful login, safe return behavior applies.

### 9.8 Multi-tab session and client behavior

Multiple browser tabs are supported as independent application clients.

- Confirmed persistent server state eventually converges through ordinary HTTP synchronization and realtime mechanisms.
- A confirmed event created in one tab may appear in another through normal realtime delivery.
- Authorization changes and session invalidation eventually reach every active tab through normal authentication/application mechanisms.
- Each tab may independently own its realtime connection, presence session, in-memory optimistic state, and refresh attempt.
- The initial scope does not require dedicated cross-tab coordination for drafts, outbox ownership, presence ownership, realtime connection sharing, or token-refresh locking.
- No dedicated `BroadcastChannel`, SharedWorker, cross-tab Redux synchronization, or equivalent architecture is introduced solely for multi-tab behavior.
- Durable data remains identity-scoped. A tab must reconcile restored outbox state before any operation that could duplicate a mutation.

## 10. Application navigation

The authenticated shell provides access to Incidents, My Incidents, Notifications, Search, Team, and Settings. User profile destinations are contextual rather than a required persistent top-level item.

Navigation principles:

- Current location is perceivable visually and semantically.
- Browser back/forward restores URL-owned filters and deep-link state.
- Opening/closing desktop thread context updates URL state without leaving the Incident Room.
- Mobile full-screen thread navigation participates predictably in browser history.
- Cmd/Ctrl+K opens the Command Palette from authenticated routes except while the shortcut would conflict with editable controls or platform behavior.

## 11. Route map

| Route | Access | Purpose |
|---|---|---|
| `/login` | Public-only when no active session | Authenticate and resume a protected destination. |
| `/register` | Public-only when no active session | Create fictional demo account/session. |
| `/forgot-password` | Public | Start simulated recovery flow. |
| `/app/incidents` | Authenticated | Browse, filter, sort, and enter incidents. |
| `/app/incidents/:incidentId` | Authenticated + incident access | Incident Room and deep-linked timeline/thread targets. `incidentId` accepts the stable human-readable incident number in public navigation. |
| `/app/incidents/:incidentId/postmortem` | Authenticated + incident access | View or edit the resolved incident postmortem according to permissions. |
| `/app/notifications` | Authenticated | Read notifications and follow destinations. |
| `/app/search` | Authenticated | Global searchable result surface. |
| `/app/team` | Authenticated | Browse workspace members and presence-independent account data. |
| `/app/profile/:userId` | Authenticated | View a workspace member profile and incident context allowed to the viewer. |
| `/app/settings` | Authenticated | User-level application preferences. |

Unknown routes show a not-found state. Known but inaccessible resources show an access-denied state without leaking private resource details.

## 12. Incident list behavior

### 12.1 Primary flow

- **Actor:** authenticated member.
- **Precondition:** session and workspace are available.
- **Trigger:** opens `/app/incidents` or changes filters/sort.
- **Expected behavior:** accessible incidents load, URL-owned controls are applied, and each result exposes number, title, severity, status, commander, affected services, participants summary, and last update.
- **Success:** selecting a result opens its Incident Room and browser navigation remains intact.
- **Failure:** filters remain usable; a retryable list error does not imply that no incidents exist.

### 12.2 Filters

Supported filters:

- one or more statuses;
- one or more severities;
- assigned to me, meaning current user is commander or participant;
- participant;
- date range based on incident creation time.

Filters are encoded in stable URL query parameters. Invalid values are ignored individually and the UI reflects only effective values. Changing filters resets list pagination. Clearing filters removes their parameters.

Canonical example:

```text
/app/incidents?status=investigating&severity=P1,P2&sort=updated
```

### 12.3 Sorting

- `updated`: descending `updatedAt`, then incident number.
- `newest`: descending `createdAt`, then incident number.
- `severity`: P1 → P4, then descending `updatedAt`, then incident number.

Sort is URL-synchronized and defaults to recently updated. The product must support large collections through paginated/virtualized presentation as needed, without requiring the entire collection in memory.

## 13. Incident Room behavior

### 13.1 Information architecture

The room exposes:

- incident title, number, description, severity, and status;
- commander and participants;
- affected services;
- realtime connection state;
- presence summary;
- primary timeline;
- timeline compose area;
- contextual thread surface;
- authorized incident actions;
- postmortem entry point when applicable.

### 13.2 Entry flow

- **Actor:** authenticated user with incident access.
- **Trigger:** route navigation, list selection, search result, notification, or direct deep link.
- **Expected behavior:** incident context and an initial timeline window load independently but present coordinated states. Realtime subscription begins only after authorization and incident identity are confirmed.
- **Success:** the user can read the current timeline, understand connection state, and perform authorized actions.
- **Failure:** incident-not-found, access-denied, session, and retryable network failures are distinct states.

### 13.3 Behavioral rules

- Timeline remains the primary surface when a thread opens.
- The active thread is URL-addressable.
- Incident metadata updates do not reset timeline position.
- Presence/typing changes do not reorder the incident list or create timeline entries.
- Commander controls are visible only when actionable; authorization is still enforced beyond visibility.
- A resolved incident remains readable and eligible for postmortem work.

## 14. Timeline behavior

The timeline is the authoritative human-readable incident chronology. It combines confirmed historical entries, confirmed realtime entries, and locally optimistic entries into one stable presentation.

### 14.1 General behavior

- Entries may have variable and changing height.
- Timeline supports at least 50,000 generated entries without rendering all DOM nodes.
- Older history loads when requested/approached at the history boundary.
- New realtime entries appear without destroying the reader's current context.
- Updates and tombstones preserve stable identity and chronology.
- Thread counts may change asynchronously without causing uncontrolled scroll jumps.

### 14.2 Scroll expectations

- When the user is at or near the newest boundary, confirmed new entries may keep the timeline following newest content.
- When the user is reading older content, incoming entries do not force-scroll; a non-intrusive “new updates” affordance lets the user return to newest.
- Prepending older pages preserves the previously visible anchor entry and its apparent viewport position.
- Reconciliation of an optimistic entry preserves its visual identity and position.
- Height changes above the current anchor should be compensated where practical so content does not unexpectedly jump.
- Explicit deep-link navigation overrides ordinary scroll preservation until the target attempt resolves.

## 15. Timeline entry types

| Type | Producer | Required visible meaning | Thread eligible |
|---|---|---|---|
| Human message | Participant | Author, content, time, delivery state when local | Yes |
| Monitoring event | Simulated system | Metric/condition and event time | Yes |
| Deployment event | Simulated system | Service, fictional version/change, event time | Yes |
| Status change | Authorized user/system record | Actor, old status, new status, time | Yes |
| Severity change | Authorized user/system record | Actor, old severity, new severity, time | Yes |
| Participant event | Authorized action/system record | User joined/left and actor where applicable | Yes |
| Generic system event | Simulated system | Clearly labeled operational fact | Yes |

System-generated entries are visually and semantically distinguishable from human messages. Entry type never relies on color alone.

## 16. Timeline ordering rules

The user-visible order is oldest to newest.

Confirmed entries use a server-authoritative ordering tuple conceptually equivalent to:

1. occurrence time;
2. monotonic server ordering value for ties;
3. stable server ID as deterministic final tie-breaker.

The exact transport fields are deferred to the technical architecture phase.

Rules:

- Historical pages and realtime events are deduplicated by stable server identity.
- Delivery order over the network does not determine display order.
- A server correction may update content/order metadata, but UI preserves the user's anchor where possible.
- Optimistic messages are inserted according to client creation time near the newest boundary and display an explicit local state.
- Confirmation maps the client identity to the server identity as one logical item. No duplicate may flash, and the item must not jump merely because its ID changed.
- If server-authoritative time changes the correct relative position materially, the item moves only once during reconciliation and the current reading anchor is preserved.
- Failed messages remain at their attempted chronological position until retried or deleted locally.
- Deleted confirmed entries retain a tombstone at the original position.
- Duplicate realtime delivery and overlap between pagination and resynchronization are expected and must be harmless.

## 17. Pagination behavior

Timeline history uses opaque cursor-based pagination.

- Initial room load returns a bounded recent window suitable for immediate reading.
- Loading older entries uses the oldest available history cursor.
- Cursors are treated as opaque; UI does not derive offsets from them.
- Only one older-page request per incident/cursor is active at a time.
- Repeated triggers coalesce rather than fetch duplicates.
- Changing incident cancels or invalidates prior incident requests.
- A stale response for a previous incident cannot populate the current room.
- An empty page with no next cursor means the beginning of history.
- Page failure preserves existing entries and exposes retry at the history boundary.
- Prepending a successful page preserves the visible anchor.
- Realtime activity and optimistic creation continue while history is loading.

Deep-link location may require a separate target-location capability rather than sequentially loading thousands of pages. The user-visible requirement is defined in section 21; the technical contract remains for a later phase.

## 18. Compose behavior

### 18.1 Timeline compose

- **Actor:** active incident participant, commander, or admin.
- **Preconditions:** authenticated, authorized, incident accessible, session valid, and incident not Resolved.
- **Trigger:** enters text and activates Send.
- **Expected behavior:** message appears immediately as an optimistic timeline entry; the draft clears only after the mutation and message body are safely recorded in the durable local outbox.
- **Success:** server confirmation changes delivery state to sent without duplication.
- **Failure:** message becomes failed and offers Retry and Delete.

Initial capabilities:

- plain text;
- user mentions;
- automatically detected safe URLs, rendered as clickable links;
- keyboard-accessible send action.

Authored content is untrusted input. The initial authoring model does not support bold, italic, inline code, arbitrary HTML, Markdown authoring, or a formatting toolbar. Attachments, code blocks, richer link handling, and formatting beyond plain text, mentions, and safe URL detection are future scope.

Messages are limited to 4,000 characters. Empty or whitespace-only messages are invalid. `Enter` inserts a newline. `Cmd+Enter` sends on macOS; `Ctrl+Enter` sends on Windows/Linux. A visible Send button remains available. IME composition must never trigger Send accidentally.

Mention suggestions show workspace users the actor is allowed to discover. Search is debounced and stale results do not replace newer query results.

The current identity has one local timeline draft per incident. It survives ordinary navigation, page reload, and browser restart where durable browser storage remains available. It clears on successful handoff to the durable outbox, explicit Discard, or explicit logout. It is never visible or actionable to another authenticated identity and is not stored server-side.

When an incident is Resolved, compose is visibly read-only and cannot create new operational messages.

### 18.2 Thread compose

Uses the same 4,000-character limit, plain-text/mention/safe-URL model, keyboard convention, validation, delivery lifecycle, and resolved-incident restriction, but creates a ThreadMessage in the active thread. If no thread exists, the first successful message creates it conceptually.

The current identity has one local draft per thread. It survives closing the thread surface, ordinary navigation, reload, and browser restart where durable browser storage remains available. It clears on successful handoff to the durable outbox, explicit Discard, or explicit logout; it is never server-side or visible to another identity.

## 19. Optimistic action lifecycle

### 19.1 Message states

```text
local draft
    │ Send
    ▼
 sending ── server confirms ──► sent
    │
    ├── request outcome unknown ──► sending/reconciling until lookup or sync resolves
    │
    └── definitive failure ──► failed ── Retry ──► sending
                                  │
                                  └── Delete ──► removed locally
```

- `sending`: locally accepted and awaiting authoritative result.
- `sent`: confirmed and mapped to a stable server record.
- `failed`: definitive failure; retains content and exposes Retry/Delete.
- A temporary “reconciling” presentation may be used when the transport outcome is unknown, but it must not create a second logical message.

### 19.2 Identity and reconciliation

Every optimistic action has a client-generated identity stable across retry. Server confirmation associates it with one server identity. Duplicate confirmations, realtime echoes, retry responses, and resync results must converge on one item.

The UI must preserve:

- message content;
- delivery-state history relevant to the user;
- timeline position as far as server order permits;
- thread/deep-link association;
- current scroll anchor.

### 19.3 Durable local outbox

The future implementation uses a durable local outbox, for which IndexedDB is an appropriate planned storage mechanism.

- Unsent messages, sending messages with unknown transport outcome, and failed locally authored messages may survive page reload or browser restart.
- Records are scoped to authenticated user identity and relevant incident/thread.
- Restoration occurs only for the same authenticated identity.
- Session expiration followed by successful reauthentication as the same user may restore and reconcile matching records.
- Explicit logout removes that identity's outbox records and drafts from the local device/session context.
- Authentication as a different user never exposes or activates prior-identity records.
- Restored operations are never blindly replayed. Stable client mutation identity is reconciled against authoritative state before any action that could create a duplicate.
- Persistence does not make the product offline-first and does not promise background delivery while the application is closed.

Multiple tabs do not have dedicated outbox ownership coordination in the initial scope. Each tab must still apply stable-identity reconciliation before retry/replay-capable behavior.

### 19.4 Failure rules

- A timeout is not automatically proof that the server rejected the message.
- Before presenting a duplicate-producing retry, the system must use its client identity during reconciliation.
- Retry is user initiated in the initial scope; automatic retry may be used only for transport-safe operations and must be bounded.
- Delete on a failed unconfirmed message removes only the local item.
- Authentication failure transitions through session handling rather than endlessly retrying.
- Offline or closed-application background delivery is not promised. Locally retained work resumes only after the application is open, identity is restored, and reconciliation has run.

The architecture should later extend to suitable optimistic incident actions, but initial product acceptance requires optimistic human timeline messages and thread messages.

## 20. Thread behavior

### 20.1 Relationship and presentation

- A thread belongs to exactly one timeline entry.
- Opening a thread preserves the main incident timeline and active timeline context.
- Desktop/tablet use a contextual panel where space permits.
- Mobile uses a full-screen surface with explicit Back/Close behavior.
- The parent timeline entry remains identifiable in the thread surface.
- Thread count and last activity update after confirmed or optimistic activity without duplicating messages.

### 20.2 Thread messages and replies

Messages are chronological, oldest to newest. A message may reference another message using `replyToMessageId`. The UI shows at most one visual indentation level and a quoted/linked reference to the replied-to author/content. The data model does not support arbitrary recursive children in the initial product. Confirmed human thread messages cannot be edited or deleted in the initial scope; only failed, unconfirmed local messages may be deleted locally.

### 20.3 Flow

- **Actor:** participant, commander, or admin.
- **Preconditions:** incident and parent entry are accessible, actor can participate, and incident is not Resolved.
- **Trigger:** opens a thread or sends a thread message.
- **Expected behavior:** parent context stays available, thread history loads, and new messages use optimistic lifecycle.
- **Success:** URL identifies the active thread; browser navigation and focus behavior remain predictable.
- **Failure:** parent timeline remains usable; thread-specific error provides retry without replacing the room.

### 20.4 Deleted parent/message

A server-deleted/corrected timeline entry retains a tombstone and may keep its thread readable unless policy later requires full removal. A server-deleted/corrected thread message displays a tombstone so replies and deep links retain context. These states support simulation and continuity; they do not imply an initial user-facing edit or delete action for confirmed human messages. Content hidden for authorization reasons must not be recoverable from cached UI.

## 21. Deep-link behavior

Supported canonical query forms:

```text
/app/incidents/INC-2841?event=918
/app/incidents/INC-2841?thread=918&message=1042
```

Here `thread` identifies the parent timeline entry/thread context in the user-facing URL. Exact internal IDs are a later contract decision.

### 21.1 Resolution sequence

For a thread-message target the product must:

1. restore/authenticate the session;
2. authorize and load the incident;
3. locate or load the parent timeline entry without requiring linear loading of all preceding history;
4. open the associated thread surface;
5. load the page/window containing the target message;
6. wait for the relevant responsive surface and target element to exist;
7. bring the target into view;
8. move programmatic focus only when appropriate for the navigation origin;
9. provide a temporary non-color-only highlight and accessible target announcement.

Target navigation has an identity. A newer navigation attempt cancels or supersedes an older one so late responses cannot move the user to a stale target.

If the responsive breakpoint changes while a thread/deep-link target is active, the product preserves the URL, target identity, loaded thread state, unsent draft, and relevant timeline scroll context. Presentation migrates between panel, sheet, and full-screen surface without restarting logical target navigation. The target is not re-announced unless focus must legitimately move because the active surface changed.

### 21.2 Outcomes

| Situation | Expected behavior |
|---|---|
| Target found | Target is visible, highlighted, and context is preserved. |
| Missing/unknown target | Incident remains open; targeted surface shows “This item could not be found” with a route back to current/latest activity. |
| Deleted target | Show its tombstone and surrounding context when authorized. |
| Incident unavailable/not found | Show unavailable/not-found state without starting realtime subscription. |
| Insufficient permission | Show access denied; do not reveal target content or existence beyond safe wording. |
| Retryable network failure | Preserve URL and expose Retry; do not silently fall back to an unrelated entry. |
| Session expired | Redirect through login and retry the safe protected destination after successful authentication. |
| Superseded navigation | Stop pending target work and honor the newest route. |

If a target cannot be resolved within a bounded user-visible period, the UI changes from loading to a retryable error; it must not wait indefinitely.

## 22. Realtime behavior

Realtime transport delivers hints/events about changes; it is not the sole source of truth. Persistent resources remain server-derived and recoverable through HTTP-style synchronization.

Initial conceptual event categories:

- incident created/updated/status changed/severity changed;
- timeline entry created/updated/deleted;
- thread message created/updated/deleted;
- notification created;
- presence joined/left/typing.

User-visible rules:

- Authorized persistent events update or invalidate relevant server state.
- Duplicate and out-of-order delivery is expected and must not duplicate UI.
- Events for another workspace or inaccessible incident are ignored.
- Realtime echoes reconcile optimistic actions by client/server identity.
- Presence/typing use ephemeral state and never enter timeline history.
- A malformed/unsupported event is isolated and observable in demo diagnostics without breaking the stream.
- Realtime updates received while a historical page is loading merge according to timeline ordering rules.

Protocol event names, payload schemas, sequence format, and subscription messages are intentionally deferred.

## 23. Connection/reconnect behavior

### 23.1 Connection states

| State | User-visible meaning |
|---|---|
| Connecting | Initial realtime connection is being established; persistent data may still load. |
| Connected | Realtime channel is available and synchronized. |
| Reconnecting | Connection was lost and recovery is in progress; existing content remains usable. |
| Offline | Browser/network is unavailable or reconnect cannot currently proceed. |

Connection state is visible but non-blocking. It must not rely on color alone or repeatedly steal focus.

### 23.2 Reconnect sequence

```text
connection lost
    ↓
show reconnecting/offline state
    ↓
re-establish authenticated transport
    ↓
synchronize persistent changes since last known checkpoint
    ↓
deduplicate and reconcile with cache + optimistic items
    ↓
resume live processing
    ↓
connected
```

- Reconnect uses bounded backoff and can also be triggered through demo controls.
- Token/session refresh coordinates with reconnect; multiple reconnect loops must not compete.
- Missed persistent changes are fetched from a server synchronization source before the UI claims to be fully synchronized.
- Optimistic messages remain visible through disconnect and reconcile after recovery.
- Presence is rebuilt from fresh realtime state rather than replayed as durable history.
- If synchronization fails, the app remains in reconnecting/offline status and offers retry without discarding visible confirmed content.

## 24. Presence behavior

Presence communicates who is currently viewing an incident.

- It begins only after incident authorization succeeds.
- It ends on room departure, logout, session invalidation, or connection loss; stale presence may expire server-side conceptually.
- Reconnect replaces stale local presence with a fresh snapshot plus subsequent updates.
- The UI shows a compact summary and an accessible expanded list when needed.
- Large participant counts are summarized rather than rendering every avatar.
- Typing state is scoped separately to timeline compose or the active thread.
- Typing indicators expire automatically and are rate-limited conceptually.
- The current user's own typing signal is not echoed as another participant.
- Presence and typing are never persisted, searchable, included in postmortems, or treated as audit history.

## 25. Notification behavior

Initial notification types:

- assigned to an incident;
- mentioned in an incident timeline message;
- mentioned in a thread message;
- incident severity changed;
- incident resolved.

### 25.1 Behavior

- Notifications display type, concise context, incident reference, creation time, and read state.
- Selecting a notification follows its validated internal deep link.
- A thread mention resolves Incident → Timeline Entry → Thread → Thread Message.
- Opening a valid destination marks the notification read. Users can also mark items read without navigation.
- Realtime notification delivery merges with paginated notification history without duplicates.
- Unread count is consistent across navigation surfaces.
- A destination that is deleted or no longer accessible shows the applicable deep-link failure state; the notification can still become read.
- Notifications are user-specific server state, not global Redux-only state.

The initial scope does not require email, push, notification preferences, or bulk notification administration.

## 26. Search behavior

### 26.1 Entry points and result types

Global search is available at `/app/search` and through the Command Palette. It searches only content visible to the authenticated user.

Result groups:

- **Incidents:** number, title, status, severity, affected services, updated time.
- **Timeline messages:** safe snippet, author, event time, parent incident; selecting deep-links to the entry.
- **Users:** name, avatar, workspace role/account status; selecting opens the profile.

System-event search is not required initially unless it can use the same timeline-message index without changing scope.

### 26.2 User-visible behavior

- An empty query shows recent/helpful navigation, not fabricated search matches.
- Remote global search begins only after 2 trimmed characters.
- Initial results show at most 10 results per result type: Incidents, Timeline messages, and Users.
- The dedicated Search page may paginate or load additional results per type.
- Command Palette search remains intentionally bounded and does not become an infinite-results search page.
- Input is debounced.
- A newer query cancels or supersedes older requests.
- Late stale responses never replace newer results.
- Loading preserves the current query and distinguishes initial search from background refresh.
- No-results state names the effective query and suggests changing it.
- Errors preserve the query and expose Retry.
- Search terms in snippets may be highlighted without changing accessible text meaning.
- Results are cached briefly as server state, subject to authorization/session clearing.
- Keyboard navigation and screen-reader result counts are supported.

## 27. Command Palette behavior

Cmd/Ctrl+K opens a modal command surface from authenticated product routes.

Initial actions:

- create incident;
- open incident;
- search;
- open My Incidents;
- open Notifications;
- navigate to user/profile.

Behavior:

- Commands unavailable to the current user are omitted or disabled with an explanation.
- Query filters commands and may show searchable incidents/users.
- Arrow keys move through results; Enter activates; Escape closes.
- Focus is trapped while open and restored to the invoking element on close.
- The active option and result count are announced accessibly.
- Selecting a navigation command closes the palette and performs one navigation.
- Async results use cancellation/stale-response protection.
- Network failure does not prevent static navigation commands from working.
- Future incident mutations are not part of the initial palette scope.

### 27.1 Create Incident flow

Any active workspace member may start Create Incident. It opens an accessible modal/dialog on desktop where appropriate and a full-screen sheet/surface on mobile. It is a single-step flow, not a wizard.

Fields:

- Title — required;
- Description — optional;
- Severity — required;
- Affected services — optional multi-select;
- Additional participants — optional.

Commander selection is not exposed during creation. On success, the creator becomes commander and a participant, selected additional users become participants, status is `Triggered`, and navigation moves to the new Incident Room. Validation and network errors preserve valid user input. Duplicate submission is prevented while the request outcome is unresolved.

## 28. Postmortem behavior

### 28.1 Preconditions and permissions

- The incident must be Resolved.
- The commander or admin initiates the postmortem.
- Incident participants may edit the shared draft after initiation.
- Other members with incident access may view the draft but not edit it.
- The initial scope has one postmortem per incident and no formal publish state.
- Editing is not realtime collaborative. No CRDT, OT, or realtime document co-editing is used.

### 28.2 Sections

- Summary
- Impact
- Root Cause
- Resolution
- Timeline
- Action Items

### 28.3 Timeline selection

The commander can mark/unmark important entries in the Incident Room. Authorized postmortem editors can include marked or otherwise selected entries in the postmortem timeline. Selected records display their authoritative incident time and a concise snapshot/reference.

The postmortem timeline defaults to chronological order. Removing an entry from the postmortem does not delete it from the incident. A subsequently deleted source entry renders a safe tombstone/reference in the postmortem rather than silently disappearing.

### 28.4 Flow

- **Actor:** commander initiates; commander/participants edit.
- **Trigger:** opens postmortem route for a resolved incident.
- **Expected behavior:** existing draft loads or authorized commander can create it; fields and selected timeline entries are editable according to permission.
- **Success:** an ordinary save updates the shared draft and is visible consistently to authorized viewers.
- **Failure:** unsaved local input remains available where safe; network failure is retryable. A concurrent/conflicting save produces an explicit conflict state with reload/review/retry choices rather than silently overwriting either user's work.

Action Items are structured text items in the initial scope. Assignees, due dates, workflow states, and external task synchronization are not implied.

## 29. Demo mode requirements

Demo/developer controls are isolated from ordinary product navigation and clearly labeled. They must never look like incident commander controls.

Required controls:

| Category | Options/behavior |
|---|---|
| Network latency | 0 ms, 500 ms, 2 s, 5 s |
| Failure rate | At least 0%, 10%, 30% |
| Realtime transport | Disconnect and reconnect |
| Event generation | Monitoring event, deployment event, human message, status change |
| Dataset generation | 100, 1,000, 10,000, 50,000 timeline entries |

Requirements:

- Generated people, companies, services, incidents, messages, versions, and URLs are fictional.
- Given a documented seed, generated data is deterministic enough for repeatable tests and demonstrations.
- Changing dataset size requires explicit confirmation if it replaces current demo data.
- Fault injection affects mock behavior, not static UI timing alone.
- The UI always makes active latency/failure/disconnect simulation apparent inside the developer surface.
- Demo state can be reset to a known baseline.
- Demo controls remain operable with keyboard and assistive technology.
- Production-style product behavior must remain understandable with the demo panel closed.

## 30. Responsive behavior

### 30.1 Desktop

- Incident context and primary actions remain available without displacing the timeline.
- Timeline is the central reading surface.
- Active thread opens in a contextual side panel.
- Context/thread width changes must not lose scroll anchors or active targets.

### 30.2 Tablet

- Timeline remains primary.
- Incident context may collapse into a summary/details surface.
- Thread may use a narrower side panel in landscape or a full-height overlay/sheet where width is insufficient.
- Touch targets and keyboard operation are both supported.

### 30.3 Mobile

- Incident header is condensed with critical status/severity retained.
- Timeline is a single-column primary surface.
- Thread opens as a full-screen route-like sheet/surface with its own header and Back/Close action.
- Closing thread returns to the prior timeline anchor and initiating entry.
- Compose remains usable with software keyboard and safe-area insets.
- Command Palette uses a mobile-appropriate full-screen/large-sheet presentation.

Responsive changes must preserve URL/deep-link meaning. A resize across breakpoints migrates the active thread to the appropriate panel/sheet/full-screen surface without losing its target identity, loaded thread state, unsent draft, timeline scroll context, or URL. This presentation migration does not restart logical deep-link navigation and does not re-announce the target unless focus must legitimately move.

## 31. Accessibility requirements

### 31.1 Global

- All actions are keyboard operable using semantic interactive elements.
- Visible focus is always present and not obscured.
- Headings, landmarks, labels, and page titles communicate route/context.
- Contrast meets WCAG AA targets.
- Motion honors `prefers-reduced-motion`; target highlighting does not depend on animation.
- Validation and errors are programmatically associated with controls.

### 31.2 Realtime and timeline

- Realtime arrivals do not continuously interrupt screen-reader users.
- Important connection/status changes use concise, appropriately polite live announcements.
- Bulk event generation is summarized rather than announcing thousands of entries.
- Virtualization preserves meaningful list semantics and does not make keyboard focus disappear unexpectedly.
- When a focused item would unmount, navigation/focus behavior is explicitly managed.

### 31.3 Threads and deep links

- Opening a thread moves focus to a meaningful thread heading or target when navigation intent requires it.
- Closing restores focus to the invoking timeline entry when it still exists.
- Deep-link target highlight includes a textual/semantic cue and sufficient contrast.
- Deleted/missing target states are announced.

### 31.4 Dialogs, sheets, and Command Palette

- Modal surfaces trap focus, provide an accessible name, close predictably, and restore focus.
- Escape behavior does not discard unsaved content without warning.
- Mobile sheets expose equivalent semantics to desktop panels.

### 31.5 Media-independent communication

Status, severity, delivery, connection, and read/unread states never rely on color, icons, motion, or position alone.

## 32. Error, empty, and loading states

| Surface | Loading | Empty | Error/failure |
|---|---|---|---|
| Session restoration | Branded application-level progress state | Not applicable | Redirect to login with safe return destination and reason. |
| Incident list | Skeleton/progress preserving filter controls | “No incidents match” with clear-filters action; distinct first-use state | Retry without clearing URL filters. |
| Incident Room | Context/timeline may load independently | Incident with no timeline shows explanatory first-event state | Distinguish unavailable, forbidden, session, and retryable network failure. |
| Timeline history | Boundary loader without blocking current entries | Beginning-of-history indicator | Inline Retry at history boundary. |
| Thread | Panel/sheet loader with parent context | Invite eligible user to start discussion | Thread-only retry; timeline remains usable. |
| Deep-link target | Explicit “Locating target” state | Not applicable | Missing, deleted, forbidden, unavailable, and network states follow section 21. |
| Compose | Local send progress appears on optimistic item | Empty compose is normal | Failed item exposes Retry/Delete; input is not silently lost. |
| Notifications | Paginated loading | “No notifications” | Retry while retaining loaded items. |
| Search | Query-scoped progress | Empty query and no-results are distinct | Preserve query and offer Retry. |
| Postmortem | Document skeleton/progress | Eligible resolved incident offers initiation to commander | Preserve safe unsaved work and expose retry/conflict. |
| Realtime | Connection-state indicator | Not applicable | Existing confirmed data remains readable; resync/retry status is clear. |

Loading states must be bounded: prolonged work changes to a meaningful delayed/retryable state rather than an indefinite spinner.

## 33. Permissions matrix

`Participant` below means a member assigned to the specific incident. `Member` means a non-participant with workspace incident visibility.

| Capability | Member | Participant | Incident Commander | Admin |
|---|---:|---:|---:|---:|
| View accessible incident/timeline | Yes | Yes | Yes | Yes |
| Create incident | Yes | Yes | Yes | Yes |
| Search accessible incidents/messages/users | Yes | Yes | Yes | Yes |
| View thread | Yes | Yes | Yes | Yes |
| Send timeline message | No | Yes | Yes | Yes |
| Send thread message/reply | No | Yes | Yes | Yes |
| Change incident status | No | No | Yes | Yes |
| Change severity | No | No | Yes | Yes |
| Add/remove participants | No | No | Yes | Yes |
| Assign/change commander | No | No | Yes | Yes |
| Mark important entry | No | No | Yes | Yes |
| Resolve incident | No | No | Yes | Yes |
| Initiate postmortem | No | No | Yes | Yes |
| Edit initiated postmortem draft | No | Yes | Yes | Yes |
| View notifications belonging to self | Yes | Yes | Yes | Yes |
| Mark own notification read | Yes | Yes | Yes | Yes |
| View user/team profiles | Yes | Yes | Yes | Yes |
| Use demo controls | Demo build only | Demo build only | Demo build only | Demo build only |

Authorization is enforced independently of UI visibility. Mutations denied due to stale permissions reconcile UI back to authoritative state and explain the failure.

## 34. Out-of-scope functionality

The initial scope explicitly excludes:

- production backend and production WebSocket infrastructure;
- OAuth/social login providers;
- billing, payments, subscriptions;
- public profiles or anonymous incident access;
- followers, public feeds, reposts, popularity, or social amplification;
- audio/video calls;
- native mobile apps;
- rich-text/Markdown authoring, formatting toolbar, and authored bold/italic/inline-code/HTML in the initial message model;
- actual file attachments in the first implementation;
- real monitoring, deployment, paging, Slack, Teams, or email integrations;
- AI functionality;
- analytics dashboard;
- full admin console;
- private per-incident ACL configuration;
- arbitrary recursive discussion trees;
- postmortem publication/approval/export workflow;
- reopening/backward incident status transitions;
- production-grade offline operation or background delivery while the application is closed;
- dedicated cross-tab draft/outbox/presence/realtime/token-refresh coordination;
- editing or deleting confirmed human timeline/thread messages.

No speculative abstraction should be built solely for these exclusions.

## 35. NDA / clean-room constraints

Incident Room is an independent clean-room project.

- This specification is the source of truth for all later phases.
- The previously audited private commercial repository must not be opened or consulted during implementation.
- No code, algorithm expression, component hierarchy/name, interface, type, schema, state shape, endpoint, route, transaction format, layout, styling, copy, asset, fixture, user data, branding, terminology, or proprietary interaction mechanic may be copied, translated, adapted, or closely imitated from that repository.
- General engineering problem categories—virtualization, realtime synchronization, optimistic UI, pagination, authentication, routing, caching, cancellation, thread navigation, accessibility—may be solved independently.
- All domain models, interactions, data, architecture, and implementation must be derived independently from this document and later Incident Room decisions.
- All people, organizations, incidents, systems, messages, URLs, versions, and monitoring events are fictional.
- No real secret, endpoint, company, user, or production incident data may enter source, fixtures, screenshots, tests, demos, or documentation.
- If provenance of a proposed artifact is uncertain, it is excluded and independently redesigned.

## 36. Acceptance criteria for the product specification

Phase 0 is accepted when all of the following are true:

- This document exists at `docs/product-spec.md`.
- All 37 required sections are present and internally consistent.
- The product is clearly incident-management software, not a social product or demo collection.
- Core entities and glossary terms have one consistent meaning.
- Personas, incident-scoped commander assignment, admin role, and permissions are explicit.
- Every initial route has access rules and a defined purpose.
- Incident status transitions and terminal behavior are explicit.
- Severity levels and their product effects are explicit.
- Authentication restoration, expiration, refresh, logout, and protected return behavior are explicit.
- Timeline sources, ordering, deduplication, tombstones, pagination, and scroll expectations are explicit.
- Optimistic sending, confirmation, unknown outcome, failure, Retry, Delete, and identity reconciliation are explicit.
- Thread ownership, reply depth, responsive presentation, and failure behavior are explicit.
- Deep-link resolution and missing/deleted/forbidden/unavailable/network outcomes are explicit.
- Realtime is not treated as the sole source of truth.
- Connection states and missed-event synchronization after reconnect are explicit.
- Presence is classified as ephemeral and separate from persistent server entities.
- Notifications, search, Command Palette, and postmortem behaviors are defined.
- Demo controls and deterministic fictional data requirements are defined.
- Desktop, tablet, and mobile information architecture is explicit.
- Focus, announcements, reduced motion, virtualization, and deep-link accessibility are addressed.
- Error, empty, loading, and permission states are explicit.
- Out-of-scope and clean-room constraints are explicit.
- All architecture-significant Phase 0 product decisions are resolved and recorded normatively in their relevant sections.
- Durable outbox/draft identity behavior, multi-tab scope, create-incident behavior, confirmed-message immutability, and postmortem conflict behavior are explicit.
- No application scaffolding, dependencies, implementation, mock API, WebSocket layer, components, styles, or tests have been created in Phase 0.

## 37. Final Phase 0 product decisions

This decision log records the material choices finalized during Phase 0. Normative behavior lives in the referenced sections; this table is traceability only.

| # | Final decision | Normative sections |
|---:|---|---|
| 1 | `Resolved` is terminal; reopening and backward transitions are excluded. | 7, 34 |
| 2 | Current commander or admin may transfer command only to an active participant; one persistent system event records the transfer. | 4, 33 |
| 3 | Resolved incidents keep readable history but disable timeline/thread composition. | 7, 18, 20 |
| 4 | Messages allow 4,000 characters; Enter inserts newline; Cmd/Ctrl+Enter sends; IME never triggers send. | 18 |
| 5 | Identity-scoped durable outbox survives appropriate reload/session restoration, reconciles before replay, clears on logout, and is not offline-first. | 9, 19 |
| 6 | Identity-scoped per-incident/per-thread local drafts survive navigation/reload and clear on send, discard, or logout. | 9, 18 |
| 7 | Remote search begins at 2 trimmed characters and initially returns at most 10 results per type. | 26 |
| 8 | Create Incident is a one-step accessible modal/sheet; creator becomes commander/participant and enters the new Triggered incident. | 27, 33 |
| 9 | All active members can read all workspace incidents; participation controls writing. | 4, 33 |
| 10 | Postmortem uses ordinary save/conflict behavior, with no realtime collaborative editing or publish workflow. | 28, 34 |
| 11 | Confirmed human messages cannot be edited/deleted; only failed unconfirmed local messages may be removed locally. | 6, 20, 34 |
| 12 | Timeline is oldest-to-newest with newest at bottom and conditional follow-newest behavior. | 14, 16 |
| 13 | Responsive surface migration preserves active target/navigation/thread/draft/scroll state. | 21, 30 |
| 14 | Initial authored content is untrusted plain text with mentions and detected safe URLs; no rich-text/Markdown formatting. | 18, 34 |
| 15 | Multiple tabs are independent clients; normal server synchronization converges confirmed state, without dedicated cross-tab coordination. | 9, 19, 34 |

Additional fixed assumptions:

- One active workspace per session.
- Incident URLs use the human-readable incident number.
- Threads are chronological discussions with one visible reply-reference level.
- Deleted persistent records use tombstones where server simulation or deep-link continuity requires them.
- Incident list date filtering uses `createdAt`.
- Presence does not affect `updatedAt`.
- Postmortem Action Items are simple structured text items initially.

No architecture-significant product question remains unresolved for Phase 1.
