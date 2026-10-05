# Incident Room

Incident Room is a public portfolio project for coordinating technical incidents. Dedicated incident rooms will combine operational context, a realtime timeline, contextual discussions, and postmortem documentation using fictional, deterministic data.

**Current status:** Phase 4 Incident Room & Timeline Foundation implemented. Incident management and identity-safe authentication now include a measured virtual Timeline, older history, deep links, plain-text compose, durable drafts/outbox and idempotent delivery reconciliation. WebSocket business streaming, Threads and full Demo Mode are not implemented.

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

HTTP/session integration tests inject authority/clock to trigger expiry deterministically. Browser suites additionally exercise anchor preservation (8px tolerance), optimistic confirmation, rejected Retry, ambiguity after persistence, restored outbox/draft, old target/tombstone, in-flight target supersession, identity cleanup and responsive compose. A real 10,000-row projection has a bounded DOM in component tests; the browser also checks a 10,000-entry authority dataset. The generator supports 50,000 without loading that size by default. Fault/latency injection edits internal test-fixture IndexedDB records only: no test endpoint, product control or window global. No fragile FPS/wall-clock assertions. Each browser test has independent storage.

This is an independent clean-room project. No private commercial source or real incident data is used.
