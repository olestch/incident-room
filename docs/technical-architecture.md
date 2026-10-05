# Incident Room — Technical Architecture

**Status:** Phase 5 Realtime Synchronization

**Product authority:** [Accepted Phase 0 specification](product-spec.md)  
**Implementation scope:** Phases 1–4 plus deterministic realtime transport, persistent journal, reconnect/resync, presence/typing and New updates. Threads, production WebSocket infrastructure and visible Demo Mode remain future work.

The accepted product specification remains an immutable Phase 0 snapshot. Its historical “Not started” marker is preserved; current implementation progress is tracked here and in README. This document introduces no new product behavior.

## 1. Architecture goals

Support one coherent incident-coordination product with reliable identity isolation, paginated history, durable optimistic work, and accessible responsive navigation. Phase 4 implements Timeline, drafts and outbox; Phase 5 adds realtime synchronization and ephemeral room activity. Sections 41–42 record concrete decisions. Threads and visible demo controls remain future work.

## 2. Architectural principles

- One owner per category of state; do not copy server resources into Redux.
- Runtime boundaries accept `unknown` and validate before entering trusted code.
- Stable identity and revisions, not network arrival order, determine reconciliation.
- Cancellation and lifecycle disposal are explicit.
- Persistence is user-scoped; authentication precedes restoration.
- Public framework documentation and this project's own documents are the only implementation references. The private commercial repository is not consulted.
- Build only infrastructure needed now; later capabilities below are designs, not claims of implemented features.

## 3. Runtime model

Next.js provides route composition, rendering, and static assets. The browser owns interactive application sessions, QueryClient, Redux store, HTTP requests, realtime services, and IndexedDB. Every provider mount gets fresh client state; no process-global server store exists. Service instances are outside Redux and dispose subscriptions, observers, and controllers on identity change/unmount. Each tab is an independent client.

## 4. Next.js rendering strategy

Root layout, initial placeholder, metadata, and static route composition are Server Components. Interactive providers are a narrow Client Component island accepting server-rendered children. Future protected routes render a neutral shell on the server while browser mock session restoration determines authorized content. Sensitive mock resources are not fetched from RSC or prerendered into shared HTML.

For a future real backend, request-scoped cookie-authenticated RSC checks/prefetch may be introduced with a separate QueryClient and hydration. They must preserve browser cache ownership and user isolation. No static export, experimental cache mode, server actions, or custom server is required now.

## 5. Server Component / Client Component boundaries

| Surface                                                | Boundary            | Reason                                                                  |
| ------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------- |
| Root layout, static page, metadata                     | Server              | No browser APIs or application state required.                          |
| Provider composition                                   | Client              | React context and per-mount runtime instances.                          |
| Error recovery surface                                 | Client              | Retry callback and focus interaction.                                   |
| Future Incident Room, forms, virtual timeline, threads | Client              | Continuous interaction, measurements, realtime, and optimistic updates. |
| Future session gate                                    | Client in mock mode | MSW/browser session restoration precedes protected rendering.           |

`"use client"` is declared only at genuine boundaries. Module-level access to `window`, IndexedDB, or WebSocket is forbidden.

## 6. Project/module structure

```text
src/
  app/                         Next.js routes, global CSS, metadata, composition
    _providers/                application wiring and per-mount Redux store
    _incidents/                session-aware incident Query/routing integration
    _mocks/                    app-level auth + incident authority composition
  features/
    session/                   auth forms, session coordinator/adapter, mock authority
    incident-management/       incident use-case UI and mock authority/handlers
    realtime/                  transport contract and connection coordination
  shared/
    errors/                    typed application error categories
    diagnostics/               allowlisted structured diagnostics
    query/                     QueryClient defaults and identity scope keys
    ui/                        reusable non-domain error recovery surface
    testing/                   test setup only; never in production imports
  entities/current-user/       canonical current/workspace-user schemas and keys
  entities/incident/           incident schemas, policy, filter codec, comparators and keys
tests/e2e/                     browser smoke, authentication and incident journeys
docs/                          product and technical source documents
```

Later `entities/<domain>/` modules own validated resource models, query keys/options, and pure rules. Add them when implemented, not as empty placeholders. Features implement use cases; routing composes features. Application integration orchestrates cross-feature service interactions.

## 7. Dependency rules between modules

Direction: `app → features → entities → shared`. `app` may use any lower layer; features cannot import app or sibling features; entities cannot import features/app or sibling entities. Shared cannot import upper layers. Relationships use IDs/contracts instead of circular entity imports.

ESLint enforces upper-layer restrictions and feature/entity isolation with `no-restricted-imports`; it also rejects parent-relative imports and deep aliases into another feature/entity. Same-module internals remain allowed. App composition is the explicit integration point. Third-party boundary contracts stay in their owner, not a global types bucket.

TypeScript uses `strict: true` to reject implicit unsafe values and unchecked nullability; `noUncheckedIndexedAccess: true` requires handling missing array/map entries; `exactOptionalPropertyTypes: true` distinguishes absent fields from explicitly undefined payload values. Prefer omitted optional fields, validated unknown boundaries, and narrow unions over broad casts. `skipLibCheck` skips dependency declaration checking only; application code remains strictly checked. The alias resolves from project root to `src/`, and ESM is used consistently in project configs.

## 8. Routing architecture

Phase 2 implements `/login`, `/register`, `/forgot-password`, and the `/app/*` client session gate. `/app/incidents` and recognized deeper product destinations are explicit placeholders, not business pages. The root layout remains server-side; public forms and protected shell are narrow client boundaries with Suspense around URL hooks. Anonymous protected navigation preserves path/query/hash as `returnTo`; authenticated login/register are public-only and immediately resume a safe destination.

Authentication-boundary return uses `window.location.replace` on the centralized validated destination, intentionally creating a fresh browser runtime; ordinary app/public links remain Next Link/router navigation. E2E exposed duplicated `#context#context` with Next 16.3.8 client-cache navigation; the full auth-boundary navigation preserves the exact validated hash without changing product behavior or patching framework internals. This is a concrete integration choice, not a rendering/state ownership redesign.

URL owns list filters/sort and `event`, `thread`, `message` targets. Thread is the parent timeline-entry context in URL; internal thread ID is resolved from it. Cmd/Ctrl+K and Create Incident are feature use cases, not separate routes now. Return destinations accept safe internal `/app/` paths including query/hash, reject external/protocol-relative paths, and default to `/app/incidents`. No speculative proxy/middleware gate before auth exists.

## 9. Authentication/session architecture

`features/session` owns `SessionAdapter`, `HttpSessionAdapter`, and `SessionCoordinator`. Redux exposes the discriminated lifecycle `restoring | anonymous | authenticated | refreshing | expired`, generation, and minimal user/workspace/role/expiry references. Display name/email/active profile belong only to identity-scoped current-user Query data. The validated session envelope seeds that cache before exposing authenticated state. Mismatched envelope identity/profile or a current-user response for a different identity is rejected before cache population.

