# Incident Room — Technical Architecture

**Status:** Phase 2 authentication lifecycle

**Product authority:** [Accepted Phase 0 specification](product-spec.md)  
**Implementation scope:** Foundation plus mocked authentication, session lifecycle, protected routing and identity-safe shell; no Incident business functionality

The accepted product specification remains an immutable Phase 0 snapshot. Its historical “Not started” marker is preserved; current implementation progress is tracked here and in README. This document introduces no new product behavior.

## 1. Architecture goals

Support one coherent incident-coordination product with reliable identity isolation, paginated realtime history, durable optimistic work, and accessible responsive navigation. Authentication is implemented in Phase 2; incidents, threads, outbox/drafts and demo controls remain future work.

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
  features/
    session/                   auth forms, session coordinator/adapter, mock authority
    realtime/                  transport contract and connection coordination
  shared/
    errors/                    typed application error categories
    diagnostics/               allowlisted structured diagnostics
    query/                     QueryClient defaults and identity scope keys
    ui/                        reusable non-domain error recovery surface
    testing/                   test setup only; never in production imports
  entities/current-user/       validated current-user server resource and query key
tests/e2e/                     browser smoke and authentication journeys
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

Invalid refresh synchronously advances generation, hides private UI, aborts the scoped controller, cancels/removes identity Query data, and resets connection coordination before asynchronous lifecycle disposal. Late signal-ignoring results fail generation checks. Durable records will be quarantined on expiry/switch; no draft/outbox stores exist now. `registerLifecycle` supplies `stop(identity, reason)` and `clearDurableOnLogout(identity)` extension points. Explicit logout hides identity immediately, calls authority logout and identity-specific cleanup, and forgets the local correlation cookie even on HTTP failure. Cleanup failure is surfaced, blocks new authentication, and retains a retryable cleanup identity. The login page exposes explicit cleanup Retry. No automatic retry or invented durable records.

Multi-tab: ordinary HTTP authorization checks, restore/refresh, and realtime disconnects eventually reflect invalidation. No BroadcastChannel, shared connection, cross-tab refresh lock, or outbox leader election. Persistent confirmed state converges through the mock server described in section 31.

Each adapter captures its active fictional client handle. Logout and cleanup retries target that captured handle; cookie removal is conditional on the same handle still being current, so a stale tab cannot revoke/remove a newer client's session. Login/register explicitly acquire the current correlation handle. Profile responses are checked against the captured frontend identity before Query accepts them; the active shell revalidates current-user through ordinary Query focus/reconnect and a 60-second interval.

## 10. Authorization/permissions architecture

Later `entities/incident` will expose a pure central policy over active user, workspace role, incident participants/commander, and status. Semantic predicates include `canWriteIncident`, `canTransferCommand`, `canChangeSeverity`, `canInitiatePostmortem`, `canEditPostmortem`. Resolved always disables operational writes, including for admins. All active workspace members can read; participants/commander/admin can write active incidents. Only commander/admin transfers to an existing active participant. All active members can create, becoming commander and participant automatically.

MSW service handlers invoke the same product policy but do not rely on UI hiding. Real backend replacement must independently enforce policy. No full domain/action implementation is included in this phase.

## 11. Server-state ownership

TanStack Query owns incidents, users, confirmed timeline history/target windows, threads/messages, notifications, search results, and postmortems. Validated responses enter the cache. No Redux mirror or persisted copy of confirmed Query resources.

Query keys start with `['identity', userId, workspaceId]`, then resource and parameters. Entity modules own resource key factories and query options. Infinite-query keys exclude individual page cursor; page parameters own cursors. Timeline normal and target windows have distinct keys but share reconciliation rules. Identity switch cancels and clears old caches before new resource observers mount.

Foundation defaults: stale time 30 seconds; GC 5 minutes; one retry for transient read failures; no retry for validation/authentication/authorization/not-found/conflict; no automatic mutation retry. Refetch on focus and reconnect uses stale data only. Session, search, and active-room queries override defaults intentionally. Query functions consume Query-provided AbortSignal. Invalidation targets resource keys, never arbitrary global resets except identity teardown.

## 12. Redux/client-state ownership

Session coordination and the minimal connection lifecycle slice exist now. Redux later owns realtime sync phase, serializable outbox coordination metadata, demo settings, and genuinely cross-feature ephemeral state. Confirmed resources/profile remain in Query; local dialogs/forms stay local; active target remains URL-owned. Session teardown clears old identity and resets connection status to offline; runtime objects remain outside the store.

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

