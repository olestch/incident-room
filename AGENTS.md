# Incident Room project rules

Read `docs/product-spec.md` and `docs/technical-architecture.md` before implementation changes. Preserve accepted product behavior. Implement only the phase explicitly authorized by the user.

This is an independent clean-room project. Never inspect, search, clone, or consult any previously audited private commercial repository. Never reuse its source, algorithms, schemas, fixtures, assets, terminology, or data. Use fictional data and independently designed code.

Respect `app → features → entities → shared` dependencies. TanStack Query owns confirmed server resources; Redux owns serializable client coordination; local UI state remains local. Never place runtime service instances or credentials into Redux.

Use pnpm consistently. Before committing, run formatting checks, lint, typecheck, unit/component tests, production build, and the configured browser smoke. Do not claim unexecuted checks passed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
