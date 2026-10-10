# Engineering quality audit

Audit date: 2026-10-10. Baseline: b4d1b4022852df08b8d1b3d8b8c95d796bdcd8b8, clean `main`, matching `origin/main`. Scope is architecture remediation, not feature development. Product Specification and clean-room rules remain authoritative.

## Executive summary

The application has useful existing boundaries: Query owns confirmed resources, Redux owns serializable coordination, runtime classes own asynchronous work, and identity-scoped IndexedDB owns local drafts/outbox. The most urgent confirmed issue is that user scroll intent does not cancel route-owned target acquisition. A delayed target can therefore move the viewport after the reader deliberately moves elsewhere. MeasuredStream also repeats target scroll commands from readiness callbacks even though the installed virtualizer already reconciles variable-height navigation.

The reported target-free mobile backward jump is **unresolved**. All 14 existing production scroll-stability tests pass on the baseline. Their coverage includes 320/375/390/430/1280px, late first measurements, actual touch gestures, prepend, viewport height changes and later growth below the fold. A reproducible stale-target defect is not proof that it caused every reported jump.

Findings: **0 Critical, 1 High, 7 Medium, 2 Low**. Severity reflects behavioral impact and maintenance risk, not component length. Implement H1 and related M1/M2/M7; retain M3 based on regression evidence; address M4 as a separate storage reuse change if validation supports it. Defer performance/storage-scale changes and product decisions.

## Architecture overview and inspection coverage

The tracked file inventory covers routes/providers/shell, incident discovery/context, Timeline/Thread, session, realtime, search/notifications/palette, Postmortem, Demo, shared UI/messaging/persistence/query, fixtures, tests, CSS, tooling and CI. Detailed source review concentrated on stateful boundaries and their tests; inventory inspection is not a claim of an exhaustive formal proof of every line.

- `app → features → entities → shared` dependencies are lint-enforced. Route wrappers await Next parameters; browser work lives inside client boundaries. Read the installed Next client-component and React Compiler guides. Compiler is not enabled in next.config.ts.
- Query pages and target windows feed StreamProjection; Redux has session, connection, local-work metadata and Demo scalars. No competing confirmed-resource collection was identified in Redux.
- SessionCoordinator owns generation checks, refresh coalescing, identity teardown and non-replayable mutations. LocalWorkService quarantines leases and drains transactions before explicit logout deletion. MessageDelivery associates confirmation with Query before removing durable local work, retains stable mutation identity and never blindly replays restore.
- RealtimeCoordinator owns one transport, buffer, checkpoint-after-apply, recovery deadline and backoff. Workspace and Room hooks supply different cache/presence ports. Closed Thread histories are invalidated instead of eagerly loaded. Journal/source ingestion uses durable receipts because the separate authority databases are not globally atomic.
- RHF owns editable Postmortem fields; revision/CAS and explicit reload preserve dirty fields. URL owns filters/search and contextual targets. Drawers own presentation/modality; they do not own Room services.
- Authorities enforce domain permissions, cursor binding and idempotency. MSW composes authentication and domains. Fictional correlation cookies and in-memory ephemeral Service Worker presence are intentionally not production security.
- Unit tests cover authority/delivery/session/realtime races; real browser suites cover geometry, cross-client convergence, accessibility interactions, large fixtures and development Strict Mode replay. jsdom layout stubs cannot certify scrolling.

## Findings

### H1 — User intent cannot cancel in-flight target acquisition

**Type:** confirmed behavioral defect. **Severity:** High. **Files/functions:** shared/ui/measured-stream.tsx (viewport input); app/_incidents/timeline-room.tsx and thread-surface.tsx (target navigation effects); shared/messaging/target-navigation.ts (navigate/cancel).

**Evidence:** new deterministic production reproduction sets the Timeline authority locator delay to 1000ms, requests evt-42 through URL, dispatches genuine mobile touch movement while locating, then observes `Target found in Timeline` and old evt-42 in the viewport. Baseline mobile 375px run fails 1/1 cancellation regression. Existing cancellation handles URL replacement/unmount/Latest only; no user-input handler cancels the owner. There are two independent pending operations: acquisition in TargetNavigation and reveal in MeasuredStream. Cancelling only reveal cannot stop acquisition from later starting reveal.

