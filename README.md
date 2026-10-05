# Incident Room

Incident Room is a public portfolio project for coordinating technical incidents. Dedicated incident rooms will combine operational context, a realtime timeline, contextual discussions, and postmortem documentation using fictional, deterministic data.

**Current status:** Phase 0 accepted; Phase 1 technical foundation established. The application currently provides a minimal responsive shell, providers, and error recovery. Incident business features are not implemented yet.

The accepted [Product Specification](docs/product-spec.md) defines product behavior. [Technical Architecture](docs/technical-architecture.md) defines ownership, runtime boundaries, persistence, realtime, and testing decisions. The accepted Phase 0 document is preserved unchanged, including its historical implementation-status marker.

## Development

Use Node.js 24 and pnpm 11.19.0 (pinned in `package.json`). Install pnpm through your preferred package-manager setup, or use `corepack prepare pnpm@11.19.0 --activate` where Corepack is available.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Phase 1 requires no environment variables or secrets.

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

React/Next.js, Redux, Query, Tailwind, lint/typecheck, Vitest/Testing Library, Playwright, and CI are configured. Forms, virtualization, HTTP mocks, realtime adapters, IndexedDB outbox/drafts, and accessible dialog primitives are selected for later feature work; their business behavior is not implemented in this phase.

This is an independent clean-room project. No private commercial source or real incident data is used.