Mock auth uses the public opaque `ir_fictional_client` SameSite cookie as a fictional authority correlation handle, passed in `x-fictional-client`; it is not a bearer/refresh token or a security boundary. Access lasts five minutes, refresh eligibility one day. The fictional authority stores account profiles, one-way fictional password verification digests and client leases atomically in its separate IndexedDB database. Submitted raw passwords exist only during form/request processing, are cleared after submission, and are never persisted or logged. Verification digests are mock-server records, never Redux/Query/client session credentials; SHA-256 here is deliberately not production password hashing. Never enter a real password in this portfolio. A future real adapter uses secure HttpOnly SameSite cookies and server-enforced checks.

Browser initialization awaits MSW before restoration/requests. Worker/restore progress becomes a retryable UI error after 12 seconds; HTTP operations have a 12-second timeout. Normal anonymous restoration does not flash protected UI. Invalid refresh ends in the login expiration message, while storage/network/validation boot failures have explicit restoration Retry.

One refresh Promise per tab coordinates concurrent expired requests; near-expiry reads proactively join it. A refresh revision also prevents a late pre-refresh 401 from launching a second refresh. Only declared safe reads retry once; arbitrary mutations are not replayed. Login/register/reset/logout call their direct adapter operations and cannot enter a generic refresh loop.

Invalid refresh synchronously advances generation, hides private UI, aborts the scoped controller, cancels/removes identity Query data, and resets connection/local-work coordination. Late signal-ignoring results fail generation checks. `LocalWorkService` immediately invalidates identity leases, drains started storage transactions and registers with `registerLifecycle`. Expiry/switch/dispose quarantine existing durable work; explicit logout deletes it only after the drain. Logout hides identity immediately, calls authority logout and identity-specific cleanup, and forgets the local correlation cookie even on HTTP failure. Cleanup failure is surfaced, blocks new authentication and retains a retryable cleanup identity; the login page exposes cleanup Retry. No automatic mutation replay.

Multi-tab: ordinary HTTP authorization checks, restore/refresh, and realtime disconnects eventually reflect invalidation. No BroadcastChannel, shared connection, cross-tab refresh lock, or outbox leader election. Persistent confirmed state converges through the mock server described in section 31.

Each adapter captures its active fictional client handle. Logout and cleanup retries target that captured handle; cookie removal is conditional on the same handle still being current, so a stale tab cannot revoke/remove a newer client's session. Login/register explicitly acquire the current correlation handle. Profile responses are checked against the captured frontend identity before Query accepts them; the active shell revalidates current-user through ordinary Query focus/reconnect and a 60-second interval.

## 10. Authorization/permissions architecture

`entities/incident` exposes the pure central policy over active user, workspace role, incident participants/commander and status. Timeline compose and mock creation both use `canWriteIncident`. Resolved disables writes even for admins; all active workspace members can read. Other semantic predicates exist, but status/severity/participant/command-transfer action UI is not implemented yet.

MSW authorities invoke the same product policy independently of UI hiding. A real backend must independently enforce authorization; fictional browser storage is not a security boundary.

## 11. Server-state ownership

TanStack Query owns incidents, users, confirmed timeline history/target windows, threads/messages, notifications, search results, and postmortems. Validated responses enter the cache. No Redux mirror or persisted copy of confirmed Query resources.

Query keys start with `['identity', userId, workspaceId]`, then resource and parameters. Entity modules own resource key factories and query options. Infinite-query keys exclude individual page cursor; page parameters own cursors. Timeline normal and target windows have distinct keys but share reconciliation rules. Identity switch cancels and clears old caches before new resource observers mount.

Foundation defaults: stale time 30 seconds; GC 5 minutes; one retry for transient read failures; no retry for validation/authentication/authorization/not-found/conflict; no automatic mutation retry. Refetch on focus and reconnect uses stale data only. Session, search, and active-room queries override defaults intentionally. Query functions consume Query-provided AbortSignal. Invalidation targets resource keys, never arbitrary global resets except identity teardown.

## 12. Redux/client-state ownership

Redux owns session/connection lifecycle and serializable local mutation ID/delivery-state coordination metadata. Hydrated local bodies remain in the room's transient projection, with durable ownership in IndexedDB. Confirmed resources/profile remain in Query; dialogs/forms remain local; the active target is URL-owned. Realtime checkpoints/buffers belong to identity-bound runtime services; ephemeral snapshots are room-local state. Demo settings remain future work. Runtime objects stay outside Redux.

Store factory is invoked per provider mount and typed hooks expose dispatch/selectors to app integration. Features do not import app hooks/store: application composition passes semantic state/commands to their UI, and services accept injected lifecycle callbacks. Default immutability/serializability middleware stays enabled; DevTools enabled only outside production. No sockets, DOM nodes, timers, controllers, Promises, errors, QueryClient, or database handles in state. Services dispatch plain serializable lifecycle facts through application wiring.

## 13. Realtime architecture

```text
native WebSocket adapter / deterministic mock adapter
  → unknown incoming payload
  → protocol validation (Zod)
  → realtime coordinator
  → application event routing
  → Query resource reconciliation / Redux lifecycle or ephemeral presence
```

Phase 1's transport port is implemented by the Phase 5 deterministic mock adapter; it adds a semantic watermark and typing command. The coordinator owns event IDs/revisions, backoff, committed checkpoints and disposal. Application composition injects session-authenticated HTTP capabilities and Query reconciliation. React consumes state/semantic commands, not raw socket callbacks. Invalid payloads are isolated; diagnostics record categories only. No Socket.IO or production WebSocket server.

Persistent mock envelopes validate workspace, event identity, resource revision and synchronization sequence. Presence/typing are ephemeral and expire. A future native WebSocket adapter may share this port; production backend/auth protocol is not claimed.

## 14. Reconnect/resynchronization architecture

Separate transport open from synchronized application state. Redux connection state may be reconnecting with internal sync phase pending even after the socket opens.

Recovery: obtain session → connect/subscribe and buffer incoming persistent events → request changes after last committed checkpoint up to server high-water mark → validate and merge → drain buffered events newer than checkpoint → commit checkpoint → report connected. Duplicate events and overlap are harmless. Advance checkpoint only after all changes through it apply; resource revision prevents stale resurrection.

Bound retries with exponential backoff and jitter through an injectable clock/random source (seeded in tests). Logout/disposal cancels reconnect timers. If the change cursor expires, authoritative bounded resource snapshots replace affected cache windows while preserving local outbox and scroll anchors. HTTP resync remains available when realtime is unavailable. Refresh session once on authorization failure; permanent failure uses session teardown. Presence is replaced by a fresh snapshot, not replayed history.

## 15. Optimistic mutation architecture

Create `clientMutationId` once per message, keep it across retry. Persist before clearing draft. Redux coordinates IDs/delivery states; IndexedDB retains content; the ordered view derives confirmed Query records plus local pending projection. Do not insert another canonical confirmed object into Redux.