**Why it matters:** readers can be pulled into older history after choosing another position. **Change:** scroll intent cancels both the route acquisition and pending reveal, preserves the URL so explicit Retry remains available, and clears pending resize restoration. Mouse/touch/scroll keys must count as intent; programmatic scroll events must not. **Benefit:** explicit ownership and correct cleanup. **Regression risk:** accidental cancellation from clicks on row controls; handle only viewport scrolling input. **Disposition:** fix now. This is a demonstrated target-related cause, not established as the cause of target-free reports.

### M1 — Readiness callbacks also initiate repeated target movement

**Type:** architectural concern with competing side effects. **Severity:** Medium. **Files/functions:** measured-stream.tsx, settle/reveal/layout/ResizeObserver/onScroll/row refs.

**Evidence:** settle calls scrollToIndex before checking DOM visibility. It runs after scroll, layout, ResizeObserver and queued row-ref work; reveal also calls scrollToIndex separately. Installed Virtual 3.14.13 scrollToIndex schedules its own measurement reconciliation. Readiness and command initiation are therefore mixed.

**Change:** issue one target command when its row index is acquired; let Virtual reconcile sizes; observe visibility to resolve the pending reveal. Centralize supersede/abort/Latest/unmount cleanup. **Benefit:** traceable scroll source, fewer command resets. **Risk:** resolving before a row mounts or measurements commit; retain layout/RO/scroll readiness signals. **Disposition:** fix with H1, behavioral reveal/supersede/unmount tests and full Timeline/Thread browser coverage.

### M2 — Inline row refs repeat measurements and queue readiness work

**Type:** architectural/performance concern, not measured FPS defect. **Severity:** Medium. **File:** measured-stream.tsx, inline li ref.

**Evidence:** a new callback is created for each mounted row on every stream render; React detaches/attaches it, calls measureElement and queues a microtask per node. A separate mounted map only supports target visibility lookup, over a bounded rendered range.

**Change:** use Virtual's stable measureElement ref and inspect the bounded mounted DOM only while a reveal is pending. **Benefit:** removes extra map lifecycle and microtask scheduling. **Risk:** target availability must be checked after layout and measurement; do not depend on row-ref churn. **Disposition:** fix with M1. No quantitative render-speed improvement claimed.

### M3 — Custom size compensation is a version-specific maintenance constraint

**Type:** version-specific ownership constraint; original-scroll hypothesis unconfirmed. **Severity:** Medium. **File:** measured-stream.tsx, shouldAdjustScrollPositionOnItemSizeChange.

**Evidence:** current custom policy compensates first measurements whose start is above the fold and later measurements entirely above it. Installed Virtual implements those same cases by default and additionally skips later remeasure compensation while scrolling backward. The override suppresses that library guard and reads mutable implementation fields. Native browser anchoring is already disabled by globals.css overflow-anchor:none.

