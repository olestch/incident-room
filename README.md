# Incident Room

Incident Room is a public portfolio project for coordinating technical incidents. Dedicated incident rooms will combine operational context, a realtime timeline, contextual discussions, and postmortem documentation using fictional, deterministic data.

**Current status:** Phase 5 Realtime Synchronization implemented. The existing virtual Timeline, history/deep links and durable draft/outbox now receive realtime confirmations through the same reconciliation path. Independent clients recover missed changes through a persistent journal, checkpoints and authoritative resync. Connection state, presence, typing and old-reader New updates are available. Threads, production WebSocket infrastructure and visible Demo Mode remain unimplemented.

The accepted [Product Specification](docs/product-spec.md) defines product behavior. [Technical Architecture](docs/technical-architecture.md) defines ownership, runtime boundaries, persistence, realtime, and testing decisions. The accepted Phase 0 document is preserved unchanged, including its historical implementation-status marker.

## Development

Use Node.js 24 and pnpm 11.19.0 (pinned in `package.json`). Install pnpm through your preferred package-manager setup, or use `corepack prepare pnpm@11.19.0 --activate` where Corepack is available.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000 and follow Sign in, or open `/app/incidents` directly. No environment variables or secrets are required. Browser Service Workers, Web Crypto and IndexedDB must be available (localhost or HTTPS).

## Fictional demo authentication

| Fictional user | Email                    | Demo password     | Role   |
| -------------- | ------------------------ | ----------------- | ------ |
| River Vale     | river.vale@example.test  | Fictional-pass-42 | Admin  |
| Sage Linden    | sage.linden@example.test | Fictional-pass-42 | Member |

Workspace: **Orbit Workshop**. These are public, fictional demo credentials, not real accounts. Never enter a real password. Registration creates a fictional active member of this workspace. Forgot password simulates a request only and sends no email.

MSW simulates authentication in both development and production preview. A public cookie correlates the browser with the fictional IndexedDB authority; it is not a secure token. Authority records contain public profiles, fictional verification digests and expiring leases, never submitted raw passwords or bearer/refresh tokens. This is **not production authentication/security**. Registered accounts and sessions survive reload while browser storage remains available. Access expires after five minutes; refresh eligibility lasts one day. Explicit logout removes the active client lease/cookie and visible identity cache, not shared fictional accounts.

Open `/app/incidents` to browse 32 deterministic fictional incidents. Filter status/severity, assignment, active participants and inclusive UTC creation dates; sort by update, creation or severity. Controls live in the URL and preserve refresh/back/forward. Load more retrieves at most 12 incidents at a time. My Incidents is the same list filtered by your stable user ID.

Active members and admins can create incidents. The responsive dialog uses a full-screen mobile surface; entered values and errors survive resizing. The creator becomes commander and participant, with Triggered status. Title is required (160 characters max); description is optional (4000 max); services and additional participants are optional. Dirty close asks for confirmation. Creation requires an online mock response, with no automatic retry or optimistic outbox. An ambiguous network failure retains/locks the submitted values and lets you retry the same idempotent submission. Confirmed incidents survive reload in the shared fictional IndexedDB authority. Clear browser site data to restore original fixtures; no product reset button is exposed.

`/app/incidents/INC-2841` opens a real Incident Room with 4,000 deterministic fictional entries. Other seeded incidents have 160 entries; newly created incidents start genuinely empty. Desktop keeps context beside the primary Timeline; mobile condenses context into expandable details. Load older history preserves the reading anchor. `?event=fictional-incident-2841%3Aevt-20` locates an old tombstone through a bounded target window without paging through all history; unknown query parameters/hash remain intact. Target errors leave the room usable with Retry and Go to latest.

Participants, commander and admins may compose on active incidents. Resolved/nonparticipant rooms remain readable. Messages are plain text up to 4,000 characters; Enter inserts a newline, Ctrl/Cmd+Enter sends (not during IME), and a visible Send button is available. Mention selects an active workspace person and inserts readable text with their stable ID; no rich text or mention-popup editor. Only safe HTTP(S) URLs become links.