| Race                                   | Required convergence                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Realtime echo before HTTP result       | Associate mutation with server record; later HTTP acknowledgment is a no-op for identity. |
| HTTP before echo                       | Associate once; later echo merges newer revision only.                                    |
| Duplicate event/response               | Same server ID or mutation ID yields one visible logical item.                            |
| Timeout/disconnect                     | Mark unknown outcome, look up mutation outcome before retry.                              |
| Resync finds successful unknown action | Confirm locally, remove durable pending content after acknowledgment.                     |
| Definitive rejection                   | Failed state with Retry/Delete, retaining body.                                           |

The Timeline authority enforces idempotency by workspace/incident/user/clientMutationId. Row identity includes the author and mutation UUID, remaining stable across confirmation. Retry never creates a new identity. Definitive HTTP 4xx rejection is failed; timeout, transport or malformed-response ambiguity requires outcome lookup. Timeline human-message creation is implemented; other mutations remain future work.

## 16. Outbox architecture

IndexedDB is the durable owner of local message body, mutation ID, identity/incident/thread scope, provisional order, attempt metadata, and pending/sending/failed/unknown outcome. Redux holds active-session coordination metadata and a transient hydrated local projection for rendering; this is local work, not a server cache. Query owns confirmed records. HTTP service sends commands with stable identity and queries outcomes before replay-capable work.

On reload/reauthentication: establish identity → load only matching records → treat previously in-flight records as unknown → reconcile outcomes → expose still-unsent/failed work and explicit Retry. No blind replay, background worker, or offline-first promise. A failed message can be deleted only if still unconfirmed. Explicit logout deletes that identity's durable records. Another identity cannot enumerate/render them through application APIs. Each tab is independent; backend idempotency protects concurrent same-ID attempts without cross-tab locking.

## 17. Draft persistence architecture

Draft storage is separate from outbox. Keys include user/workspace/incident and optional thread or parent-entry context before a thread exists. One timeline draft per incident and one per thread. Debounced durable writes flush on relevant navigation; restoration waits for identity. Draft moves atomically into outbox on Send before clearing the editor. Discard and explicit logout delete drafts. Navigation/reload retains them; session expiry quarantines them; another identity never sees them. No server drafts.

## 18. IndexedDB ownership

One native `IndexedDbAtomicStore` owns a version-1 `records` store. Local-work records use a compound identity key, a per-incident draft dictionary and scoped outbox records. Atomic read/modify/write covers draft deletion plus outbox insertion. This bounded portfolio implementation intentionally uses one identity bucket rather than separate object stores/indexes (section 41). Confirmed Query state and tokens are never persisted here. Zod rejects incompatible/corrupt records without silently deleting them. Storage errors preserve editor content; real browser reload and injected adapter failures are tested.

## 19. Timeline data model strategy

Validated discriminated unions now model human, monitoring, deployment, status, severity, participant and system entries. Stable server ID, incident ID, occurred/created times, authoritative tie-order, revision, important flag, actor/author where applicable, mutation identity and tombstone metadata enter Query only through Zod.

Query infinite pages represent acquisition windows, not three UI lists. A memoized projection deduplicates all loaded confirmed pages/target windows and overlays local work into one logical sequence. Real-time deltas update compatible loaded windows; out-of-window records live in a bounded Query-owned live window. The projection indexes IDs; no Redux server entity collection.

## 20. Timeline ordering/reconciliation strategy

Confirmed comparator is `(occurredAt, serverTieOrder, serverId)` ascending. Transport sequence tracks synchronization and is not occurrence ordering. Client time determines only provisional placement. Preserve prior provisional position for failed items; authoritative confirmation may reorder once if necessary.

All sources use the same transport-independent `mergeEntries` rule: server-ID dedupe, highest revision, and tombstone precedence at equal revision. The projection maintains a revision index and caches confirmed rows/order by Query resource references; local delivery changes do not re-sort confirmed history. Changed confirmed acquisition batches sort once, not on viewport/editor renders. Mutation aliases include author identity. Confirmed human messages have no edit/delete UI; tombstones arrive only from fictional authority fixtures.

## 21. Pagination strategy

`useInfiniteQuery` acquires 60-entry recent/older windows; its key excludes the cursor. Opaque authority cursors bind workspace/incident and the first ID of the already loaded page. Older boundaries remain stable under concurrent append because they are ID-based rather than offsets; transport synchronization sequence is separate from history cursors. `cancelRefetch: false` coalesces repeated boundary requests. Empty/no-older means beginning of history; failed requests preserve prior rows and expose boundary Retry. Target windows contain at most 51 entries.

Deep links use a target-locator/window request rather than sequentially paging to a distant event. Target windows enter Query and the same ordered projection without pretending that gaps are continuous history; gap boundaries remain explicit and loadable. Thread and notification pagination use resource-specific options. Search page pagination is grouped; Command Palette is capped.

## 22. Virtualization strategy

Use TanStack Virtual with stable logical row keys, estimates for unseen rows, `measureElement`/ResizeObserver for mounted rows, small overscan, and a dedicated scroll viewport. Before prepend/height-affecting changes capture first visible row key plus within-row offset. After committed measurements restore that anchor once, avoiding double compensation with browser scroll anchoring. Width changes invalidate relevant measurement estimates, not logical navigation.

Within 96px of newest, appends follow; historical reading does not jump. New updates counts distinct created confirmed entries, not revisions, duplicate delivery or HTTP overlap; explicit activation returns to latest without deleting unrelated URL parameters. Deep-link resolution waits for committed row/mount/measurement and corrects through the virtualizer. Focused rows stay in the custom range; removed local rows transfer focus to the viewport. Real 10,000-row component projection and 10,000-entry browser authority fixtures demonstrate bounded DOM; generator capability at 50,000 is separately tested. No FPS claim or fragile timing threshold.

## 23. Deep-link resolution architecture

One route-owned navigation generation and AbortController owns target work: session ready → authorized incident → locator/window → entry → thread → message window → surface mounted → target measured → scroll → focus/highlight. Query functions consume the signal; every continuation compares current generation/identity. Element readiness registers callbacks keyed by logical target, with observer/commit signals, not arbitrary sleep loops.

Bounded timeout produces retryable locating failure and cleans listeners. Missing/deleted/forbidden/unavailable outcomes follow product section 21. A newer URL supersedes old work. Responsive panel-to-sheet migration re-registers presentation readiness using the same logical target/generation, preserving draft, Query data, and timeline anchor. Re-announce only when legitimate focus migration requires it.

## 24. Search/request cancellation strategy

Trim query; remote global search starts at two characters after a 200 ms debounce. Stable query key includes identity, normalized query, result type, and filters. Query-provided AbortSignal passes to fetch; stale result of an old key never replaces current results. Initial cap ten per type, additional cursor pages only on Search page. Palette remains bounded. No speculative dedicated search client/cache; entity query options and shared HTTP boundary suffice.

## 25. Error handling

`AppError` carries a safe category/message/status, not raw server bodies or secrets. Categories: validation, authentication, authorization, not-found, conflict, network, realtime, unexpected. Later HTTP parsing validates error envelopes and maps unknown errors safely.

Fields get validation errors; unauthorized mutations revert/reconcile and explain; expiry goes to session coordinator; pagination/thread errors remain local; conflict preserves unsaved postmortem input; connection loss stays non-blocking; unexpected render failures use route/global boundaries with retry/home. Do not replace all errors with toasts. Mutation ambiguity is handled by outbox, not generic read retry.

