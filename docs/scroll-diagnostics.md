# Temporary Timeline scroll diagnostics

This opt-in tool collects geometry evidence; it does not fix the unresolved mobile backward movement. Production ignores the flag.

## Record and export

1. Run `pnpm dev` and sign in using the fictional demo account.
2. Open `/app/incidents/INC-2841?scrollDebug=1` (append `&scrollDebug=1` when other query parameters exist).
3. Expand **Scroll debug**, choose **Start recording**, then collapse the controls while reading.
4. Reproduce with native touch scrolling. Include stopping the gesture, waiting briefly, and loading another history page. Touch end is not treated as momentum end.
5. Expand the panel and choose **Stop recording**. Use **Copy log** or **Download JSON**. The filename is `incident-room-scroll-debug.json`.
6. Share the JSON for analysis. **Clear** discards the current buffer. Start after Stop resumes the same session; clearing resets its time origin.

The fixed panel is portalled outside Timeline/Thread, inside the visible stream's screen bounds, above the composer and below navigation. It does not resize the list. On short viewports its controls scroll within those bounds. It remains available when the mobile Timeline is inert behind Thread.

## Evidence and ownership

A Room-scoped in-memory recorder combines Timeline and Thread with surface labels. It is explicitly gated by `NODE_ENV=development` and the exact query value `1`. No network/storage upload, message bodies, drafts, auth state, URLs, query values, error messages or event target text are collected. Stable row keys are pseudonymized with two salted 32-bit hashes; they can be correlated within the session, not reversed into account IDs. Hash collisions are theoretically possible.

The buffer retains the newest 7,500 events using a constant-time ring, exporting chronological sequence numbers and exact total/retained/dropped counts. Export includes schema/session IDs, monotonic and recording-relative times, start wall time, browser agent, viewport and DPR. Optional `NEXT_PUBLIC_APP_COMMIT_SHA` supplies the commit at dev-server start/build; absent values export as null. The log does not include the current URL.

Events cover native scroll/scrollend, approximate touch direction/distance/start/end/cancel, wheel, pointer kind, viewport scrolling keys, row measurement size changes, container ResizeObserver deliveries, total-size/row-count changes, Query pagination fetching/loading/completion/pages and acquired-window count, pending reveal, URL-target presence, actual navigation activity, configured auto-follow, existing near-end/initial-position/resize-anchor refs. Application commands identify target navigation, cancellation, initial positioning, Latest, Home, width measurement handoff/invalidation and anchor restoration.

While recording, an instance-local `scrollTo` wrapper delegates the original native method exactly once with its original receiver and arguments. It observes Virtual's native writes without modifying Virtual options or globally patching browser APIs. The original descriptor is restored on Stop/unmount; a non-configurable method produces a `probe-unavailable` event. The public Virtual `resizeItem` method is similarly observed and restored, so its ResizeObserver measurement path is visible without extra row observers or changed sizes. First measurement's old size is null because no cached actual measurement exists.

Internal compensation/prepend/follow/reconciliation writes are labelled `internal-unknown` unless inside a known synchronous application command. Nearby measurements, adjustments and state provide correlation, not invented causal attribution. Browser anchoring or scrollTop assignments outside the instrumented path appear as geometry/scroll observations without a matching command. There is no global scrollBy probe: current stream code has no such application calls.

## Geometry and signals

Frames sample during input/Virtual scrolling and for 1.5 seconds after triggers; idle geometry polling every 250ms also notices later changes. Meaningfully changed samples contain native scrollTop/scrollHeight/client dimensions/bounds/bottom distance, Virtual offset/adjustments/direction/scrolling, committed total size and visible items' index/key/start/end/size. A mounted upper visible row remains the anchor until it leaves view; its relative DOM top/bottom, height and inline transform distinguish scroll movement from content repositioning. Replacement anchors never generate a same-row jump.

Conservative configurable recorder thresholds annotate scroll reversal (6px), same-anchor jump (8px), movement with stable scrollTop (within 1px), and movement at least 120ms after the last completed input. Signals are debounced per surface/type for 300ms, marked diagnostic-only and retain surrounding buffered events. Momentum scrolling and legitimate compensation can produce signals. These annotations are not proof of a defect. The export's anomalies array contains retained annotations; dropped events are explicitly counted.

## Performance and limits

No Timeline React state changes occur per event/frame. Only the isolated panel refreshes at 500ms and control actions. Observers/listeners/frame/idle work and method probes attach only while recording; they detach on Stop, disabling the query, and unmount. The sampler reads only the mounted range and committed virtual-item snapshot/list height, never all history, Virtual scroll commands, forced row measurements or a second behavioral state machine.

`getBoundingClientRect`, scroll/client dimensions and geometry comparison may trigger synchronous layout reads. These are necessary to distinguish visual motion from native scroll motion, but recording can influence frame timing; repeat with recording off when assessing performance. There is no zero-overhead/FPS claim. Idle polling can miss a transient excursion shorter than 250ms outside a settling window; browser frames may coalesce subframe writes. Committed virtual geometry can lag a measurement until React commits, intentionally exposing that ordering. Ancillary layout shifts are inferred from bounds, not collected via a global PerformanceObserver. Background-tab rAF throttling, real-device momentum/IME behavior and clipboard policies require manual testing. Copy falls back to local text selection on browsers without Clipboard API; Download is independent of clipboard permissions.

The original mobile defect remains unresolved. Collect a real reproduction before proposing any remediation. Remove the provider, debug props/command probes, and the two scroll diagnostic modules/tests when the investigation is complete.
