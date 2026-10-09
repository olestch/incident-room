# UX Remediation Phase 3.1 — Timeline scroll stability and MSW investigation

## Confirmed defect and limits of attribution

Ordinary short and extended genuine touch passes were observed at 320, 375, 390 and 430px, with a 1280px desktop control. They did not reproduce a spontaneous post-stop drift. Raw offset adjustments during first measurements/prepend were also observed with unchanged visual row offsets; these are legitimate compensation, not evidence of a defect.

A deterministic delayed-ResizeObserver case does reproduce a visual jump in partially measured history. At 375px, scrolling an unmeasured block into view leaves evt-3957 partially above the fold. Its first border-box measurement replaces the 130px estimate with 210px. The old consumer predicate only compensates rows whose estimated **end** is above the fold. It therefore skips this 80px delta while compensating other entirely hidden rows. The next visible reading anchor evt-3958 moves from 42px to 122px relative to the viewport. Both desktop/mobile Chromium regression cases fail with exactly 80px drift using the old predicate.

This is a confirmed first-measurement anchoring defect. It is a supported explanation for reverse visual motion as unmeasured rows appear, but the original manual sequence was not independently reproduced without controlled observer delivery. Other claimed causes (stale deep links, browser anchoring, width restoration, pagination replay, iOS momentum) are not established root causes.

## Scroll ownership map

| Source                                               | Operation / ownership                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared MeasuredStream virtualizer                    | Scroll container .timeline-viewport; 130px estimate, stable keys, overscan 6, end anchoring, follow append only near end and outside an active URL target                  |
| Virtualizer first/repeated row measurement           | measureElement refs and bounded row ResizeObserver; resizeItem → compensation predicate → applyScrollAdjustment → scrollToFn                                               |
| Earlier page / gap / bounded target-window insertion | Query cursor/window response → memoized StreamProjection chronological rows → Virtualizer.setOptions anchor resolution → _willUpdate browser offset sync                   |
| Initial loaded stream                                | Layout effect, once initialized and not target-active → scrollToEnd                                                                                                        |
| TargetNavigation                                     | Abortable locate → bounded Query window → reveal; pending settle calls scrollToIndex(center) on mount/layout/RO/scroll until visible, then clears pending task             |
| Explicit latest                                      | Imperative latest / Jump to latest / New updates / viewport End → scrollToEnd; Home → scrollToIndex(0,start)                                                               |
| Width change                                         | Container RO records row key and intra-row offset, clears size cache with measure, then layout effect restores offset once; height-only change does not globally remeasure |
| Realtime / optimistic acknowledgement                | Query revisions and stable optimistic aliases change the projection; Virtualizer append/anchor policy owns resulting geometry                                              |
| Framework / browser                                  | URL pushes use scroll:false in room navigation; background focus restoration uses preventScroll; no extra scroll state manager                                             |

The stream uses overflow:auto and overflow-anchor:none. Room flex sizing/min-height:0 and visualViewport CSS variables constrain its height; composer and context sheet do not become Timeline scroll owners. No smooth scrolling is configured. Actual browser-native anchoring is disabled for this virtual list.

Timeline and Thread share MeasuredStream and messaging projection/navigation contracts. No Thread presentation, toolbar, preview, CSS, gesture or domain ordering changes.

## Correction

The custom predicate now distinguishes the first estimate-to-measured transition via itemSizeCache. First measurements compensate a row whose start is above the fold, including a partially visible row. Subsequent measurements compensate only rows fully above it, retaining the established protection for readers inside a growing row and historical backward scrolling. The predicate uses the virtualizer's effective offset including its pending adjustment accumulator.

TanStack remains the sole prepend/measurement anchoring owner. No additional restore loop, timer, global measure pass or programmatic-scroll suppression was introduced. Pending navigation cancellation, one-time initialization, follow/latest thresholds, authority pagination, realtime deduplication and optimistic keys are unchanged. No dependency or generated MSW worker change.

## MSW evidence

Temporary browser/worker instrumentation was external to the repository. It recorded request URL/method, CDP initiator/type, requestfailed, worker fetch rejection (rethrowing, never suppressing it) and unhandledrejection during login, navigation, reload, target/latest and history return in dev localhost:3202 and production 127.0.0.1:3100.

Both sessions had cancelled GETs, such as /mock-api/realtime/open, /mock-api/realtime/stream?after=6&client=..., /mock-api/notifications/unread, incident reads and Thread summaries. These use mocked authority handlers; route/session disposal and development effect replay abort their signals. Production also cancelled Next RSC prefetch GET /app/incidents/INC-2872?_rsc=sOmig2fYVKovCf4E when navigating from the list. These are framework requests, passed through rather than mocked.

Captured worker passthrough fetches included dev GET /app/incidents/INC-2841?_rsc=2JwxCePljZ-6W_oq and production RSC/static chunk requests. No intercepted worker fetch rejected, no worker unhandled rejection and no page error occurred. The generated worker's passthrough directly returns fetch(requestClone,{headers}); a failed network fetch there can generate the supplied stack, but the stack alone does not identify a request.

The dev server also logged 404 GETs for /mock-api/incidents/INC-2841/threads/summaries?root=fictional-incident-2841%3Aevt-3941 (and neighbouring roots) during document navigation. Abandoned requests can reach the generated worker's inactive/missing-client passthrough branches; the captured evidence does not identify which branch served these requests. A 404 response alone is not a rejected fetch, and no failed user-visible flow or worker rejection accompanied this observation. Active unmatched /mock-api/ requests still throw under the existing onUnhandledRequest policy.

The original mockServiceWorker.js:250 Failed to fetch was **not reproduced or conclusively attributed**. Its URL, method, initiator and failure circumstance remain unknown. Observed ERR_ABORTED requests do not prove that original rejection was an expected cancellation; server shutdown/HMR/network failure remain hypotheses. Ordinary tested navigation and reload continued to work. MSW was not disabled, patched, given blanket suppression or arbitrary retries.

## Regression coverage and performance

New production browser cases cover all five widths, deliberately deferred real border-box measurements, visual anchor offsets, actual mobile touch/desktop wheel scrolling, settled post-stop geometry, rapid same-turn repeated pagination clicks coalescing to one 60-entry page, viewport-height changes, deep-link/latest after pagination, bounded mounted rows, and later growth below the fold. New dev cases repeat the causal measurement/pagination regression under Strict Mode. Observer gating is test-only; settling requires consecutive unchanged geometry frames with a bounded deadline, not fixed sleep.

Existing full tests remain enabled for above-anchor growth, realtime old-reader anchoring/New updates, optimistic reconciliation/failure, navigation supersession and missing/deleted targets, Thread pagination and navigation, 10k/50k deep links, bounded DOM and mobile context sheet behavior. No workers/retries/assertions are weakened. Current text fixtures have no asynchronously loaded content images; controlled real content growth covers late layout changes.

Temporary instrumentation is not shipped. Local/CI results and any unrelated flakes are recorded in the completion report.