## 26. Logging/diagnostics

Foundation exposes an injectable structured diagnostic sink with allowlisted event names and numeric metadata (attempt, duration, count). It cannot accept token/body/URL/free-form user context. No vendor and no noisy default console sink. Development may opt into a safe sink; future demo diagnostics use a bounded ring buffer. Realtime revision/dedupe/resync/outcome categories are sufficient for troubleshooting without message content. Rendering fallback never prints raw exception text.

## 27. Demo Mode architecture

Later one application runtime chooses mock HTTP and mock transport, injecting seeded factories, scheduler, latency/failure policy, and event journal. Redux owns demo controls; mock runtime consumes a snapshot of configuration. Features do not branch on demo flags. Expose isolated developer surface only in selected demo build; route permissions do not derive from demo controls. Seed + logical clock + operation counter make datasets and faults repeatable; reset is explicit and clears mock/durable demo state after confirmation.

## 28. Accessibility architecture

Semantic landmarks, skip link, visible focus, labeled states, and reduced-motion CSS start now. Later install specific Radix primitives when modal/sheet/palette requires focus trapping; no unused component library now. Shared live-region conventions summarize realtime bursts politely. Target navigation announces one target and restores initiating focus on close. Virtualized rows maintain list position metadata and focus retention. RTL asserts roles/name/keyboard recovery; Playwright checks actual browser keyboard behavior. Do not confuse a static axe score with complete assistive-technology behavior.

## 29. Responsive architecture

Mobile-first CSS uses 48rem context-detail and 64rem two-column thresholds. Desktop keeps incident context beside Timeline; mobile condenses context but preserves status/severity/heading. The viewport uses dynamic viewport units and compose includes safe-area padding. Resize remeasures rows without recreating URL target, draft or delivery coordination. Threads/panel migration remain future work. No device-specific domain stores.

## 30. Testing strategy

Vitest with Vite React transform, jsdom, Testing Library, jest-dom, and user-event. Unit tests verify query retry policy and fresh store isolation; component tests verify keyboard-triggered error recovery and provider interaction with Redux/Query in independent scopes. No large snapshots or future business tests.

Playwright runs desktop/mobile Chromium against production `build` + `start`. Auth, incident management, draft/outbox recovery, optimistic/failed/unknown delivery, anchor, old target/tombstone, supersession and responsive Timeline flows are implemented. Phase 5 adds independent-client realtime, recovery, expired snapshots, presence/typing and metadata flows. Thread migration remains future work. Async Server Components are validated through browser E2E, not jsdom.

Phase 2 integration tests use real MSW node handlers and the injected in-memory authority/clock: single-flight refresh, late 401, proactive refresh, non-replayed mutation, terminal teardown, stale A → logout → B, cleanup failure/retry and malformed response. Form tests exercise semantic validation/focus/submission/error/recovery. Browser tests cover protected/deep return including exact query/hash, register/reload, logout/switch, generic recovery, valid/terminal expiry, public-only gates, unknown routes and 320px/tablet overflow/keyboard behavior in desktop/mobile projects. Expiry is forced through the injected authority API in unit tests and test-only IndexedDB lease fixtures in E2E; no visible control, test HTTP endpoint or window global exists.

Timeline tests enumerate revision/tombstone/alias races and persistence/delivery outcomes. Browser tests use actual native IndexedDB; unit/integration tests use injectable atomic storage. Realtime tests inject port/clock/randomness and use no real timer sleeps. All data is independently authored and fictional.

## 31. Mock backend architecture

MSW handles HTTP; deterministic service rules are separate from handlers and reusable in tests. Phase 2 implements only `/mock-api/auth/{login,register,forgot-password,logout,session,refresh,me}`. `MockAuthAuthority` uses an `AuthorityStore` contract: in-memory for unit/integration tests, native IndexedDB transactions in the browser for reload and independent-tab convergence. Seed users River Vale and Sage Linden belong to fictional Orbit Workshop. There is no real backend, email delivery, OAuth or token-reset workflow. Recovery always returns the same success response for known/unknown accounts.

The generated `public/mockServiceWorker.js` is an unchanged MSW 2.15.0 vendor asset, ignored by formatting/lint only; all application code remains checked. Browser MSW runs in the portfolio production build as well as development so `build/start` demonstrates auth. It suppresses request/body logging and surfaces unmatched auth-namespace requests; unrelated Next/static traffic is bypassed. Native fetch is resolved at call time with its correct global receiver, after interception initialization. No mock APIs are invoked from feature UI.

Incident CRUD/list, Timeline window/locator/outcome/create and realtime open/stream/sync/snapshot handlers exist. Mock authorities are separate from MSW; app composition injects auth, source-change ingestion and resource reconciliation. Postmortem conflicts remain future work. Timeline fixtures are lazily generated per requested room, not at application startup.

For multi-tab convergence mock authorities use IndexedDB transactions for confirmed mock resources/session/event journal, distinct from user-local draft/outbox stores. Each tab's MSW handlers read that authority; independent transport simulators poll journal with per-tab cursors and can intentionally miss/delay/duplicate delivery. This is ordinary simulated server/realtime synchronization, not direct tab messaging or shared client coordination. Tests use in-memory authorities where appropriate. Mock persistence is fictional browser data, never a production backend/security claim.

Realtime simulator implements the same transport port: injectable scheduler and journal permit disconnect/reconnect, duplicates, reordering, presence/typing expiry, and missed-change resync. MSW is not used as an assumption that it automatically supplies WebSocket lifecycle.

## 32. Environment/configuration strategy

No custom environment variable is required in Phase 1, so no `.env.example` is invented. Next's NODE_ENV governs DevTools/test server policy. Later public demo/service selectors must be non-secret and validated with Zod; server credentials belong only to server environment/modules. NEXT_PUBLIC values are exposed to every browser and may not hold secrets. Relative same-origin mock requests avoid accidental production endpoints.

## 33. Security considerations

Rendering uses escaped untrusted text; no arbitrary HTML/Markdown. Future detected URLs admit safe HTTP(S) protocols, rejecting executable/data schemes. Validate HTTP/realtime/persistence data with Zod. Safe return URL validation prevents open redirects. Real backend authorization is independent of frontend policy. Identity teardown includes stale async generation protection and durable logout cleanup. No passwords/tokens in logs, Query, Redux, URLs, or durable local stores. Mock users, services, URLs, and data are fictional. Product section 35 remains unmodified and mandatory.

## 34. Performance strategy

Static shell is server-rendered with minimal client providers; no remote font fetch during build. Feature modules are loaded with their route; simulator and diagnostics do not enter unrelated bundles. Query pages are bounded, loaded IDs indexed, updates batched, and stale identity caches cleared. Virtualizer limits DOM work, not just data fetches. Avoid repeated full sort/map and giant Redux serializability scans of confirmed timelines. Later benchmark seeded 50,000-entry room (DOM count, scroll responsiveness, merge/measurement latency) on repeatable browser hardware; no unverifiable performance claims now.

## 35. Dependency decisions

