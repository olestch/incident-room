# Incident Room

A fictional incident-coordination portfolio demonstrating complex React client architecture: large variable-height history, durable optimistic work, reconnect/resynchronization and contextual navigation in one product.

**React 19 · Next.js 16 · TypeScript · Redux Toolkit · TanStack Query · TanStack Virtual · IndexedDB.** Browser-simulated backend, **not production incident infrastructure or authentication**.

## Try it

No hosted URL is claimed yet. [Deployment instructions](docs/deployment.md) describe the remaining owner account/import step. Locally:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Node **24**, pinned pnpm **11.19.0**. Open `http://localhost:3000`; no environment variables/secrets. Modern browser with Service Workers, IndexedDB, Web Crypto on localhost/HTTPS.

| Fictional user | Email                    | Public demo password | Role   |
| -------------- | ------------------------ | -------------------- | ------ |
| River Vale     | river.vale@example.test  | Fictional-pass-42    | Admin  |
| Sage Linden    | sage.linden@example.test | Fictional-pass-42    | Member |

Orbit Workshop is fictional. **Never enter real passwords or incident data.** Registration creates a browser-stored fictional account; recovery sends no email. River is the recommended reviewer identity.

## What to try

1. **INC-2841:** virtual variable-height Timeline, older pages, message via Ctrl/Cmd+Enter. Enter inserts newline; confirmation reconciles one optimistic item.
2. Same room in another same-origin tab: confirmed activity converges through independent mock transports. Draft/outbox are identity-scoped; no client leader election or connection sharing.
3. Recent Thread, or `/app/incidents/INC-2841?thread=fictional-incident-2841:evt-42` for the old 2k discussion. Targets use locator/windows, not full-history paging.
4. Search `Aurora`, follow an exact message/Thread target; Ctrl/Cmd+K outside editable fields. Inbox has an independent unread summary.
5. **INC-2865** Postmortem: River initiates, Sage participant edits. Two clients demonstrate stale Save/conflict/review/reload. INC-2845 gives Sage read-only access. Action assignment/date/status has independent revisions.
6. Expand **Demo Mode** above the product surface. Close other app tabs before destructive maintenance.

## Demo Mode

Collapsed, clearly fictional developer controls, separate from commander permissions. Validated Redux configuration feeds mock HTTP scheduling and registered **existing** realtime coordinator capabilities; features do not branch on demo flags.

- **Latency:** 0/500/2,000/5,000 ms before ordinary mock reads/mutations. Real Search/loading/background requests and optimistic delivery. Authentication, realtime polling and Demo requests are exempt to keep recovery usable.
- **Failures:** 0/10/30%, operation-local method+pathname counters restarted on applying configuration. First 1/3 of each ten operations fail **before persistence**; no random test flakes. Query safe-read retry may succeed next slot. Existing fixtures separately test after-persistence ambiguity; this control does not fake it.
- **Disconnect/reconnect:** actual coordinator Offline/recovery, preserved history/local work, journal resync before Connected. Disconnect → generate → reconnect shows missed changes.
- **Generate:** monitoring, deployment, human message (eligible fictional peer when available), authorized forward status change. Current Incident, default INC-2841 elsewhere; authority source changes/journal/recipient notifications, never fabricated client rows. Resolved forbids operational generation; status CAS rejects stale concurrent transitions.
- **Stress size:** confirm INC-2841 replacement with 100/1k/10k/50k existing deterministic generator entries. Clears room Threads, workspace journal and **all identities' local drafts/outbox** to avoid orphan work. Other Incidents/notifications/Postmortems remain; old notification targets may be unavailable. Reload establishes fresh windows/checkpoints and default simulation.
- **Reset:** confirm → exclusive maintenance lease (close other app tabs) → session/runtime/local-work drain → finish in-flight mock requests → clear all eight known fictional/local stores → fresh login/seed. Removes fictional accounts/leases, created Incidents, Timeline/Threads, Notifications, Postmortems/Actions, all drafts/outbox. Lazy default seeds restore on read. No raw database deletion from UI or clearing unrelated origin storage. Cross-database maintenance is not globally atomic; on storage failure reload/check storage and retry reset before trusting partial state.
- **Clear simulations:** config only, no persistent deletion. Configuration is tab-local and resets on full reload.

Fixed fixture seed: INC-2841 IDs `evt-N`, September 2026 logical timestamps, deterministic mixed types/bodies. Generated event IDs/order derive from the authority counter and logical time follows latest confirmed activity. Status audit time uses authority time. This is reproducibility, not a benchmark guarantee.