Phase 1 defines a transport port (connect, disconnect, subscribe) without a running transport or business payloads. Later the coordinator owns authentication, subscriptions, event IDs/revisions, backoff, and disposal. React consumes state and semantic commands, not raw socket callbacks. Invalid payloads are isolated; diagnostics record categories only. No Socket.IO.

Persistent mock envelopes later require identity/workspace scope, event identity, resource revision, and synchronization sequence. Presence/typing are ephemeral and expire. A native adapter may share the port, but production backend protocol is not finalized here.

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

Server/mock handlers enforce idempotency by workspace/user/clientMutationId. UI row key retains the client identity after confirmation for that session; an alias map links it to server identity. Retry never generates a fresh identity. Permission/status rejection is definitive; network timeout is not. No business mutation is implemented now.

## 16. Outbox architecture

IndexedDB is the durable owner of local message body, mutation ID, identity/incident/thread scope, provisional order, attempt metadata, and pending/sending/failed/unknown outcome. Redux holds active-session coordination metadata and a transient hydrated local projection for rendering; this is local work, not a server cache. Query owns confirmed records. HTTP service sends commands with stable identity and queries outcomes before replay-capable work.

On reload/reauthentication: establish identity → load only matching records → treat previously in-flight records as unknown → reconcile outcomes → expose still-unsent/failed work and explicit Retry. No blind replay, background worker, or offline-first promise. A failed message can be deleted only if still unconfirmed. Explicit logout deletes that identity's durable records. Another identity cannot enumerate/render them through application APIs. Each tab is independent; backend idempotency protects concurrent same-ID attempts without cross-tab locking.

## 17. Draft persistence architecture

Draft storage is separate from outbox. Keys include user/workspace/incident and optional thread or parent-entry context before a thread exists. One timeline draft per incident and one per thread. Debounced durable writes flush on relevant navigation; restoration waits for identity. Draft moves atomically into outbox on Send before clearing the editor. Discard and explicit logout delete drafts. Navigation/reload retains them; session expiry quarantines them; another identity never sees them. No server drafts.

## 18. IndexedDB ownership

Later one native IndexedDB adapter owns versioned `drafts` and `outbox` object stores with compound identity/scope indexes and atomic draft-to-outbox transaction. No Query cache persistence or tokens. Native API suffices initially; no persistence library now. Consumers receive validated records, not database handles. Storage unavailable/quota errors surface explicitly and preserve current editor content; do not claim durable success when transaction failed. Migration rejects/quarantines corrupt incompatible records. Test with injectable persistence adapter and browser reload scenarios when implemented.

## 19. Timeline data model strategy

Later validated discriminated unions model human, monitoring, deployment, status, severity, participant, system entries. Keep stable server ID, occurred time, authoritative tie-order, revision, optional originating mutation ID, and tombstone. Unknown external data is never cast into domain types.

Query infinite pages represent acquisition windows, not three UI lists. A memoized projection deduplicates all loaded confirmed pages/target windows and overlays local work into one logical sequence. Real-time deltas update compatible loaded windows; out-of-window records live in a bounded Query-owned live window. The projection indexes IDs; no Redux server entity collection.

## 20. Timeline ordering/reconciliation strategy

Confirmed comparator is `(occurredAt, serverTieOrder, serverId)` ascending. Transport sequence tracks synchronization and is not occurrence ordering. Client time determines only provisional placement. Preserve prior provisional position for failed items; authoritative confirmation may reorder once if necessary.

All incoming sources use the same pure merge rule: server ID dedupe; highest resource revision wins; tombstone revision blocks stale resurrection; mutation alias collapses echo/HTTP/local item. Maintain a sorted ID index for loaded entries, update incrementally, and batch realtime changes instead of sorting 50,000 objects on every render. Counters use authoritative revisions rather than blind increments. Confirmed human messages are immutable from UI; correction/deletion only comes through simulation/server events.

## 21. Pagination strategy

Use `useInfiniteQuery` with opaque cursors, bounded recent initial window, and `getNextPageParam` for older history. Gate/coalesce fetches by incident/cursor; abort on route/session change. Each page contains ordering boundary metadata and next cursor. Server-generated pages are stable under concurrent appends through a snapshot/high-water cursor contract. Empty/no-next means start of history. Failures keep loaded entries and show boundary retry.

Deep links use a target-locator/window request rather than sequentially paging to a distant event. Target windows enter Query and the same ordered projection without pretending that gaps are continuous history; gap boundaries remain explicit and loadable. Thread and notification pagination use resource-specific options. Search page pagination is grouped; Command Palette is capped.