Exact versions are pinned in package.json; lockfile is committed. Node 24 and pnpm 11.19.0 are the project baseline. Registry stable tags were checked during initialization.

| Dependency                                                   | Owner/purpose                   | Justification                                                      |
| ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------ |
| Next.js, React, React DOM                                    | app runtime                     | App Router, RSC composition, interactive rendering.                |
| TypeScript, React/Node types                                 | all source                      | Strict compile-time contracts.                                     |
| Redux Toolkit, react-redux                                   | app coordination/providers      | Serializable client lifecycle state and typed hooks.               |
| TanStack Query                                               | shared/query + future entities  | Server cache, cancellation, infinite queries, invalidation.        |
| TanStack Virtual                                             | timeline feature                | Measured variable-height viewport with keyed prepend anchoring.    |
| React Hook Form, Zod                                         | future forms/runtime boundaries | Form lifecycle and validation of unknown data.                     |
| Tailwind, PostCSS adapter, PostCSS                           | app styles/build                | Small token-based mobile-first styling, current Tailwind v4 setup. |
| MSW                                                          | future mock HTTP/test boundary  | Deterministic HTTP interception without production backend.        |
| Vitest, Vite, React plugin                                   | testing build                   | Isolated TS/React test transforms.                                 |
| RTL, DOM Testing Library, jest-dom, user-event, jsdom        | component tests                 | Behavior/keyboard/semantic assertions.                             |
| Playwright                                                   | browser tests                   | Real routing/rendering/viewport and future lifecycle tests.        |
| ESLint, eslint-config-next                                   | engineering boundaries          | Next/React/accessibility lint and import restrictions.             |
| Prettier                                                     | formatting                      | Consistent reviewable source/config/document formatting.           |
| Native WebSocket, IndexedDB, AbortController, ResizeObserver | runtime adapters                | Selected platform capabilities require no extra package.           |
| Radix UI/shadcn primitives                                   | later accessible surfaces       | Deferred until dialog/palette exists; no unused dependency now.    |

Compatibility choices: TypeScript 5.9.3 remains inside typescript-eslint's supported range (`>=4.8.4 <6.1.0`; latest TypeScript 7 is outside it). ESLint 9.39.5 is retained despite its end-of-support warning because the current stable eslint-config-next dependencies eslint-plugin-react, eslint-plugin-import, and eslint-plugin-jsx-a11y do not declare ESLint 10 support. This is an explicit compatibility limitation, not a silent outdated-tool choice; upgrade once that peer support lands. jsdom 27.4.0 supports installed Node 24.8 (latest jsdom requires newer Node 24). MSW 2.15.0 is selected because Vitest 5's mocker currently declares MSW `^2.4.9` compatibility, not MSW 3; no unsupported peer override is used. Other selected libraries use compatible stable releases. No RTK Query, Zustand, Socket.IO, persistence framework, icon pack, observability vendor, or large UI library.

## 36. CI strategy

GitHub Actions on main pushes and pull requests: checkout → pinned pnpm → Node 24 with pnpm cache → frozen lockfile install → formatting check → lint → typecheck → Vitest → production build → install Chromium → Playwright smoke against production server. One Chromium engine with desktop/mobile viewports keeps setup cost bounded. Upload browser report on failure; cancel obsolete same-branch runs; read-only repository permissions and no secrets. CI performs checks only, no deployment/publishing. Action releases are pinned to checkout 7.0.1, setup-node 7.0.0, upload-artifact 7.0.1, and pnpm/action-setup 6.1.0 after checking their published Node 24 action definitions.

## 37. Architecture decision records / important decisions

| Decision                 | Alternatives considered                             | Choice and reason                                                                                                              |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Rendering                | Entire app client, all resources RSC                | Static RSC shell plus client runtime; interactive room does not benefit from repeated server rendering.                        |
| Server state             | Redux cache, RTK Query                              | TanStack Query only; respects selected stack and avoids mirrors.                                                               |
| Local work               | Query mutation-only state, server-cache persistence | Durable IndexedDB outbox + Redux coordination; survives reload and reconciles stable identity.                                 |
| Realtime                 | Component sockets, Socket.IO                        | Transport port + service + routing; no extra protocol requirement.                                                             |
| Mock multi-tab           | Per-tab memory only, BroadcastChannel               | Shared fictional authority/event journal read by independent clients; ordinary synchronization without cross-tab coordination. |
| Virtual navigation       | Timer retries, load all history                     | Locator/windows plus cancellable readiness signals; scales to distant target and variable measurement.                         |
| UI package               | Full component library, premature design system     | Tailwind tokens now; specific Radix primitives when needed.                                                                    |
| CI E2E                   | Defer all browser checks, all engines               | Small production-shell Chromium smoke in two viewports.                                                                        |
| Formatting accepted spec | Reformat all Markdown                               | Ignore accepted Phase 0 file to preserve exact source.                                                                         |

No architecture-significant product decision is reopened. Later protocol/schema details are technical work in their feature phases, not unresolved product requirements.

## 38. Explicit non-goals

Phases 1–4 established tooling, session lifecycle, incident management and Timeline/local work. Authorized Phase 5 adds mock realtime, reconnect/resync and presence/typing. It excludes Threads, notifications/search/palette business behavior, postmortem editing, status/severity/command/participant action UI, visible Demo Mode, production backend/WebSocket server and OAuth. No private repository reference, proprietary fixture or copied implementation. Stop after Phase 5; Phase 6 requires explicit approval.

## 39. Phase 1 acceptance criteria

- This document records all required ownership/lifecycle/rendering/mock/security decisions.
- Strict typecheck includes noUncheckedIndexedAccess and exactOptionalPropertyTypes.
- Redux and Query providers instantiate isolated runtime state behind a client boundary; root layout stays server-side.
- Tailwind tokens and accessible placeholder work in desktop/mobile browser.
- ESLint enforces import direction, explicit unsafe-any prohibition, and Next accessibility rules.
- pnpm is pinned with one lockfile; clean install has an obvious README workflow.
- Formatting, lint, typecheck, meaningful foundation tests, production build, and browser smoke execute.
- CI repeats the reliable required checks without secrets.
- Accepted product specification and clean-room requirements remain unchanged.
- No incident business feature is substantially implemented.
- Validation results and any environment blockers are recorded in completion report before commit/push.

## 40. Phase 3 concrete incident slice

