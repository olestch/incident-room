# Production deployment

Netlify is the owner's selected target. This repository is prepared for a normal Next.js deployment, not a static export. No hosted URL is available yet; repository preparation and local/CI success are not evidence of a successful Netlify deployment.

## Netlify compatibility and build configuration

Netlify documents [Next.js 16 support](https://www.netlify.com/changelog/next-js-16-deploy-on-netlify/) and automatically supplies its maintained [OpenNext adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/). App Router/RSC and deep routes retain Next.js handling. Do not install/pin a legacy plugin or add `output: 'export'`, SPA fallbacks, custom functions or a remote mock API server.

Root `netlify.toml` owns the build command `pnpm build` and [publish directory `.next`](https://docs.netlify.com/snippets/frameworks/nextjs-config-values/). Leave the base at the repository root and production branch at `main`. The adapter processes Next output, serves public/static assets and provisions framework rendering functions; `.next` is not a folder to deploy manually as a static site.

- **Node:** `NODE_VERSION = "24"` selects Node 24 before install. `package.json#engines` remains the compatibility constraint, not Netlify's documented version-selection mechanism. No redundant `.nvmrc`/`.node-version` or function-runtime override is added. Netlify normally [derives its Node functions runtime from the build version](https://docs.netlify.com/build/functions/configuration/#nodejs-version-for-runtime); confirm Node 24 in deploy logs.
- **pnpm:** Netlify detects `pnpm-lock.yaml`; Corepack reads the existing exact `packageManager: pnpm@11.19.0`. No duplicate pnpm version variable. See [dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/).
- **Install/hoisting:** `PNPM_FLAGS = "--frozen-lockfile"` freezes the lockfile. `PNPM_CONFIG_SHAMEFULLY_HOIST = "true"` supplies Netlify's current [Next.js pnpm hoisting requirement](https://docs.netlify.com/snippets/frameworks/nextjs-pnpm-support/) throughout install and build. With pnpm 11.19.0, an install-only `--shamefully-hoist` flag caused the next ordinary script to attempt a layout-changing automatic reinstall; the pnpm configuration environment variable was verified locally to preserve the layout across commands. See [pnpm configuration](https://pnpm.io/settings). This is a Netlify-only install-layout setting, not a dependency or application-state change; repository local/CI defaults remain unchanged.
- **Environment:** no application environment variables, credentials or external database. The three non-secret TOML variables select build tooling only. Do not set `NODE_ENV=production` during dependency installation: this can omit required devDependencies (MSW, build tooling). `next build` still produces a production app.

No explicit headers, redirects or cache overrides are needed for the existing root `.js` public assets. No CSP is added; do not add immutable/long-lived worker caching. Actual CDN MIME/header behavior must be checked on the deployed HTTPS URL.

## Owner import procedure

1. In the Netlify team's Projects page, choose **Add new project → Import an existing project**, select GitHub and authorize repository access if prompted. Follow the [current import guide](https://docs.netlify.com/manage/projects/add-new-project/).
2. Select `olestch/incident-room`, production branch `main`, repository-root base. Confirm detected Next.js and repository configuration: `pnpm build`, `.next`; do not use `public`/`out` as publish directory.
3. Keep automatic adapter updates enabled. Remove conflicting legacy overrides if importing an existing project; verify Node 24, pnpm 11.19.0 and configured install flags in the build log. No secret setup is required.
4. Complete Netlify's deploy action, inspect the full build/adapter/function logs and copy the successful HTTPS production URL.
5. Run the checklist below on that exact hostname before declaring hosted readiness or adding a README/GitHub homepage URL.

## Browser/runtime requirements

- HTTPS (localhost for preview), Service Workers, Web Crypto, IndexedDB. Web Locks is needed only for destructive Demo maintenance; unsupported browsers refuse reset/replacement.
- ResizeObserver and AbortController (including `any`/`timeout`) must be supported by the browser. These APIs are not Netlify function dependencies; use current supported browsers. Private mode, denied storage or quotas may limit the fictional demo.
- `/mockServiceWorker.js` is the unchanged MSW vendor asset; `/fictional-realtime-worker.js` is the ephemeral broker scoped to `/mock-realtime/`. Serve both as JavaScript at the origin root, not HTML fallback.
- Do not introduce basePath without adapting both registrations. A restrictive CSP needs a designed Next nonce/worker policy, not an arbitrary blanket header.
- MSW intentionally starts in production, intercepting browser `/mock-api/*`; no remote server implements these endpoints. Never enter real accounts/passwords.
- Storage is origin/browser-profile local. Other profiles/devices/deployment hostnames do not share data. Denied/evicted/quota-limited storage has error boundaries; no server durability guarantee.
- Demo controls are intentional public simulation tools. Redux DevTools is off in production; production browser source maps are not enabled in next.config. No test window global or private endpoint is exposed.

Session initialization starts MSW before restoring the browser session, without a development-only gate. Thus HTTPS page → root worker registration → browser `/mock-api/*` interception is the intended production path. Fetching a mock API directly without the browser worker need not succeed; Netlify is not the fictional authority.

Demo scheduling, disconnect/resync, persistent generation and 10k/50k replacement stay browser-owned. Reset uses origin-local named stores/Web Locks and relative redirects, with no localhost assumption. Close all other loaded app tabs before replacement/reset. Maintenance is not globally atomic across databases; stress-scale CPU/storage cost remains a browser limitation.

## Origins and Deploy Previews

Same hostname/scheme/port and browser profile share IndexedDB across tabs; clients keep independent sessions/transports. Netlify production, Deploy Preview, branch-deploy and deploy-permalink hostnames are distinct origins. Preview data/leases do not migrate to production or to a custom domain. Deploy Previews are useful for smoke checks of fictional data, not evidence that another origin's persistent state carries over. Use two tabs on the same exact URL origin for realtime verification.

## Verification boundary

Local/CI Playwright use `next start`, not dev: production MSW, IndexedDB, auth restoration/reload, deep URLs, independent clients, journal recovery, Postmortem conflicts and Demo maintenance, including real 50k HTTP total plus bounded DOM. They validate the application, not Netlify's adapter/CDN deployment. Netlify CLI is not installed; no account linking, one-off CLI dependency or deployment was introduced merely to simulate a platform incompletely.

## Post-deployment HTTPS smoke checklist

Use only fictional credentials/data, on the successful production hostname:

- [ ] Landing renders; River (`river.vale@example.test` / `Fictional-pass-42`) signs in; `/app/incidents` works and authenticated reload restores the session.
- [ ] INC-2841 Timeline loads, older history loads, and a sent message confirms once and remains after reload.
- [ ] Both `/mockServiceWorker.js` and `/fictional-realtime-worker.js` return HTTP 200 with JavaScript MIME (`text/javascript` or `application/javascript`) and JS body, not HTML/login fallback. Browser Application/Storage tools show the root MSW registration and `/mock-realtime/` broker; no registration/scope/update errors. Reload/revisit verifies updates are not held by custom immutable caching.
- [ ] Direct-open/reload `/app/incidents/INC-2841?event=fictional-incident-2841:evt-42`, `/app/incidents/INC-2841?thread=fictional-incident-2841:evt-42`, and `/app/incidents/INC-2865/postmortem`. Anonymous entry returns safely through login; authenticated entry preserves targets.
- [ ] A second same-origin tab receives one confirmed message. Disconnect → generate persistent event → reconnect displays the missed event through resync before Connected.
- [ ] Demo latency produces a real loading/delivery wait; failure simulation affects ordinary requests; Clear simulations restores defaults without deleting data.
- [ ] After closing other app tabs, confirm 10k then 50k replacement; Timeline remains bounded/usable and an old target/Thread still opens. These are functional checks, not FPS guarantees.
- [ ] With other app tabs closed, confirm Reset Demo; login returns, defaults reseed, generated work disappears and fictional storage persists normally across subsequent reloads.
- [ ] Search `Aurora`, follow a target, inspect Notifications and initiate/edit INC-2865 Postmortem. Optional River/Sage independent clients check stale Save/conflict without overwriting the winner.
- [ ] No unexpected hydration errors, uncaught exceptions, worker failures or missing static assets in console/network; Next direct routes are not replaced by a broad SPA fallback.

Unresolved until owner deployment: exact build-image/Corepack/adapter behavior for pinned versions, generated function runtime, CDN asset MIME/cache behavior, HTTPS browser registration and remote route smoke. If a real failure occurs, preserve deploy logs/response headers/browser errors and diagnose before changing versions, routing or timeouts. Local success alone does not close these checks.