## 22. Virtualization strategy

Use TanStack Virtual with stable logical row keys, estimates for unseen rows, `measureElement`/ResizeObserver for mounted rows, small overscan, and a dedicated scroll viewport. Before prepend/height-affecting changes capture first visible row key plus within-row offset. After committed measurements restore that anchor once, avoiding double compensation with browser scroll anchoring. Width changes invalidate relevant measurement estimates, not logical navigation.

Near newest boundary follow appends; when reading history preserve anchor and expose new-updates count. Deep-link resolver obtains index, scrolls to estimated position, waits for registered measured element, then corrects precisely. No fixed-delay guess. Focused row is retained in render range where possible or focus is deliberately transferred before unmount. Lists keep chronological DOM semantics. Test 100/1,000/10,000/50,000 records and async expansion with bounded mounted DOM, incremental merge, and no uncontrolled jumping. Full timeline proof is deferred.

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

Mobile-first CSS tokens use 48rem tablet and 64rem desktop thresholds. Same logical URL/Query/draft state drives panel, overlay, or full-screen presentation. Presentation never owns incident/thread state. Resize migrates readiness/focus without restarting target resolution. Software-keyboard safe areas and reduced motion will be tested with future compose. Only simple responsive shell exists now; no separate apps or device-specific domain stores.

## 30. Testing strategy

Vitest with Vite React transform, jsdom, Testing Library, jest-dom, and user-event. Unit tests verify query retry policy and fresh store isolation; component tests verify keyboard-triggered error recovery and provider interaction with Redux/Query in independent scopes. No large snapshots or future business tests.

Playwright uses Chromium desktop and narrow mobile projects against production `build` + `start`; verify public shell, skip-link focus, responsive no-overflow, and absence of browser errors. Later E2E adds auth return, outbox reload/unknown outcome, reconnect resync, target supersession, thread migration. Async Server Components are validated through browser E2E, not incorrectly executed in jsdom.

Phase 2 integration tests use real MSW node handlers and the injected in-memory authority/clock: single-flight refresh, late 401, proactive refresh, non-replayed mutation, terminal teardown, stale A → logout → B, cleanup failure/retry and malformed response. Form tests exercise semantic validation/focus/submission/error/recovery. Browser tests cover protected/deep return including exact query/hash, register/reload, logout/switch, generic recovery, valid/terminal expiry, public-only gates, unknown routes and 320px/tablet overflow/keyboard behavior in desktop/mobile projects. Expiry is forced through the injected authority API in unit tests and test-only IndexedDB lease fixtures in E2E; no visible control, test HTTP endpoint or window global exists.

Future realtime tests inject port/clock; reconciliation tests enumerate races/revisions; draft/outbox IndexedDB tests come with those features. Tests use fictional seeded data only.

## 31. Mock backend architecture

MSW handles HTTP; deterministic service rules are separate from handlers and reusable in tests. Phase 2 implements only `/mock-api/auth/{login,register,forgot-password,logout,session,refresh,me}`. `MockAuthAuthority` uses an `AuthorityStore` contract: in-memory for unit/integration tests, native IndexedDB transactions in the browser for reload and independent-tab convergence. Seed users River Vale and Sage Linden belong to fictional Orbit Workshop. There is no real backend, email delivery, OAuth or token-reset workflow. Recovery always returns the same success response for known/unknown accounts.

The generated `public/mockServiceWorker.js` is an unchanged MSW 2.15.0 vendor asset, ignored by formatting/lint only; all application code remains checked. Browser MSW runs in the portfolio production build as well as development so `build/start` demonstrates auth. It suppresses request/body logging and surfaces unmatched auth-namespace requests; unrelated Next/static traffic is bypassed. Native fetch is resolved at call time with its correct global receiver, after interception initialization. No mock APIs are invoked from feature UI.

Incident cursor/window/outcome/sync capabilities, revisions, idempotency and postmortem conflicts remain future work; no business handlers or giant fixtures exist.

For multi-tab convergence the future mock authority uses IndexedDB transactions for confirmed mock resources/session/event journal, distinct from user-local draft/outbox stores. Each tab's MSW handlers read that authority; independent transport simulators poll journal with per-tab cursors and can intentionally miss/delay/duplicate delivery. This is ordinary simulated server/realtime synchronization, not direct tab messaging or shared client coordination. Tests can use an in-memory authority instead. Mock persistence must be clearly identified as fictional browser data, never a production backend/security claim.