- **Ownership:** `entities/incident` owns normalized incident schemas, severities/statuses, query-key factories, pure filters/comparators and semantic policies. Incident relationships are `commanderId`, `participantIds`, `serviceIds`; full profiles are not embedded. The existing `entities/current-user` is the canonical user entity layer and now also exposes the workspace-user resource (including deactivated status for policy/display). No sibling-entity imports or Redux resource mirror.
- **Policies:** `entities/incident/policy.ts` implements view/create/write, severity/status, participant management, transfer, important-entry and separate postmortem capabilities. Active same-workspace users read/create; participants write operational content; commander/admin coordinate. Resolved forbids operational writes even for admins. Postmortem initiation requires Resolved, commander/admin and not initiated; draft edit requires an initiated resolved document and participant/commander/admin. No postmortem state or mutation UI is invented in this phase. `canTransition` permits only forward transitions; Resolved is terminal.
- **Mock authority:** app-level `app/_mocks/browser.ts` composes independent auth and incident handlers. Incident handlers receive an authenticated actor from the existing auth authority, never a client-selected role/commander. They independently enforce semantic policy, schema and active workspace reference eligibility. One MSW worker handles all `/mock-api/` resources; unknown mock routes fail closed, unrelated Next assets bypass. Public browser mock is not a production security boundary.
- **Persistence:** incident fictional server data uses a separate versioned IndexedDB database (`incident-room-fictional-incidents-v1`, singleton store `incidents`). Atomic read/write transactions serialize number allocation, record insert and idempotency receipt across tabs. It is not Query persistence, drafts or an outbox; no messaging/realtime synchronization is added. Seed: 32 fictional incidents, INC-2841 through INC-2872, all status/severity values and varied dates/assignments. Number allocation starts at INC-2873; authority clock owns creation/update times. Existing registered users can create and become commander.
- **Catalogs:** workspace users reuse River Vale (admin), Sage Linden (member), plus registered fictional active members. Five static fictional service IDs/labels: aurora-edge/Aurora Edge, cedar-orders/Cedar Orders, lumen-identity/Lumen Identity, willow-storage/Willow Storage, ripple-delivery/Ripple Delivery. No service-management feature. Workspace-user response is bounded at 200 records; service catalog is static domain reference data.
- **API/validation:** GET `/mock-api/workspace-users`, GET `/mock-api/incidents`, GET `/mock-api/incidents/:number`, POST `/mock-api/incidents` (`{input, requestId}`). Zod validates external responses and create input on both client and authority. The existing session-captured HTTP adapter exposes a generic resource method; app composition passes requests through `SessionCoordinator.request` and Query AbortSignal, without sibling-feature dependencies. Typed business errors stay AppError; 401 session codes retain refresh/terminal-expiry behavior. Minimal detail distinguishes loading/not-found/denied/retryable errors and displays no inaccessible incident context.
- **URL:** centralized codec in `entities/incident/filters.ts`; `status`/`severity` are comma-separated stable values (repeated parameters accepted); `assignedToMe=true`; `participant=<active workspace ID>`; `from=YYYY-MM-DD`; `to=YYYY-MM-DD`; `sort=updated|newest|severity` (default updated, omitted canonically). Legacy `assigned=me` is read and rewritten to canonical assignment on the next control change. Invalid individual values are ignored, duplicates normalized, unknown unrelated parameters preserved. Impossible dates ignored; reversed ranges retain from and ignore to. Date range is createdAt, UTC, inclusive calendar days: `[from 00:00Z, day-after-to 00:00Z)`. Native labeled inputs, no date library. Controls navigate with Next Router history; refresh/back/forward reuse URL state, never Redux. Changed controls truncate cached target pagination to first page and remove cursor.
- **Sort/pagination:** updatedAt descending then incident number; newest uses createdAt descending then number; severity uses explicit P1→P4 numeric rank then updatedAt descending then number. API returns at most 12 records plus nextCursor/total/workspaceTotal. Cursor uses last incident number and is bound to effective filters/sort/actor/workspace. It is a mock JSON token, not a credential or signed production cursor. Load more uses Query infinite queries. No list virtualization, offset fetching or whole-fixture client load. Cached confirmed pages survive background/pagination errors; no-match differs from an empty workspace. Filter controls remain visible while initial/new-key data loads; unrelated previous results are not shown under new filters.
- **Query keys:** `['identity', userId, workspaceId, 'incidents', 'list', effectiveFilters]`, `[..., 'incidents', 'detail', number]`, and `[..., 'workspace-users']`. Factories own literals. Session generation guards reject late requests; identity teardown cancels/removes the entire identity prefix. New detail is seeded after confirmation and list-prefix queries invalidated before navigation.
- **Creation:** RHF+Zod, trimmed title 1–160 and description ≤4000 characters, required P1–P4, validated optional service/participant IDs. Authority always sets Triggered, creator commander, creator included exactly once, and deduplicated selected active participants. No commander/status chooser. Confirmed mutation only, no automatic mutation retry/offline capability/optimistic local record. Per-form UUID receipt is scoped by workspace+actor; an identical manual retry returns the same record, differing input for an already-confirmed key conflicts. An ambiguous network outcome locks captured fields and retries the same key/payload. Pending ref and visible disabled controls prevent overlapping submits. Dirty close uses local native confirmation; after an ambiguous outcome it advises checking the list before creating another incident.
- **Presentation/testing:** native HTML dialog supplies top-layer modality, focus containment and Escape; cleanup restores trigger focus. CSS switches one logical form to a full-screen mobile surface at <768px, preserving values/errors across resize. Browser tests assert actual dialog behavior; jsdom only stubs the missing native methods. Errors associate with fields and focus title/global failure; confirmed detail focuses its heading. Absolute Intl timestamps use explicit locale/UTC, avoiding relative-time hydration drift. Fresh memory stores and fresh Playwright contexts isolate tests; concurrent tabs exercise real IndexedDB serialization/persistence. No dependencies added; no visible reset/test control. Accepted product specification is unchanged.

## 41. Phase 4 concrete Timeline foundation

