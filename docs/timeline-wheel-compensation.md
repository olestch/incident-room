# Timeline wheel compensation: evidence and fix

The October 12, 2026 recording demonstrates delayed measurement compensation in an iPhone-UA **wheel** session. This fix addresses that reproduced path. Touch-like or drag-based scrolling can still move the viewport unexpectedly and remains under investigation. This patch does not establish that physical iPhone touch/momentum scrolling is free of other defects.

## Evidence

The supplied `incident-room-scroll-debug.json` has 1,844 events, 59 annotations, no dropped events, a 375×667 viewport, 158 wheel events, and **no touch events or application scroll commands**. Its commit field is null. SHA-256: `b9089c51802a9fec2c4dcace0a9c53e28dd73f4dbe1904a44576e6929ef1beba`. The UA alone cannot identify the actual browser engine.

| Native write | Requested adjustment | Actual movement | Loaded rows |
| ------------ | -------------------: | --------------: | ----------: |
| #158         |                 +425 |          +424.8 |          60 |
| #359         |                 +353 |          +352.8 |          60 |
| #622         |                +1076 |         +1076.0 |          60 |
| #856         |                 +554 |          +554.4 |          60 |
| #1356        |                 +839 |          +839.2 |         120 |
| #1584        |                 +805 |          +804.8 |         120 |
| #1829        |                 +536 |          +536.0 |         120 |

