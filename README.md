# Incident Room

Incident Room is a public portfolio project for coordinating technical incidents. Dedicated incident rooms will combine operational context, a realtime timeline, contextual discussions, and postmortem documentation using fictional, deterministic data.

**Current status:** Phase 2 authentication lifecycle implemented. Login, registration, simulated password recovery, restoration/refresh, logout, protected routing and an identity-safe responsive shell are available. Incident business features are not implemented yet.

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

`/app/incidents` and recognized deeper destinations are placeholders. Authentication preserves safe `/app/` return paths including query/hash; external/malformed returns fall back to `/app/incidents`. A full navigation crosses the auth boundary intentionally; in-app navigation uses Next.js.

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

React/Next.js, Redux, Query, Tailwind, RHF/Zod auth forms, MSW auth authority, Vitest/Testing Library, Playwright and CI are configured. Current-user profile belongs to Query; Redux contains minimal session coordination only. A lifecycle contract provides future identity-bound service shutdown and explicit-logout cleanup hooks without inventing drafts/outbox data.

HTTP/session integration tests inject authority/clock to trigger expiry deterministically. E2E changes fictional authority leases only through test fixtures; no expiry control or test endpoint is exposed in the product. Browser suites cover protected/deep return, registration, reload, logout/identity switch, recovery, refresh/terminal expiry and mobile/tablet usability. Virtualization, realtime transport, Incident features, IndexedDB outbox/drafts and dialog primitives remain future work.

This is an independent clean-room project. No private commercial source or real incident data is used.