- **Recovery:** Phase 4 resumed from clean `main` at Phase 3 commit `9a2e577`; the interrupted run had investigated requirements but created no Phase 4 files. No reset, discarded work, duplicate subsystem or rewritten public history.
- **Modules:** `entities/timeline/model.ts` owns seven Zod variants, body/window/locator/outcome schemas, comparator, revision merge and identity-scoped key factory. `features/timeline` owns generator, authority, handlers, local-work adapter/service, delivery coordinator, projection, target coordinator and UI. `app/_incidents/timeline-room.tsx` wires Query/session/Redux/URL without forbidden sibling-feature imports. `shared/persistence/atomic-store.ts` supplies the one reusable native transaction primitive.
- **Domain:** all confirmed entries have server ID, incident ID, type, occurredAt, createdAt, serverTieOrder, revision, important and nullable `{deletedAt, reason}` tombstone. Human messages add author/body and optional originatingClientMutationId. Other variants carry source/service/version, actor, status/severity transition or participant action as appropriate. Confirmed order is ascending occurrence time, tie-order, server ID, never arrival or client clock. Highest revision wins; an equal-revision tombstone beats a live record. Deleted content is never rendered.
- **HTTP contract:** authenticated GET `/mock-api/incidents/:number/timeline[?cursor=...]`, GET `.../locate?entry=...`, GET `.../outcome?mutation=...`, POST `.../timeline` with `{body, clientMutationId}`. Recent/older windows have ≤60 entries, target windows ≤51; response includes `olderCursor`, `newerCursor`, `total`. Base64 cursors are opaque mock tokens bound to workspace/incident and stable ID boundaries, not credentials or production signed tokens. Locate resolves an unloaded stable ID directly. The authority is separate from MSW; auth actor and incident access/activity are app-injected. A persisted append updates Incident.updatedAt before response/fault delivery, including ambiguity-after-persist. These are separate fictional authority transactions, not a claimed cross-database atomic commit; outcome recovery remains authoritative if the metadata update fails.
- **Query/projection:** keys are `['identity', userId, workspaceId, 'timeline', incidentId, 'history']`, separate `[..., 'target', targetOrGapId]` and `[..., 'acknowledgments']`. Infinite page parameters own older cursors. Query AbortSignal joins navigation/session cancellation. `TimelineProjection` derives one ordered row list from pages, target/gap windows, acknowledgments and local outbox. ID/revision index and author-scoped mutation aliases collapse overlap/confirmation. Confirmed batches sort only when Query resources change; local state updates reuse cached confirmed order, and scroll/editor renders reuse memoized projection. Maps index target IDs/logical row positions. Explicit gap rows load another bounded window, never pretend sparse history is continuous. No O(n²) repeated linear per-entry lookup.
- **Persistence:** native IndexedDB version 1 `incident-room-local-work-v1`, object store `records`, compound JSON key `[userId, workspaceId]`. One bucket contains `drafts[incidentId]` and scoped outbox array. Each outbox record has user/workspace/incident, stable UUID, body, provisional ISO time, sending/unknown/failed state, attempts/lastAttemptAt, safe issue and retry eligibility. One transaction inserts outbox and deletes draft; resolution occurs on transaction complete, never merely put-success. This deliberate implementation variation uses one atomic identity bucket instead of two object stores/secondary indexes: sufficient for modest local work, not intended for huge offline queues. Mock confirmed authority uses **another** database, `incident-room-fictional-timeline-v1`, room-keyed records; it is fictional server persistence, never frontend Query persistence. A real backend replaces it. Corrupt local data fails closed with an error rather than silent deletion.
- **Draft/send:** one draft per identity/incident, 250ms debounce with navigation/pagehide flush, explicit discard and logout deletion. Abrupt shutdown before a pending transaction commits may lose the last uncommitted keystrokes; no browser unload durability guarantee is claimed. Validate → atomically hand off → clear editor → expose optimistic row → dispatch mutation. Quota/storage failure before handoff retains editor text and dispatches nothing. Runtime queues/controllers/leases are outside Redux; Redux contains scoped mutation IDs and delivery states only.
- **Delivery:** receipt key binds workspace/incident/user/mutation UUID and body fingerprint. Same ID/body returns the same confirmed record; changed body conflicts. No generic mutation retry. Confirmation validates room/author/UUID/content, writes Query association synchronously, then removes durable/local work. HTTP 4xx validation/permission/conflict is failed; transport/timeout/malformed-response ambiguity is unknown. Unknown is checked by mutation ID: found confirms without resend; confirmed missing exposes explicit same-ID Retry. Every Retry checks first. Unknown permits Check delivery, not Delete; failed unconfirmed records permit local Delete. Reload waits for identity, restores only its room records, reconciles every prior sending/unknown/failed record and never auto-resends.
- **Identity lifecycle:** globally registered `LocalWorkService` invalidates leases immediately on clear and drains started storage transactions before logout cleanup. Session expiry/switch/dispose quarantine existing durable work. Logout deletes only the captured identity bucket; failures use Phase 2's cleanup retry/authentication barrier. Room disposal aborts delivery; generation/lease guards reject stale signal-ignoring continuations. No cross-tab leader election or background delivery.
- **Virtual viewport:** installed React Virtual 3.14.13 resolves Virtual Core 3.17.11. Actual `useVirtualizer`, `measureElement`/ResizeObserver, overscan 6, stable author+UUID row keys and variable plain-text heights render a bounded subset. `anchorTo: 'end'` captures visible keyed anchor/within-row geometry across prepend; browser `overflow-anchor` is disabled to avoid double compensation. Measured growth wholly above the anchor compensates actual size deltas. Width changes invalidate measurements. Follow-on-append applies only within 96px and outside active target navigation. Focused row is included in range; removing it transfers focus to the viewport. This mutable imperative component is explicitly outside React Compiler, with one locally documented incompatible-library diagnostic suppression; lint/CI remain strict and unchanged.
- **Target lifecycle:** `TargetNavigation` aborts/supersedes the previous attempt. URL → validated locator → separate bounded window → Query projection → virtual index → committed row/ref/measurement → center scroll → semantic cue and polite announcement. The viewport accepts a target before projection commit and resolves only after mounted measured visibility. No timer chain or linear history walk. One 20s failure deadline and an 8s highlight expiry are timers for bounds/feedback only. Malformed, missing, deleted, denied, unavailable, network/session and superseded paths do not silently navigate to latest. Retry retains URL; Go to latest explicitly removes only `event`, preserving unrelated query/hash. URL target remains authoritative across responsive resize. Target scrolling does not steal focus.
- **UI/accessibility:** desktop context/sidebar and primary Timeline; collapsed mobile context; dynamic viewport height, safe-area compose and no horizontal overflow at 320/768/1280px. Semantic ordered list and aria position/size, textual source/status/delivery/tombstone labels, visible focus and reduced-motion CSS. Plain text ≤4,000; no HTML/Markdown; only credential-free HTTP(S) URLs link with noopener/noreferrer. Enter newline, Ctrl/Cmd+Enter Send excluding IME. A bounded native accessible mention selector inserts `@Name [stableUserId]`, not a rich-text popup/model. Permissions remain central and independently authority-enforced. Empty new incidents have no invented event; history errors retain confirmed rows except authorization/unavailable boundaries.
- **Fixtures/performance/tests:** lazy seed 4,000 entries for INC-2841, 160 for other seeded incidents, zero for newly created incidents. Deterministic mixed variable-height generator supports 0–50,000; 10,000-row component projection and browser authority dataset both assert <80 mounted list items, not FPS. Browser anchor tolerance is ≤8px for prepend and asynchronous above-anchor expansion. Internal authority fixture fields `fault`, `responseDelayMs`, `locateDelayMs` support rejection, missing/after-persist ambiguity and in-flight supersession; no test endpoint, window global or product test/demo control exists. Full local validation/CI results belong to the completion report. The mock bucket validates full authority records per transaction: appropriate for this fictional portfolio, not a production storage/performance design. 50,000-row capability is tested, but no full 50,000 browser benchmark is claimed.
- **Scope stop:** no actual WebSocket business stream, reconnect/resync, presence, typing, Threads, Notifications UI, Postmortem editing or full Demo Mode. All artifacts were independently derived from accepted public project specifications and public library documentation; no private commercial repository was consulted.

## 42. Phase 5 concrete realtime synchronization

