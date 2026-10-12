# Incident Room

Incident Room is a frontend portfolio application that models how a team investigates a technical incident: an operational Timeline, contextual discussions, and a shared postmortem. It uses fictional data and a browser-backed API simulation to demonstrate state ownership, durable optimistic messaging, and recovery from interrupted realtime delivery.

This is a demo application, not a production incident management service.

[Getting started](#getting-started) · [Engineering highlights](#engineering-highlights) · [Architecture](docs/technical-architecture.md) · [Deployment guide](docs/deployment.md)

## Live demo

**Not deployed yet.** Netlify deployment is pending review. The live demo URL will be added here after deployment and HTTPS verification.

## Screenshots

Screenshots have not been committed. The planned visual overview is:

| Screen                   | Capture instructions                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incident list            | Sign in as River; capture `/app/incidents` at 1280 × 900 with the filters collapsed and Demo tools closed.                                          |
| Incident Room and Thread | Open `/app/incidents/INC-2841?thread=fictional-incident-2841:evt-4000` at 1280 × 900; wait for Timeline and Thread content and the Connected state. |
| Postmortem               | Open `/app/incidents/INC-2865/postmortem`, initiate the postmortem as River, and show the editor with one fictional Action Item at 1280 × 900.      |
| Mobile Room              | Capture `/app/incidents/INC-2841` at 390 × 844 with incident context and Thread closed, showing Timeline and composer.                              |

Use a fresh browser profile and default dataset for repeatable captures. Save app-only PNGs under `docs/screenshots/` and embed them here once reviewed. The current tests do not generate a screenshot gallery; a static capture does not verify mobile scrolling.

## Key functionality

- Fictional login, registration, session restoration/refresh, protected routes, and safe return navigation.
- Incident creation, URL-owned filters/sort, cursor pagination, and participant-aware messaging.
- Variable-height virtualized Timeline and Threads, durable drafts/outbox, delivery feedback, and deep links into unloaded history.
- Simulated realtime updates, presence/typing, disconnect recovery, and recipient notifications.
- Search across incidents, Timeline/Thread messages, and users; keyboard Command Palette.
- Shared postmortem drafts with explicit save conflicts, evidence references, and Action Item assignment, due date, and status.

## Technology stack

Versions are pinned in [package.json](package.json) and [pnpm-lock.yaml](pnpm-lock.yaml).

| Technology                            | Version                                        | Role                                                                                |
| ------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Next.js / React                       | 16.3.8 / 19.3.0                                | App Router, server-rendered route composition, interactive client surfaces          |
| TypeScript                            | 5.9.3                                          | Strict domain and runtime boundary contracts                                        |
| Redux Toolkit / React Redux           | 2.13.0 / 9.3.0                                 | Serializable session, connection, local-work coordination, and Demo configuration   |
| TanStack Query                        | 5.104.1                                        | Confirmed resources, cursor queries, cancellation, and revision-aware cache updates |
| TanStack Virtual                      | React 3.14.13; core 3.17.11 with a local patch | Measured Timeline/Thread viewports                                                  |
| React Hook Form / Zod                 | 7.89.0 / 4.6.5                                 | Editable form state and validation of API/storage inputs                            |
| Tailwind CSS / Lucide React           | 4.3.3 / 1.52.0                                 | Styling tokens and icons; native dialogs supply modal behavior                      |
| MSW                                   | 2.15.0                                         | Browser HTTP simulation in development and production                               |
| Vitest / Testing Library / Playwright | 5.0.3 / React 16.3.3 / 1.63.0                  | Unit, component, integration, and browser tests                                     |

IndexedDB, Service Workers, Web Crypto, Web Locks, and ResizeObserver provide the browser runtime capabilities without an additional persistence or realtime framework.

## Engineering highlights

**Explicit state ownership.** Query owns confirmed resources; Redux owns serializable coordination; forms and presentation state stay local; URL parameters own filters and navigation targets. ESLint enforces `app → features → entities → shared` dependencies. Runtime services live outside Redux and dispose asynchronous work on identity changes.

**Virtualization with bounded acquisition.** Timeline and Threads share a measured stream with stable logical keys and focus retention. History arrives in windows of up to 60 records; a locator retrieves a distant target without loading every intervening page. Demo datasets reach 50,000 entries. Virtualization bounds mounted DOM, while acquired cache windows and whole-bucket mock storage still have scaling costs. A [version-specific wheel compensation patch](docs/timeline-wheel-compensation.md) has dedicated regression coverage; touch/drag scrolling remains under investigation.

**Durable optimistic delivery.** Sending atomically transfers a draft into an identity-scoped IndexedDB outbox before clearing the editor. A stable mutation ID joins HTTP confirmations and realtime echoes into one logical message. An unknown outcome is looked up before explicit retry; restored work is never blindly resent. This protects against duplicate delivery without promising background offline messaging.

**Realtime recovery before Connected.** Independent clients poll a retained event journal through a replaceable transport. The coordinator buffers live events, synchronizes to an authoritative boundary, applies revisions, and commits checkpoints after successful application. Expired checkpoints trigger resource snapshots. Presence and typing use an ephemeral worker and stay outside persistent incident history.

**Conflict-aware postmortems.** Document and Action Item saves use separate expected revisions. A stale save is rejected while local edits remain available for review/reload. This demonstrates shared editing without a CRDT or automatic text merge. Search and Notifications likewise use bounded, identity-scoped resources rather than deriving everything from loaded Timeline content.

See [Technical Architecture](docs/technical-architecture.md) for contracts, lifecycle rules, and maintenance trade-offs.

## Getting started

Use **Node.js 24.x** and **pnpm 11.19.0**, as required by `engines` and `packageManager`. Use a current browser with Service Workers, IndexedDB, and Web Crypto on localhost or HTTPS. Web Locks is also required for destructive Demo maintenance.

```sh
pnpm --version # must report 11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. No application environment variables, credentials, or external database are required.

Production preview:

```sh
pnpm build
pnpm start
```

## Demo data and limitations

| Fictional user | Email                    | Public demo password | Role   |
| -------------- | ------------------------ | -------------------- | ------ |
| River Vale     | river.vale@example.test  | Fictional-pass-42    | Admin  |
| Sage Linden    | sage.linden@example.test | Fictional-pass-42    | Member |

Use River for the initial walkthrough. Orbit Workshop and all fixtures are fictional; enter only fictional accounts, passwords, and incident content. Registration stores a demo account in this browser; password recovery sends no email.

Open INC-2841 for the Timeline, search `Aurora`, or initiate INC-2865's postmortem. Ctrl/Cmd+Enter sends a message; Enter inserts a newline. Ctrl/Cmd+K opens the palette outside editable controls. To inspect recovery, use **Demo tools → Disconnect → Generate persistent event → Reconnect**. Two tabs on the same origin share fictional authority data while keeping independent client runtimes.

Demo tools expose latency, deterministic failures, event generation, and 100/1k/10k/50k Timeline replacement. **Replacement/reset remove demo work; close other app tabs and read the confirmation first.** Clear simulations changes configuration only. Simulation settings return to defaults on reload.

- The backend, authentication, and realtime transport are simulated. Storage belongs to one origin/browser profile; devices, profiles, and deployment hostnames do not share it.
- Ordinary commander status/severity/participant/transfer/important-entry controls are incomplete. Existing policies and Demo status generation do not implement that workflow.
- Mobile touch-like or drag scrolling can still move the viewport unexpectedly. The wheel patch does not resolve all mobile scrolling paths.
- Postmortem browser Back/Forward lacks an unsaved-work guard; reset across databases is not globally atomic. No attachments, rich text, real integrations, or background offline delivery.
- Large fixtures test functional behavior and bounded DOM, not measured FPS, throughput, or full device/accessibility certification.

The [requirement mapping and maintenance limitations](docs/portfolio-audit.md) distinguish implemented behavior from accepted product requirements.

## Project structure

```text
src/app/          Next.js routes, providers, shell, and cross-feature composition
src/features/     Session, incidents, messaging, realtime, discovery, postmortem, Demo
src/entities/     Validated models, query keys, filters, and domain policies
src/shared/       Messaging/persistence primitives, Query setup, UI, diagnostics
tests/e2e/        Production browser journeys in desktop/mobile Chromium
tests/dev-e2e/    Development startup, effect replay, and scroll regressions
public/           MSW worker and fictional ephemeral realtime worker
patches/          Pinned TanStack Virtual core patch
docs/             Product specification, architecture, deployment, known limits
```

## Testing

Vitest covers domain rules, authority transactions, cancellation, session isolation, delivery/realtime races, and component interactions. Playwright exercises production `next start`: direct routes, authentication/reload, native storage, independent clients, deep targets, responsive layouts, postmortem conflicts, and large datasets. A separate development suite checks Strict Mode startup and stream regressions.

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:e2e:dev
git diff --check
```

CI runs both browser suites. Production browser tests use two workers in CI; for the same local concurrency without retries, run `pnpm test:e2e --workers=2 --retries=0`. Development configuration uses one worker and no retries. Chromium device emulation does not verify physical Safari touch/momentum behavior.

## Deployment

**Netlify deployment is pending.** Existing [netlify.toml](netlify.toml) selects `pnpm build`, `.next`, Node 24, frozen installation, and public dependency hoisting. Netlify's maintained [Next.js adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) handles App Router and direct routes. The app requires a normal Next.js deployment; MSW intentionally runs in the production browser.

The [deployment guide](docs/deployment.md) documents exact settings, worker/storage requirements, and the post-deployment HTTPS checklist. Local validation does not verify Netlify's build image, adapter, or CDN behavior.

## Documentation

- [Product Specification](docs/product-spec.md): original accepted requirements, preserved unchanged.
- [Technical Architecture](docs/technical-architecture.md): state ownership, runtime contracts, and operational decisions.
- [Requirement mapping and limitations](docs/portfolio-audit.md): current gaps and maintenance considerations.
- [Deployment guide](docs/deployment.md): Netlify setup and hosted verification.
- [Virtualizer patch](docs/timeline-wheel-compensation.md) and [development diagnostics](docs/scroll-diagnostics.md): evidence, maintenance, and device verification.

## License

No license file is present. Licensing remains an owner decision.
