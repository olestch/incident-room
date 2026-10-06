# Incident Room

Incident Room is a fictional realtime incident-coordination SaaS-style application built to demonstrate complex frontend architecture. It brings large dynamic histories, durable optimistic messaging, reconnect/resync and contextual navigation into one React product. Collaborative Postmortems demonstrate explicit conflict handling without CRDT/OT.

**React 19 · Next.js 16 · TypeScript · Redux Toolkit · TanStack Query · TanStack Virtual · IndexedDB**

[Run locally](#local-development) · [Demo credentials](#demo-credentials) · [Architecture](docs/technical-architecture.md) · [Deployment guide](docs/deployment.md)

Live deployment: pending.

Quick start with Node **24** and pinned pnpm **11.19.0**:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000` and sign in as `river.vale@example.test` with the fictional password `Fictional-pass-42`. No environment variables or secrets required. Never enter real passwords or incident data.

## Engineering highlights

- **50k variable-height Timeline:** TanStack Virtual, bounded DOM, keyed anchor preservation and deep navigation into unloaded history.
- **Durable optimistic delivery:** IndexedDB draft/outbox, stable mutation identity, ambiguous-outcome reconciliation and safe explicit retries.
- **Realtime convergence:** replaceable simulated transport, retained event journal, committed checkpoints, reconnect/resync and duplicate/out-of-order handling.
- **Contextual Threads:** flat discussions with independent virtualization, deep links and shared realtime reconciliation.
- **Server-style discovery:** authority-backed Search, recipient Notifications and keyboard Command Palette without downloading complete client histories.
- **Conflict-safe collaboration:** revision/CAS-based Postmortem and Action Item editing; dirty local fields survive remote updates and rejected stale saves.

## What to try

1. **Large Timeline:** open **INC-2841**, load older history or follow an old target. Demo Mode can replace its dataset with 10k/50k entries.
2. **Optimistic messaging:** send with Ctrl/Cmd+Enter (Enter inserts a newline); observe one logical item reconcile on confirmation. Demo latency makes delivery states easier to inspect.
3. **Two-tab convergence:** open INC-2841 in another same-origin tab and send activity; independent clients converge without reload.
4. **Reconnect/resync:** Demo Mode → Disconnect → Generate persistent event → Reconnect. Missed activity appears through authoritative resync.
5. **Contextual navigation:** open a Thread, search `Aurora`, or visit `/app/incidents/INC-2841?thread=fictional-incident-2841:evt-42` for the old 2k discussion. Ctrl/Cmd+K opens the palette outside editable fields.
6. **Collaborative conflicts:** River initiates **INC-2865** Postmortem; Sage edits as a participant in a second client. Save competing edits to inspect stale-save rejection, Review latest and Reload latest.

## Demo credentials

| Fictional user | Email                    | Public demo password | Role   |
| -------------- | ------------------------ | -------------------- | ------ |
| River Vale     | river.vale@example.test  | Fictional-pass-42    | Admin  |
| Sage Linden    | sage.linden@example.test | Fictional-pass-42    | Member |

River is the recommended reviewer identity. Orbit Workshop and all incident data are fictional. Registration creates a browser-stored fictional account; recovery sends no email. Same-origin tabs share fictional authority data; browser profiles/devices do not.

## Demo Mode

Expand the labelled **Demo Mode** panel above the product surface:

- Request latency: **0 / 500 / 2,000 / 5,000 ms**; deterministic pre-persistence failures: **0 / 10 / 30%**.
- Actual coordinator disconnect/reconnect and persistent monitoring, deployment, human-message or authorized forward-status generation.
- Confirmed Timeline replacement: **100 / 1k / 10k / 50k**; full fictional-data reset or configuration-only Clear simulations.

Configuration is tab-local and returns to defaults on reload. **Replacement/reset are destructive: read the confirmation and close other app tabs first.** [Detailed scheduling, event and maintenance semantics](docs/technical-architecture.md#demo-control-semantics) remain in technical documentation.

## Architecture

State has explicit owners:

- **TanStack Query:** validated confirmed server-style resources and bounded acquisition windows.
- **Redux Toolkit:** serializable session, connection and local-mutation coordination plus Demo configuration; no service instances or confirmed-resource mirror.
- **React Hook Form / local React state:** editable forms, dialogs and presentation state.
- **IndexedDB:** durable identity-scoped local drafts/outbox, separate from the fictional server's authority databases.
- **URL:** filters, sort and Timeline/Thread/message navigation targets.

`app → features → entities → shared` boundaries are lint-enforced. Runtime services own cancellation/disposal outside React rendering and Redux. [Technical Architecture](docs/technical-architecture.md) explains delivery races, checkpoint commits, sparse target windows, cache ownership and conflict handling.

## Tech stack

Next.js **16.3.8**, React **19.3**, strict TypeScript **5.9**, RTK **2.13** / react-redux **9**, TanStack Query **5**, Virtual **3**, React Hook Form **7**, Zod **4**, Tailwind **4**, MSW **2**. Native HTML dialogs, Service Workers, IndexedDB, Web Crypto, Web Locks, AbortController and ResizeObserver; no additional UI or realtime framework.

## Testing

Validated baseline: **319 Vitest unit/integration/component tests** and **166 Playwright E2E tests**, desktop/mobile Chromium. Coverage includes identity isolation, durable delivery races, multi-client realtime, reconnect/resync, old deep targets/anchors, Postmortem conflicts and large-history behavior. Playwright runs against production `next start`, not the development server.

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

On the original Windows development host, high-concurrency Playwright runs could become resource-sensitive; CI uses the stable two-worker configuration. For local inspection: `pnpm exec playwright test --workers=2 --retries=0`. [Detailed observations and unresolved cause](docs/portfolio-audit.md#renderingperformance) are retained in the audit; tests and CI have not been weakened.

### Screenshot workflow

```sh
pnpm build
pnpm exec playwright test tests/e2e/demo.spec.ts --grep "reviewer showcase" --project desktop-chromium --workers=1 --retries=0
pnpm exec playwright show-report
```

The fixed-seed showcase attaches six app-only PNGs: list, Timeline, Thread, Search, Demo and Postmortem. Desktop starts at 1280×720; Demo/Postmortem use 1280×900 after responsive checks. Output stays in ignored test/report directories, not committed binary assets or visual-regression baselines.

## Local development

Use Node **24** and **pnpm 11.19.0** (`packageManager` is pinned). Install with `pnpm install --frozen-lockfile`, run `pnpm dev`, then open `http://localhost:3000`. For production preview: `pnpm build` followed by `pnpm start`.

Use a modern browser with Service Workers, IndexedDB and Web Crypto on localhost/HTTPS. Destructive Demo maintenance additionally requires Web Locks. No external database or environment secrets are needed. Hosting requirements and post-deployment smoke checks are in the [deployment guide](docs/deployment.md).

## Known limitations

- Fictional browser-backed backend/authentication, simulated polling transport rather than production WebSocket infrastructure, and no production server persistence/security.
- The full commander operational workflow is intentionally outside the implemented portfolio scope: ordinary status/severity/participant/transfer/important-marking controls and their full audit command subsystem are not implemented. Demo is not a substitute; the [strict requirement audit](docs/portfolio-audit.md) preserves the accepted-specification gap.
- No attachments, rich text or external integrations. Settings describes browser preferences, not an account-preference service.
- Same-origin/browser-profile storage only. Reset across multiple databases is not globally atomic; Postmortem browser Back/Forward lacks an unsaved-work guard. Detailed recovery boundaries remain in the audit/architecture.
- Whole-bucket mock scans and acquired Query windows limit stress scale; bounded DOM is not a throughput/FPS guarantee or accessibility/security certification.
- Live deployment and remote HTTPS smoke are pending. License remains an owner decision; no license has been added. All demo fixtures are independently authored and fictional.

## Documentation

- [Product Specification](docs/product-spec.md): immutable accepted product requirements.
- [Technical Architecture](docs/technical-architecture.md): implemented ownership, lifecycle, reconciliation and technical decisions.
- [Portfolio Audit](docs/portfolio-audit.md): strict requirement mapping, accessibility/performance findings and known gaps.
- [Deployment](docs/deployment.md): compatible hosting requirements, example setup and production smoke checklist.