Realtime simulator implements the same transport port: injectable scheduler and journal permit disconnect/reconnect, duplicates, reordering, presence/typing expiry, and missed-change resync. MSW is not used as an assumption that it automatically supplies WebSocket lifecycle.

## 32. Environment/configuration strategy

No custom environment variable is required in Phase 1, so no `.env.example` is invented. Next's NODE_ENV governs DevTools/test server policy. Later public demo/service selectors must be non-secret and validated with Zod; server credentials belong only to server environment/modules. NEXT_PUBLIC values are exposed to every browser and may not hold secrets. Relative same-origin mock requests avoid accidental production endpoints.

## 33. Security considerations

Rendering uses escaped untrusted text; no arbitrary HTML/Markdown. Future detected URLs admit safe HTTP(S) protocols, rejecting executable/data schemes. Validate HTTP/realtime/persistence data with Zod. Safe return URL validation prevents open redirects. Real backend authorization is independent of frontend policy. Identity teardown includes stale async generation protection and durable logout cleanup. No passwords/tokens in logs, Query, Redux, URLs, or durable local stores. Mock users, services, URLs, and data are fictional. Product section 35 remains unmodified and mandatory.

## 34. Performance strategy

Static shell is server-rendered with minimal client providers; no remote font fetch during build. Feature modules are loaded with their route; simulator and diagnostics do not enter unrelated bundles. Query pages are bounded, loaded IDs indexed, updates batched, and stale identity caches cleared. Virtualizer limits DOM work, not just data fetches. Avoid repeated full sort/map and giant Redux serializability scans of confirmed timelines. Later benchmark seeded 50,000-entry room (DOM count, scroll responsiveness, merge/measurement latency) on repeatable browser hardware; no unverifiable performance claims now.

## 35. Dependency decisions

Exact versions are pinned in package.json; lockfile is committed. Node 24 and pnpm 11.19.0 are the project baseline. Registry stable tags were checked during initialization.

| Dependency                                                   | Owner/purpose                   | Justification                                                         |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------- |
| Next.js, React, React DOM                                    | app runtime                     | App Router, RSC composition, interactive rendering.                   |
| TypeScript, React/Node types                                 | all source                      | Strict compile-time contracts.                                        |
| Redux Toolkit, react-redux                                   | app coordination/providers      | Serializable client lifecycle state and typed hooks.                  |
| TanStack Query                                               | shared/query + future entities  | Server cache, cancellation, infinite queries, invalidation.           |
| TanStack Virtual                                             | future timeline feature         | Variable-height virtual viewport; installed, not used until timeline. |
| React Hook Form, Zod                                         | future forms/runtime boundaries | Form lifecycle and validation of unknown data.                        |
| Tailwind, PostCSS adapter, PostCSS                           | app styles/build                | Small token-based mobile-first styling, current Tailwind v4 setup.    |
| MSW                                                          | future mock HTTP/test boundary  | Deterministic HTTP interception without production backend.           |
| Vitest, Vite, React plugin                                   | testing build                   | Isolated TS/React test transforms.                                    |
| RTL, DOM Testing Library, jest-dom, user-event, jsdom        | component tests                 | Behavior/keyboard/semantic assertions.                                |
| Playwright                                                   | browser tests                   | Real routing/rendering/viewport and future lifecycle tests.           |
| ESLint, eslint-config-next                                   | engineering boundaries          | Next/React/accessibility lint and import restrictions.                |
| Prettier                                                     | formatting                      | Consistent reviewable source/config/document formatting.              |
| Native WebSocket, IndexedDB, AbortController, ResizeObserver | runtime adapters                | Selected platform capabilities require no extra package.              |
| Radix UI/shadcn primitives                                   | later accessible surfaces       | Deferred until dialog/palette exists; no unused dependency now.       |

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

Phase 1 established tooling/providers/error foundation and contracts only. Phase 2 adds authentication/session infrastructure and the protected shell, but still excludes incident list/room, timeline, threads, notifications/search/palette business behavior, postmortem, demo UI, persistent drafts/outbox, realtime simulator/business transport, production backend, OAuth and domain actions. No private repository reference, proprietary fixture, copied implementation or speculative empty modules. Stop after Phase 2; Phase 3 requires explicit approval.

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

## Public implementation references

- [Next.js installation and current App Router tooling](https://nextjs.org/docs/app/getting-started/installation)
- [Redux store ownership with Next.js](https://redux.js.org/usage/nextjs)
- [TanStack Query server rendering boundaries](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack Virtual measurement APIs](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [MSW browser integration](https://mswjs.io/guides/integrations/browser)