**Change:** retain and explain the narrow predicate. Removing it failed the existing mobile above-fold growth test with 720px displacement, proving the difference is required. **Benefit:** explicit rationale instead of an unexplained workaround. **Risk:** dependency upgrades may change cache/scroll semantics; rerun real geometry regressions. **Disposition:** retain, document and defer removal. It is not yet a reproduced cause of the original target-free jump. Library source is the version-accurate evidence; [official Virtual API](https://tanstack.com/virtual/latest/docs/api/virtualizer) documents anchorTo/followOnAppend and measurement ownership.

### M4 — Auth and Incident IndexedDB adapters duplicate the transaction primitive

**Type:** duplicated responsibility. **Severity:** Medium. **Files/functions:** session/mock/indexeddb-authority.ts and incident-management/indexeddb-store.ts (open/transact), shared/persistence/atomic-store.ts.

**Evidence:** all three implement cached version-1 opens, store creation, versionchange close, synchronous read/validate/operate/put, abort on callback error and resolve on transaction complete. Their actual differences are database/store/key, seed and validator. Other authorities already use IndexedDbAtomicStore.

**Change:** keep public adapter classes and existing database/object-store/singleton keys; delegate transaction mechanics to the existing primitive, allowing its store name to be specified. Auth seed is asynchronous and must resolve before entering the synchronous transaction. **Benefit:** one place to maintain transaction/error behavior. **Risk:** persistence compatibility and transactional rollback; add real browser adapter reopen/rollback validation and run auth/incident suites. **Disposition:** focused separate batch after stream stabilization. Do not create a second persistence framework.

### M5 — Bounded UI windows still incur whole-bucket authority work

**Type:** confirmed structural performance concern, no latency benchmark. **Severity:** Medium. **Files/functions:** atomic-store.ts/transact; timeline/authority.ts/window/locate/inspectSearchable; threads/authority.ts/materialize/window; realtime/journal.ts/read; app/_mocks/search-authority.ts.

**Evidence:** reads use readwrite transactions, validate a complete bucket and store.put it again. Timeline windows return <=60 entries while validation/serialization touches up to 50k. Thread window sorts the whole materialized discussion; Search scans accessible room buckets. Journal reads similarly write back. Bounded DOM does not bound storage work.

**Change:** profile transactions and allocations on 50k with multiple clients before designing read-only access/indexes. Preserve authority mutation and seed materialization semantics. **Benefit:** evidence-based scaling improvement. **Risk:** splitting stores/indexes entails data migration and recovery changes. **Disposition:** defer; this audit does not justify a cross-cutting storage redesign or invented FPS claims.

### M6 — Mounted-session acquired resource bookkeeping grows over time

**Type:** performance/ownership concern. **Severity:** Medium. **Files/functions:** shared/messaging/projection.ts/build (index/aliases); use-room-realtime.ts/merge/arrivals/counted; measured-stream.tsx (counted/updates); realtime/coordinator.ts (revisions); TimelineRoom/ThreadSurface windowIds.

**Evidence:** acquired entries/aliases/target window IDs and realtime acknowledgment/arrival collections are retained during mount; not all follow Query gcTime. Realtime seen has a 2000 cap, but resource revisions do not. Multiple deep targets and long-lived realtime sessions can increase these collections independently of rendered row count.

**Change:** establish a supported acquisition/lifetime policy and profile a sustained session; then bound/evict with explicit gap and revision semantics. **Benefit:** predictable session memory. **Risk:** evicting acquired targets can break gaps, pending confirmations and ordering. **Disposition:** defer; avoid arbitrary caps that lose accepted behavior.

### M7 — Cancellation/measurement ownership lacks direct regression coverage

**Type:** test coverage gap. **Severity:** Medium. **Files:** timeline/threads component tests, timeline.spec.ts, timeline-scroll-stability.spec.ts, dev-e2e/timeline-scroll.spec.ts.

**Evidence:** existing tests cover URL supersede, Latest, touch after settled geometry and first measurement; they do not cover user input during acquisition or pending reveal, signal listener cleanup, or stable callback ref behavior. Geometry stubs deliberately return uniform sizes/positions and therefore cannot expose real scroll competition. No physical iOS/device test exists.

**Change:** add deterministic delayed acquisition, pending reveal AbortSignal/unmount, keyboard cancellation, Thread compatibility, and real browser gesture regressions. **Benefit:** protects owner handoff instead of internal implementation shape. **Risk:** hard sleeps or optimistic visibility-only assertions could miss subsequent override; use authority barriers and geometry settling. **Disposition:** fix with H1–M3. Keep existing tests and assertions.

### L1 — Documentation and annotations can overstate current implementation

**Type:** documentation concern. **Severity:** Low. **Files:** technical-architecture.md section 22; measured-stream.tsx use-no-memo comment; next.config.ts; README testing counts.

**Evidence:** section 22 describes generic explicit capture/restore before prepend, whereas prepend is now owned by Virtual anchorTo:end. React Compiler annotation exists but the compiler is not enabled. README baseline counts predate newer remediation tests.

**Change:** document actual current scroll ownership and measured validation counts without erasing historical phase records. **Benefit:** fewer misleading assumptions during maintenance. **Risk:** cosmetic broad rewrite. **Disposition:** update scroll ownership only; retain compiler boundary as compatibility annotation, do not enable a new build plugin.

### L2 — One development startup assertion uses a fixed observation delay

**Type:** test maintenance concern. **Severity:** Low. **File:** tests/dev-e2e/session-startup.spec.ts (waitForTimeout(1500)).

**Evidence:** fixed wait observes post-startup failures; it is not a readiness contract. Other stream tests use stable geometry and authority signals. **Change:** replace only when a meaningful startup-completion/idle condition is available; do not mechanically remove observation coverage. **Benefit:** clearer deterministic intent. **Risk:** deleting the wait could remove detection of delayed failures. **Disposition:** defer unrelated test cleanup.

## Confirmed defects versus unresolved hypotheses

H1 is reproducible. M1–M4 describe verified code structures; M5/M6 describe concrete work/retention patterns, not measured user-visible failures. M3's possible role in target-free backwards motion remains a hypothesis. No confirmed Critical defect was established. No evidence justified replacing core libraries, Redux/Query ownership, outbox protocol, permission model or UI.

The target-free mobile issue remains open pending reproduction beyond the passing baseline. Native anchoring is disabled; instrument Virtual scrollToFn adjustments separately from absolute target/Latest/resize writes and track row-key visual offset, not scrollTop alone. Test Chromium touch and physical iOS momentum separately. A compensated prepend legitimately changes scrollTop while retaining the visual row anchor.

## Scroll ownership model and mechanism review

| Situation                    | Owner                                                      | Priority / handoff                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary user scroll         | Native viewport input                                      | Cancels acquisition and reveal; never infer intent from onScroll because it also observes programmatic writes.                                       |
| Initial positioning          | Stream, once                                               | Initial Latest only without URL target; input marks initialization consumed.                                                                         |
| Older history prepend        | Virtual anchorTo:end                                       | Stable logical keys preserve visible row; no second app prepend restorer.                                                                            |
| Target navigation            | Route TargetNavigation acquisition + stream single command | New target supersedes old; signal abort/unmount/input cancels; readiness observes DOM visibility.                                                    |
| Explicit Latest / Home / End | Explicit viewport action                                   | Cancels pending reveal/restoration first. Latest route callback clears only target URL dimensions.                                                   |
| Append near end              | Virtual followOnAppend:auto                                | Suppressed while URL target active; never overrides historical reading.                                                                              |
| Row height changes           | Virtual measurement/default compensation                   | Retain the narrow predicate for above-fold late growth; first estimate correction differs from later growth. Virtual alone executes compensation.    |
| Width change                 | Stream keyed resize anchor + Virtual measure               | Essential because cached heights belong to old wrapping width. Restore once; active target takes precedence; user intent clears stale resize anchor. |
| Container height change      | Virtual viewport observation                               | Avoid a second custom absolute scroll source.                                                                                                        |
| Focus / new entries          | Stream UI state                                            | Range extractor retains focused row; distinct arrivals count only while reading history; presentation state does not command ordinary scrolling.     |

`pending` is essential for the reveal Promise/AbortSignal boundary, but repeated settle scroll commands are not. `initialized` prevents repeated initial positioning. `nearEnd` remains necessary for the new-updates presentation, while Virtual independently owns follow geometry; do not introduce a third state owner. `widthAnchor` is needed for width invalidation, not prepend. `anchorTo` and `followOnAppend` are essential library responsibilities. Focus retention and keyboard navigation remain. Replace inline refs with stable measurement refs. A small cohesive component remains preferable to mutually dependent hooks or a generic state machine.

## Dependency-aware remediation plan (written before structural changes)

1. **Navigation owner handoff (H1/M1/M2/M7).** Current: acquisition and repeated reveal writes outlive user intent. Intended: cancelable acquisition plus one measured target command. Scope: stream, Timeline wrapper, route owners and focused tests. Preserve URL/API contracts; add explicit cancellation feedback/Retry. Risk: effect ordering/Strict Mode and input on nested controls. Verify delayed genuine touch/wheel at 320/375/390, reveal signal cancellation/supersede/unmount, keyboard Home/End, target retry/Latest, Thread and existing large-history regressions. Rollback: one stream/navigation commit.
2. **Library measurement ownership experiment (M3).** Initial proposal: remove the overlap if tests permit. Outcome: mobile late-growth regression requires retaining the predicate; Virtual remains the only adjustment writer. Scope: stream only, existing late-first/later-growth/prepend suites plus focused backward movement. Risk: changing remeasure behavior. Verify before/after tests, retain override if behavior regresses. Can join batch 1 only if behavioral evidence remains clear; no dependency upgrade.
3. **Existing transaction primitive reuse (M4).** Current: three duplicate adapters. Intended: preserve store/key/seed/schema while reusing one implementation. Scope: primitive + two wrappers + meaningful persistence regression. Risk: auth asynchronous seeding and persisted store compatibility. Verify reopen, rollback after thrown callback, corrupt input rejection, normal auth/incident flows and full suite. Independent commit/rollback from scrolling.
4. **Delivery documentation.** Update this report with reproduction and actual validation; no claims for unexecuted checks. Run frozen install, formatting/lint/typecheck, full Vitest, production build, full production and relevant development Playwright, 10k/50k checks, diff review/check. Commit small batches only after project-required validation, push normally to main, inspect Actions, verify remote SHA and clean tree.

## Deferred scope and quality assessment

Do not split TimelineRoom/ThreadSurface solely because they are long. Draft flushing, send handoff, Query/URL composition and scope guarding are cohesive route responsibilities, although duplicated edit/flush orchestration should be reconsidered if another messaging surface is added. Existing shared MessageDelivery/StreamProjection/StreamCompose are justified by Timeline and Thread reuse. No speculative memoization or compiler enablement is warranted.

Keep Postmortem CAS/dirty-copy logic, abort deadlines, journal recovery receipts, modal animation cancellation and identity leases: they correspond to explicit failure cases and tested requirements. Their complexity is justified rather than automatically overengineering. Accepted commander feature gaps and Postmortem browser Back/Forward dirty-loss limitations are already disclosed; implementing product features/history interception is outside this task.

Expected improvement is qualitative: fewer independent target command paths, explicit user cancellation, an explained measurement policy, stable refs and fewer storage transaction copies. No fabricated percentage, FPS, memory or bundle improvements. Remaining medium debt needs sustained-session/storage profiles; the original target-free mobile report needs an actual reproducible gesture/measurement sequence.

## Validation record

Before implementation: frozen install passed; production build passed; 14/14 existing scroll-stability tests passed. New delayed-target mobile 375px regression failed 1/1 and captured `Target found in Timeline`/old target after genuine touch input. Screenshots and traces disabled. Final local validation appears below; final commit/CI evidence is recorded in the delivery report.

## Measurement policy decision after browser experiment

Removing the custom policy passed the late-first-measurement tests but failed the existing mobile test 'measured growth above a historical anchor compensates geometry without dragging the reader': displacement **720px**, allowed <=8px. The focused batch was **71 passed, 1 failed (72 total)**. The library default skips remeasurement compensation during backward movement, even for genuine above-fold content growth. Restore the narrow existing predicate; its behavioral difference is essential. M3 is therefore documented/deferred rather than removed. Do not attribute the original target-free mobile report to this override. The stream still has a single measurement owner (Virtual executes adjustments with the retained explicit predicate), not two independent compensating writers.

## Implemented remediation and qualitative assessment

The stream/navigation batch implements H1/M1/M2/M7 and the scroll documentation portion of L1. Reveal visibility checks no longer issue navigation commands; a command is issued once per acquired target index (a prepend can change that index). Stable measurement refs replace the extra node map and per-ref microtasks. User input cancels acquisition and reveal without treating programmatic scroll events as intent. URL target, explicit Retry, focus retention, keyboard navigation, resize anchoring and Latest remain supported. M3's compensation predicate is retained after the failed removal experiment.

The independent M4 batch keeps both public authority adapter classes and delegates to the existing IndexedDbAtomicStore, with an optional store name. Existing database versions, object stores and singleton keys are unchanged. Auth seeding resolves outside the native transaction and caches an immutable template; each missing record gets a fresh clone. Native browser tests verify persisted incident/auth restoration, idempotent replay, conflicting input rejection, corrupt-record rejection without overwrite, mutation-then-throw rollback, and serialization across independent primitive instances. No new persistence framework, migration or dependency is introduced.

| Dimension          | Before                                                                                                                             | After / limit                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsibilities   | Readiness callbacks also command scrolling; three copies of native transaction lifecycle.                                          | Readiness observes; input/acquisition/reveal handoff is explicit; native transaction lifecycle has one implementation.                          |
| State ownership    | Query/Redux/runtime boundaries already useful; no identified duplicated confirmed-resource owner.                                  | Those boundaries are preserved; pending reveal owns only its Promise, signal and acquired target index.                                         |
| Async coordination | Delayed acquisition can override user input; listener/command cleanup scattered across paths.                                      | Abort, supersede, Latest and unmount share cleanup; acquisition is cancelled at its actual owner; async seed stays outside transactions.        |
| Readability        | Inline refs and settle side effects obscure which path moves the viewport.                                                         | Named command/readiness/cancellation operations and documented compensation rationale; no mechanical component fragmentation.                   |
| Testability        | No direct user takeover during acquisition/reveal regression.                                                                      | Eleven new stream behavior tests, six delayed-target browser cases and four native persistence/transaction cases; existing assertions retained. |
| Performance        | Repeated ref measurements/microtasks and repeated target commands; whole-bucket storage work and mounted-session retention remain. | Removes those redundant scheduling paths; no measured FPS, latency, allocation or memory improvement claimed. M5/M6 require profiling.          |

Focused validation after the final stream edit: 375/375 unit tests, production build, formatting/lint/typecheck and 74/74 production browser cases (including the pre-consolidation persistence contract) passed. Storage batch: the same 375/375 unit tests and static/build checks passed; 32/32 native persistence/auth/incident browser cases passed. The native persistence compatibility test passed both before and after adapter reuse.

Earlier default-concurrency local unit runs produced 371 passed/4 failed while browser work overlapped, then 374 passed/1 Thread interaction timeout on a sequential retry. The isolated failing Thread case passed, and multiple complete two-worker runs passed 375/375. Host concurrency sensitivity is an inference, not a proven code cause. No assertion, timeout, retry or repository worker configuration was changed; CI runs the existing normal unit command. The baseline reproduction and rejected compensation-removal failures are recorded above and are not hidden by final passing runs.

## Responsive regression found during broad validation

The first full production attempt was stopped after two observed responsive regressions (context/Thread migration and full-screen Thread target visibility; 156 passing cases had completed). An isolated existing Thread width-change test reproduced 1/1 failure: after 320-to-768px wrapping invalidation, the target moved from -32px to -1159px relative to its viewport. Stable refs no longer reattach at width invalidation, so restoration ran against estimates before mounted row measurements arrived. This is a regression introduced by the remediation, separate from the original target-free report.

Correction: after clearing wrapping-dependent measurements, rebuild the virtual range and explicitly call Virtual's measureElement on the bounded mounted range before the one-time keyed restoration. Routine renders still use stable refs; no per-render map/microtasks are reintroduced. Virtual remains the measurement/compensation writer. The first correction passed three of four existing responsive cases; mobile context migration still failed because Virtual skips synchronous measurement during its scrolling cooldown. The width operation now replaces prior absolute reconciliation at the current native offset before invalidating/measuring, allowing Virtual's own synchronous measurement path. This is a no-movement handoff followed by one keyed restoration, not repeated readiness scrolling. Responsive validation is repeated below. Temporary text instrumentation was removed; original tests and assertions are unchanged. The complete production/development validation is repeated after this change.

## Development harness validation discovery

Full development validation initially returned **19 passed, 1 failed**. The isolated mobile Thread composer case also failed **1/1**: Next's dev-tools portal intercepted the Send pointer action for 30 seconds. The page snapshot showed the dev-tools indicator; existing page-error assertions reported no additional runtime failure. The installed Next devIndicators documentation explicitly states that setting it to false hides the indicator while compile/runtime errors still surface.

The development Playwright server alone now sets INCIDENT_ROOM_DEV_E2E=1; next.config.ts disables the indicator only for that server. Ordinary development defaults, production configuration, Strict Mode, real interactions, page-error checks, assertions, timeouts and retry settings are preserved. The full development rerun passed **20/20**, zero retries. This is a separate test-harness correction, not a product redesign or suppression of application errors.

## Final local validation

Frozen install and formatting/lint/typecheck passed. Final application changes passed **375/375 unit/component/integration tests across 46 files** with two local workers, a production build, **272/272 full production Playwright cases** with two workers/zero retries, and **20/20 full development Playwright cases** with one worker/zero retries. The 272-case production run includes 10k/50k geometry, navigation, responsive migration, accessibility/focus, auth, incidents, search, notifications, Postmortem and realtime coverage. Development also passed both 10k/50k stress/reset cases in desktop and mobile projects. No screenshots generated; local traces disabled.

The production full run preceded only the development-harness environment switch described above, which is inactive in production. Static checks, full unit suite, production build and focused responsive production coverage are checked again after that configuration addition. Final remote SHA/clean-tree verification and full GitHub Actions evidence are recorded in the delivery report after normal push. Dependencies added/removed: **0**; no lockfile change.

## CI inspection and reproducible anchor-capture race

The first delivery CI at e6f853ba5f94673772bfccfc71d6a3d241f6aaec was green ([run 38050680581](https://github.com/olestch/incident-room/actions/runs/38050680581)): 375 unit tests passed; production reported **270 passed, 2 flaky**, and development **20 passed**. CI used its existing one retry; no retry setting was increased. The two original failures were a native-link new-tab timeout and an undefined row during the resize test's initial anchor capture, before any resize assertion.

A zero-retry repetition of both cases returned **38 passed, 2 failed (40)**. Both failures were initial mobile anchor capture; all 20 native-link repetitions passed. The native-link timeout remains unconfirmed timing debt. The resize harness changed scrollTop and immediately queried a row at the outer border, without waiting for Virtual's committed range. It now uses the existing bounded geometry-settling helper before/after positioning and identifies the row at the content fold (clientTop), while retaining the original visual-offset comparison, 8px limit, DOM bound and Latest checks. After the correction, **20/20** desktop/mobile repeated resize cases passed with zero retries. This is a test readiness correction, not a product scrolling workaround. Final exact-head CI evidence after the correction is recorded in the delivery report.

After the anchor-capture correction: frozen install, formatting/lint/typecheck, all 375 unit tests, production build and all 24 list/Room production browser cases passed with zero retries. Product source and the existing resize/DOM/Latest assertions are unchanged by this final test-only batch.

## Screenshot constraint in CI diagnostics

Local runs used trace=off throughout. Inspection of the first green CI's retried cases showed retained trace archives, and the installed Playwright worker defaults trace screenshots to true. That existing configuration can capture image frames despite no explicit screenshot tests. Correct it explicitly: retained traces now set screenshots=false, preserving DOM snapshots, sources and assertions. Development inherits the same option. No retries or coverage are changed; no screenshots are delivered. This corrects an overlooked diagnostic setting, and final CI is verified after it. The intermediate CI for the test-readiness commit is superseded by this final configuration commit.