- **Transport/lifecycle:** `features/realtime` implements the existing semantic port, envelope validators, journal, clock, mock adapter, coordinator and small summary UI. `app/_incidents` composes session, Query and delivery without sibling-feature imports. An authorized room starts one independent transport scoped to its incident; departure disposes it and its ephemeral lease. An authorized Incident List starts a workspace metadata-only transport, with no room presence. The adapters poll server capabilities every 500ms; these are WebSocket-style simulated transports, not native network WebSockets. A non-consuming stream probe checks configured transport failure before connect completes or presence joins; resync/first delivery still reads the original cursor. No dependency/server process, BroadcastChannel, SharedWorker, leader election, socket sharing or cross-tab Redux is added. Separate browser profiles have separate fictional backends; browser tests deliberately use independent pages sharing one origin's server storage.
- **Envelope:** Zod discriminates incident and timeline payloads. Both require stable eventId, workspaceId, positive sequence/revision, resourceId, occurredAt and validated resource payload. IDs/revisions/scope must match the payload. Incident kinds cover created/updated/status/severity; Timeline kinds cover created/corrected/tombstoned. Sequence is synchronization order only: Timeline continues using occurredAt/serverTieOrder/serverId. Incident schema now has revision with legacy default 1; real mutations increment it, and late detail HTTP responses cannot overwrite newer cached revisions. Internal authority fixtures support metadata corrections without adding mutation UI.
- **Atomic source changes and journal:** Timeline and Incident mutations store their resource and source change record in the **same existing authority transaction**. `app/_mocks/realtime-authority.ts` idempotently ingests committed changes into `incident-room-fictional-journal-v1`, version 1 records keyed by workspace. One transaction allocates monotonic workspace sequence, appends validated envelopes, remembers resource revisions and retains the newest 2,000 events. Only after journal commit are matching source changes acknowledged/removed; a crash between databases can retry safely. There is no claim of a cross-database atomic transaction. A stopped room's pending changes are ingested on its next authorized open/sync; ordinary active-client polling provides publication. Controls are internal server fixtures keyed by public client UUID, never a visible product panel.
- **Checkpoint:** `lastAppliedSequence` belongs solely to this identity/workspace/active runtime, never global localStorage or another account. Transport cursor is independent and may deliberately skip/drop delivery. Coordinator commits only contiguous safely applied/ignored-stale events; receipt alone does not advance. Stable event IDs (bounded 2,000 set) and resource revisions independently protect duplicates/staleness. Workspace events for inactive rooms are safely irrelevant to that room's projection while still accounted for in the workspace sequence. Identity disposal clears checkpoint, buffers, revisions and ephemeral state.
- **Recovery:** one serialized recovery loop joins the existing SessionCoordinator safe-read/refresh policy. Open transport and buffer live envelopes → obtain authenticated high-water → fetch ≤100 events per HTTP sync page through fixed boundary → validate/apply → drain contiguous newer buffered events → Connected. Invalid transport envelopes log a safe category and do not advance; high-water/gap hints cause authoritative sync. Buffer is capped at 1,000; overflow or unsafe/missing sequence fails recovery rather than claiming synchronized state. Each awaited coordinator operation has a 12s injected deadline and abort race, including signal-ignoring adapters. Bounded exponential 500ms→30s backoff uses 0.75–1 jitter and injectable scheduling/randomness; a 5s stable recovery resets attempts. Offline hints cancel attempts while preserving Query and durable work; online/manual Retry reconnects and still resyncs. Logout/expiry cancels via registered lifecycle and generation checks; realtime has no separate auth-refresh loop.
- **Expired checkpoint:** retention floor/internal expiry fixture triggers bounded snapshots, not a reload or silent checkpoint jump. Active room obtains recent ≤60 plus its already loaded IDs in batches of ≤60, validating each response and merging through normal Query/domain rules. Checkpoint moves to the new boundary only after snapshots apply; buffered newer records drain afterwards. Draft/outbox/projection/virtual anchors are retained. Workspace-list fallback invalidates/refetches its authoritative active collection. Snapshot pages can contain records newer than boundary; revision-idempotent later replay remains safe. No bulk whole-application reload.
- **Query/echo:** persistent Timeline records enter the existing Query acknowledgment acquisition resource and `mergeEntries`/TimelineProjection, with no Redux confirmed collection or parallel realtime renderer. Existing history/target windows overlap safely. Echo immediately calls the same DeliveryCoordinator acknowledgment: room+author+UUID validate, Query association precedes durable removal, unknown resolves without resend/extra lookup. HTTP first/echo first/late failure converge; a confirmed-mutation guard prevents late HTTP from resurrecting local failure. Corrections/tombstones keep stable keys. Incident envelopes update revision-guarded detail caches and invalidate filter/sort-owned list pages; an active list listens outside the room as well.
- **Ephemeral server:** `public/fictional-realtime-worker.js` is an independently authored Service Worker scoped to `/mock-realtime/`, separate from the unchanged MSW vendor worker. MessageChannel is an RPC to this fictional server's **in-memory** lease registry, not client-to-client broadcast, ownership coordination or connection sharing. Join follows authorized open; 500ms pulses return fresh bounded snapshots, leave removes a client, 4s TTL expires abandoned leases. Worker termination loses only ephemeral state; pulses rebuild it. Nothing enters IndexedDB/journal/Timeline/Search/Postmortem or Query persistence. This mock broker trusts its app-authenticated caller; it is explicitly not a real security boundary. Real production transport must authenticate server-side.
- **Presence/typing/UI:** unique viewers are summarized with accessible expandable names rather than avatars; client leases remain distinct even for the same user. Disconnect/departure/logout/expiry clears local presence; reconnect replaces from a fresh snapshot. Compose changes update a local typing intent; transport sends it at most once per 500ms, stops on Send/expiry/disconnect and excludes current-user echoes. Typing expires without a persistent entry and has no per-keystroke live announcements. Connecting/Connected/Reconnecting/Offline text is nonblocking and does not steal focus. New updates uses unique created-entry IDs excluding known HTTP/pagination resources and revisions; older readers keep anchors. Explicit activation removes only URL event and returns newest; incoming changes never restart target navigation.
- **Performance/testing:** ephemeral snapshots update only room-local UI and keep memoized Timeline Query/projection inputs stable, so they do not sort/rebuild the 10k Timeline. Persistent acquisition changes reuse existing revision rules; mock authority bucket validation/source reads and in-memory Query acknowledgment growth are portfolio boundaries, not production storage/throughput claims. Deterministic port/clock tests cover recovery deadlines, canceled/failed commits, sequence buffering, malformed/foreign envelopes, stale revisions, tombstones, journal replay/retention and identity teardown. Integration tests cover both echo orders, ambiguity, late HTTP failure and pagination overlap. Desktop/mobile browser cases exercise independent clients, recovery/expired snapshots, faults, presence/typing, metadata, old-reader counts and active deep-link preservation. Full execution counts/CI belong to the completion report.
- **Scope:** no Threads, thread realtime, Notifications business UI, Postmortem collaboration, visible Demo Mode, production WebSocket server or Phase 6. Product Specification is unchanged. All protocols/data/code are independently designed from this project and public references.

## Public implementation references

- [Next.js installation and current App Router tooling](https://nextjs.org/docs/app/getting-started/installation)
- [Redux store ownership with Next.js](https://redux.js.org/usage/nextjs)
- [TanStack Query server rendering boundaries](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack Virtual measurement APIs](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [MSW browser integration](https://mswjs.io/guides/integrations/browser)
- [Service Worker global lifecycle and nonpersistent state](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)
- [Service Worker message events](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/message_event)