The seven independent delayed batches above exactly equal the measured size deltas since the previous write. The remaining six writes (#1130–#1155) belong to one expected prepend/measurement batch: the native offset changes from 0 to 8123.2 as 60 rows are prepended, while the same visible anchor remains at approximately 140px (140→139.8). Large native movement alone is not proof of a visual defect.

The first failure separates content movement from native movement:

1. #123 is the last wheel input before the correction (−62, 2187.9ms).
2. #129/#137/#144/#152 first-measure rows 45/44/43/42 at 170/294/278/203px. Against the 130px estimates, their nonzero deltas sum to **425px**.
3. #146 is the last native scroll before idle (2329.3ms, top 7117.6). At #154/#155 (2371.2ms), total size grows 9407→9480 with native top unchanged. The same key moves from −106.6→−33.6px, generating geometry-mismatch #157.
4. #158 writes native top 7117.6→7542.4 at 2479.9ms, 150.6ms after the native scroll, with `adjustments: 425`. The next geometry sample changes direction to forward. Row count remains 60; no pagination, target command, width resize, or append explains this batch.

The recorder's 59 annotations include ordinary user/momentum motion and the legitimate prepend. They are conservative signals, not 59 proven defects. An external delivery artifact reconstructs each annotation and all 13 writes with adjacent geometry, input, measurement, and application state. React render counts/layout-effect entry times are not present in the original recording; committed geometry provides ordering evidence, not a React profiler trace.

## Exact caller

Installed versions remain `@tanstack/react-virtual@3.14.13` and `@tanstack/virtual-core@3.17.11`.

In core `src/index.ts`, `resizeItem` computes measured-size deltas and invokes `applyScrollAdjustment`. Its iOS detection accepts an iPhone UA, including Chromium emulation. The original condition defers compensation whenever `isScrolling` is true, even for wheel input. It updates the size cache and notifies React without a synchronous native write. Geometry commits first; `_iosDeferredAdjustment` retains the offset correction. `observeElementOffset` later reports idle and `_flushIosDeferredIfReady` calls `_scrollToOffset` → `scrollWithAdjustments` → native `scrollTo`. This explains both the early geometry mismatch and the later reversal.

An instance-local, test-only native-write stack probe verified this caller on baseline `b733abbf89ba57c5f3d9d700bbb51973b657e07f`: the initial reproduction produced a +427px idle write and a 429px painted-anchor excursion. The write stack explicitly includes `_flushIosDeferredIfReady`; `internal-unknown` in the supplied JSON is not treated as caller proof by itself.

The app predicate in `src/shared/ui/measured-stream.tsx` correctly requests compensation for first measurements above the fold and cached rows wholly above it. Removing that predicate loses above-fold growth anchoring; it does not fix the ordering problem. `anchorTo: 'end'` retains key-based prepend anchoring and near-end behavior. No append occurs in the failing batches; `followOnAppend` is configured but is not the trigger. Browser anchoring is disabled by `overflow-anchor: none`. Row ResizeObserver delivery initiates the measurement, while the stable measurement ref and application target/Latest/width commands do not own the delayed write.

Previous fixes addressed app ownership, target cancellation and width invalidation. Their ordinary desktop/Pixel-UA browser coverage did not enter this iPhone-UA branch. The library describes iOS deferral as protection against native writes cancelling touch momentum: [TanStack's explanation](https://tanstack.com/blog/tanstack-virtual-perf-and-ios). The recording contains wheel input, so that touch-only rationale does not apply to its input sequence.

## Small change and ownership

`patches/@tanstack__virtual-core@3.17.11.patch` adds one internal boolean and one passive wheel listener to the existing input lifecycle. Both measurement compensation and pending prepend anchoring use the same condition. A wheel-only gesture uses the existing synchronous compensation path and React's existing synchronous notification. Geometry and its offset adjustment therefore commit together. Idle has no accumulated wheel correction left to flush.

Touchstart clears wheel mode. Active touch, the post-touchend grace interval, and already queued touch corrections cannot be taken over by wheel input. Idle and element cleanup clear wheel mode. Touch/momentum deferral otherwise remains as upstream implemented it. The patch includes published ESM/CJS runtimes, source and declarations; original source maps are not regenerated. Runtime stack function names remain attributable, but generated line mappings are not the authority for reviewing changed source.

`pnpm-workspace.yaml` registers the pinned patch and `pnpm-lock.yaml` records its hash. No package versions change. Remove/rebase the patch only with upstream evidence and these regressions passing.

Scroll ownership remains:

- User wheel/touch/keyboard input interrupts pending app target navigation. It is not overridden by background target retries.
- Explicit target, Home, Latest and width-anchor commands remain app-owned one-shot operations.
- Virtual exclusively owns size compensation, prepend key anchoring and configured near-end follow. Wheel compensation adjusts native offset only to preserve the same content position; it is not a navigation command.
- Realtime append follows only an intentional near-end reader; older-history readers retain their anchor and explicit Latest behavior.

There is no second compensator, new app state machine, row-ref churn, virtualization change, or dependency upgrade.

## Regression and cleanup

`virtual-wheel-compensation.test.ts` exercises real installed core: synchronous wheel measurement notifications, no idle re-write/no-op remeasurement, touch-only and both input transitions, wheel during queued momentum, and synchronous wheel prepend. Fake timers advance the actual 150ms touch grace interval; tests do not emulate the compensation algorithm.

Production and development `ios-wheel-scroll.spec.ts` share `wheel-compensation-browser.ts`. Real variable-height Timeline rows remain partially loaded (60); four up/down wheel cycles release held **real** row ResizeObserver entries at 375px. Every painted frame tracks the same DOM anchor through stable geometry and native idle beyond the library's 150ms reset. Assertions reject a delayed-flush caller, missing anchors, >8px visual movement, excessive writes, unexpected pagination, and an unvirtualized mounted range. This is geometry/input-state driven, not a sleep-only check. Write stacks are test attachments, not production instrumentation.

The opt-in development recorder is retained for physical-device verification because this supplied recording has no touch events. Production ignores its flag; listeners, sampling and instance wrappers attach only during explicit recording. No extra production diagnostic probes were added. Real Safari touch/momentum, elastic overscroll, trackpad behavior on iPad, IME and device timing still need manual checks. Re-run with diagnostics off when assessing timing/performance.

## Upgrade and patch verification

Keep the patch, patchedDependencies registration, and lockfile hash together. Before rebasing/removing it, inspect the installed core implementation and verify source, ESM/CJS runtime and declaration changes. Original source maps were not regenerated; review changed source rather than relying on generated line mappings.

Run the existing installed-core tests and production/development browser regressions after a frozen install and production build:

```sh
pnpm test src/shared/ui/virtual-wheel-compensation.test.ts src/shared/ui/measured-stream.test.tsx
pnpm build
pnpm test:e2e tests/e2e/ios-wheel-scroll.spec.ts tests/e2e/timeline-scroll-stability.spec.ts tests/e2e/stream-scroll-ownership.spec.ts tests/e2e/threads.spec.ts --workers=2 --retries=0
pnpm test:e2e:dev tests/dev-e2e/ios-wheel-scroll.spec.ts tests/dev-e2e/timeline-scroll.spec.ts
```

Also run the repository's complete checks before committing an upgrade. Verify wheel/touch transitions, pending touch corrections, prepend, first measurement, above/below-fold growth, targets, Latest, resize, Thread migration and 50k bounded DOM. Physical Safari touch/momentum and trackpad/keyboard checks remain manual; retain diagnostic evidence and do not infer full device correctness from an emulated UA.

## Original patch validation evidence

The final event-driven browser reproduction fails on clean baseline b733abb with one +427px deferred write and a **429px** same-anchor excursion. The patched production build passes in both device profiles with **0px** maximum excursion in all four cycles and no deferred-flush writes. The cycles issue 6, 3, 0 and 0 immediate compensation writes respectively, rather than repeating corrections while idle. The baseline unit run fails the two wheel-specific cases and passes all four touch/transition cases; the patched unit suite passes all six.

Formatting, ESLint, TypeScript, 394 unit/component tests and the production build pass. The broad local production suite records 275 passes and one context-sheet swipe dismissal failure; its unchanged isolated rerun passes in both profiles. No cause is established for that failure and no assertions, retries or timeouts were weakened. The new production regression also passes again in isolation in both profiles. Broad coverage includes initial opening, partial-history prepend, above/below-fold growth, touch input, rapid direction changes, idle, targets/Threads, realtime/history readers, Latest, keyboard, width/height changes and the 50,000-message bounded-DOM demo. The final delivery report records development-suite and exact-commit CI results separately.

These checks establish the recorded wheel correction fix; they are not an FPS benchmark or a claim of real WebKit/iPhone verification.

The full local development suite also passes: **32/32**, including effect replay, recorder lifecycle, both wheel profiles, Threads and 50,000-message stress checks.