## Architecture worth discussing

- **Query vs Redux:** validated confirmed resources/windows in identity-scoped Query keys; serializable session/connection/local mutation metadata and small Demo settings in Redux. Services outside Redux, forms/dialogs local, filters/targets URL-owned.
- **Local work:** native IndexedDB draft→outbox handoff is atomic before clearing input. Stable UUID survives Retry; ambiguous outcome checks authority before resending. Logout drains/deletes matching identity; different users cannot activate its work.
- **Realtime:** independent polling behind a replaceable WebSocket-style port. Durable source → idempotent retained journal → acknowledgment. Checkpoint follows successful merge, not arrival. Reconnect buffers/syncs through a fixed boundary/dedupes then Connected; expired history uses bounded snapshots.
- **Virtual navigation:** measured streams, keyed anchors, focused-row pinning, sparse target windows, cancellable readiness. DOM bounded; acquired histories still consume memory. Thread/ephemeral updates do not rebuild Timeline history.
- **Postmortem:** explicit revision CAS, clean fields adopt remote state, dirty fields remain local. Review/reload retains transient reference copy; Action revisions independent. No autosave/CRDT/approval/publish.
- **Fictional server vs local work:** canonical authorities/journal have separate databases from draft/outbox; not persisted Query cache or production security.

`src/app` composes `features → entities → shared`. [Technical Architecture](docs/technical-architecture.md), immutable [Product Specification](docs/product-spec.md), [final requirement/a11y/performance audit](docs/portfolio-audit.md).

## Actual stack

Next 16.3.8, React 19.3, strict TS 5.9, RTK 2.13/react-redux 9, Query 5, Virtual 3, RHF 7, Zod 4, Tailwind 4, MSW 2. Native HTML dialogs/Service Workers/IndexedDB/Web Crypto/AbortController/ResizeObserver. No Radix/shadcn, icon/animation package, Socket.IO or real WebSocket server installed.

## Quality and screenshots

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
git diff --check
```

Vitest: domain ordering/policy/CAS, persistence/delivery races, HTTP/session integration, journal/cache recovery, React keyboard/error/conflicts. Playwright: production `next start`, desktop/mobile, identity isolation, independent clients, recovery/expiry, old targets/anchors, safe content/inbox and large-history DOM. Native fictional IndexedDB. `pnpm start` serves an existing build.

Known Windows six-worker full-suite timeouts affect old realtime/Thread startup/resync and reproduced on Phase 7 baseline. Phase 8 CI #9 passed with two workers, zero actual retries. Supported local diagnostic: `pnpm exec playwright test --workers=2 --retries=0`; normal CI unchanged (two workers, one configured retry). Green supported runs are not a claimed six-worker success. [Audit](docs/portfolio-audit.md) records this; no assertion/timeout/config weakening.

Deterministic screenshot workflow (no bulky committed binaries):

```sh
pnpm build
pnpm exec playwright test tests/e2e/demo.spec.ts --grep "reviewer showcase" --project desktop-chromium --workers=1 --retries=0
pnpm exec playwright show-report
```

Showcase attaches six app-only PNGs: list, Timeline, Thread, Search, Demo and Postmortem. Fresh context/fixed seed; desktop begins 1280×720, Demo/Postmortem 1280×900 after responsive checks. No private browser/devtools data; ignored test-results/report attachments, not visual-regression baselines.

## Honest boundaries

- Mock auth/backend/polling; no shared remote server/security/production persistence/OAuth/integrations/AI/billing/analytics/attachments/rich text/offline background delivery.
- Same-origin tabs share fictional authority; profiles/devices do not. Destructive Demo maintenance needs Web Locks and other app tabs closed.
- Substantial accepted gap: ordinary commander status/severity/participant/transfer/important-marking UI and its full audit command subsystem absent. Demo is not a substitute. Settings documents browser preferences rather than an account preferences backend. Explicit [requirement audit](docs/portfolio-audit.md), not a hidden completion claim.
- Postmortem fields transient; same-document Back/Forward lacks global dirty-work interception. App links/commands/sign-out/native reload/close warn. Phase 8 task explicitly added structured Action assignment/date/status without changing accepted spec.
- Whole-bucket mock scans/validation and acquired Query windows limit stress scale. No FPS/security/WCAG certification claim. Remote HTTPS smoke and assistive-device matrix remain owner checks.
- No license selected; owner decision. Clean-room fictional data only; no private commercial repository inspected/reused.
