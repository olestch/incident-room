# Production deployment

Repository readiness is not evidence of a hosted app. No suitable deployment account/credential has been provisioned in this task. Do not invent a URL or commit credentials.

## Conventional target: Vercel

Owner step: sign in, import `olestch/incident-room`, select Next.js, root `.`, Node **24.x**, install `pnpm install --frozen-lockfile`, build `pnpm build`, output default Next.js, production branch `main`. No environment variables or external database required; pinned pnpm comes from package.json. Keep platform routing defaults, no static export or SPA rewrites. See the [Next.js platform guide](https://vercel.com/docs/frameworks/full-stack/nextjs) and [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). Self-hosted Node 24 with `pnpm start` and an HTTPS reverse proxy is another conventional option; there is no production application backend.

## Browser/runtime requirements

- HTTPS (localhost for preview), Service Workers, Web Crypto, IndexedDB. Web Locks is needed only for destructive Demo maintenance; unsupported browsers refuse reset/replacement.
- `/mockServiceWorker.js` is the unchanged MSW vendor asset; `/fictional-realtime-worker.js` is the ephemeral broker scoped to `/mock-realtime/`. Serve both as JavaScript at the origin root, not HTML fallback.
- Do not introduce basePath without adapting both registrations. A restrictive CSP needs a designed Next nonce/worker policy, not an arbitrary blanket header.
- MSW intentionally starts in production, intercepting browser `/mock-api/*`; no remote server implements these endpoints. Never enter real accounts/passwords.
- Storage is origin/browser-profile local. Other profiles/devices/deployment hostnames do not share data. Denied/evicted/quota-limited storage has error boundaries; no server durability guarantee.
- Demo controls are intentional public simulation tools. Redux DevTools is off in production; production browser source maps are not enabled in next.config. No test window global or private endpoint is exposed.

## Verification boundary

Local/CI Playwright use `next start`, not dev: production MSW, IndexedDB, auth restoration/reload, deep URLs, independent clients, journal recovery, Postmortem conflicts and Demo maintenance. Phase 9 checks real 50k HTTP total plus bounded DOM.

After owner deployment, test the actual HTTPS URL: landing → River login → INC-2841 → Thread → Search → Notifications → INC-2865 Postmortem; reload a deep target; open a second same-origin tab; exercise latency and disconnect/generate/reconnect; close other tabs and reset. Confirm both worker registrations and no exceptions/hydration warnings. Local production success is not remote platform/header validation; this smoke remains manual until platform access is supplied.