Native IndexedDB stores identity/incident-scoped drafts and outbox separately from fictional server authority data. Drafts debounce for 250ms and flush on navigation/pagehide; the last uncommitted keystrokes cannot be guaranteed after an abrupt browser/process crash. Send atomically persists the outbox and clears its draft before clearing the editor or dispatching HTTP. Storage failure keeps editor text. Unknown transport outcomes are checked by mutation ID before any explicit Retry; reload never blindly resends. Explicit logout deletes this identity's local work; expiry/switch quarantine it. There is no offline-first/background delivery or cross-tab local coordination.

Other future-feature destinations remain placeholders. Authentication preserves safe `/app/` return paths including query/hash; external/malformed returns fall back to `/app/incidents`. A full navigation crosses the auth boundary intentionally; in-app navigation uses Next.js.

## Realtime simulation

Open two tabs in the same browser profile/origin and the same incident. Each tab owns an independent authenticated transport and checkpoint; a confirmed message appears in the other without refreshing. The deterministic mock adapter polls a shared fictional-server IndexedDB journal every 500ms; it implements WebSocket-style lifecycle behind a replaceable port, not an actual network WebSocket or production server. Separate browser profiles/contexts have separate fictional-server storage and do not share a backend.

Transport connection does not imply synchronization: Connecting/Reconnecting remains visible until authoritative recovery completes. Browser offline is a hint; old confirmed content and durable local work remain readable. Online recovery fetches missed persistent changes, buffers live events, merges revisions and only then reports Connected. Expired checkpoints refresh bounded recent/loaded-entry snapshots without clearing draft/outbox or reloading the app. Retry connection is explicit; mutation retries remain user-driven.

Room presence and rate-limited typing use a separate Service Worker's **in-memory fictional-server** lease registry, never persistent storage or Timeline events. Departure/disconnect removes the lease; abandoned leases expire and worker restart rebuilds from active heartbeats. This is no cross-tab socket sharing, leader election or direct client messaging. Each client reads server snapshots; no BroadcastChannel/SharedWorker is used. The list watches workspace metadata without joining incident presence. New updates counts distinct newly confirmed entries while reading older history, preserving the anchor and active deep link until explicitly returning to latest.

## Validation

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm format` applies formatting, and `pnpm test:watch` runs unit/component tests interactively. Playwright starts the production application on port 3100; run `pnpm build` first. `pnpm start` serves an existing production build.

## Stack and scope

React 19, Next.js, TypeScript, Redux Toolkit, TanStack Query, React Hook Form, Zod, WebSocket, TanStack Virtual, Tailwind CSS, Radix UI / shadcn/ui, MSW, IndexedDB where appropriate, Vitest, React Testing Library, Playwright, and GitHub Actions.

React/Next.js, Redux, Query, Tailwind, RHF/Zod forms, MSW auth/incident/Timeline authorities, TanStack Virtual, native IndexedDB, Vitest/Testing Library, Playwright and CI are configured. Confirmed resources belong to Query; Redux stores serializable session/connection and local mutation coordination metadata, never confirmed Timeline content. Central semantic policy governs both UI and authority. Session lifecycle now stops local work and integrates durable logout cleanup with the existing retry barrier. The creation surface uses native HTML dialog; no Radix/shadcn package is installed.

HTTP/session integration tests inject authority/clock to trigger expiry deterministically. Realtime tests cover validation, checkpoint commits, duplicates/revisions/tombstones, cancellation/deadlines, backoff, buffering and journal retention. Browser suites exercise multi-client live delivery, reconnect/resync, dropped/duplicate/reversed delivery, optimistic echo before HTTP, expired snapshots, presence/typing, metadata convergence and target/old-reader preservation alongside earlier auth/Timeline regressions. A real 10,000-row projection has a bounded DOM in component tests; the browser also checks a 10,000-entry authority dataset. The generator supports 50,000 without loading that size by default. Fault/latency injection edits internal test-fixture IndexedDB records only: no test endpoint, product control or window global. No fragile FPS benchmarks. Tests isolate storage; multi-client cases deliberately share one fictional server through independent pages in one browser context.

This is an independent clean-room project. No private commercial source or real incident data is used.
