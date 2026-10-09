# UX Remediation Phase 3 — Dialogs and Notifications

## Initial audit

Five application-level native confirmations were found. No blocking alert/prompt calls occur in product code; alert strings in security tests and authority methods called confirm are not browser dialogs.

| Flow                                                    | Classification                          | Replacement                                                                                 |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Close Create Incident, including ambiguous submission   | Unsaved protection / navigation warning | Keep editing; discard draft, or close and check the list when submission outcome is unknown |
| Reload latest Postmortem / Action Item revision         | Unsaved protection                      | Keep editing; replace fields while retaining a local reference copy until leaving           |
| Leave Postmortem via links, palette, Create or Sign out | Unsaved protection                      | Keep editing; explicitly discard local fields                                               |
| Replace showcase dataset                                | Destructive maintenance                 | Named consequences, Cancel / Replace dataset                                                |
| Reset Demo data                                         | Destructive maintenance                 | Named consequences, Cancel / Reset Demo data                                                |

Browser-controlled beforeunload remains native. Create Incident also warns on meaningful drafts, ambiguous or pending submissions. Blank-only new drafts do not require a decision. Postmortem/Action Item dirty or pending saves retain unload protection. Refresh/tab close cannot use a React confirmation.

## Shared confirmation and navigation

The independent shared native dialog has an accessible name/description, safe initial focus, explicit Tab wrapping, native inert background and focus restoration. Escape/backdrop cancel without destructive work; while maintenance is pending, both are blocked and actions are disabled. Maintenance failure remains in the dialog with actionable details. No additional modal framework, toast framework, dependencies or decorative animation.

Existing Postmortem document click capture remains scoped to the mounted review; only real departures with unsaved work are deferred. Same-document skip/hash links and modified/new-tab links keep their behavior. Commands/Create/Sign out await the same local decision. Confirmation never calls save implicitly. Pending saves are not called successful or cancelled by leaving.

Limitation: App Router same-document browser Back/Forward and arbitrary programmatic navigation outside the existing local guard are not safely intercepted. No popstate history trap or global router interception was added. Browser beforeunload remains responsible for document unloads; browsers control whether and how its warning is displayed.

## Notification authority discovered

IndexedDB authority owns recipient-scoped records and readAt, per-record revisions, per-user unread revision and source/recipient receipts. Active eligible users receive assignments, mentions, lifecycle/severity updates and contextual replies; the actor is excluded. Thread mentions/replies sharing a source are deduplicated under existing receipt rules. Postmortem initiation/Action Item assignment are supported through their current ingestion.

TanStack Query keeps identity-scoped confirmed resources. Lower/duplicate record and unread revisions cannot replace newer state. Journal delivery publishes authoritative changes; existing snapshot/resync recovers missed delivery. Identity teardown clears client resources, not the other user's persistent inbox.

Opening an ordinary notification first attempts mark-read, then follows its validated exact URL. A failed mutation does not change unread state or claim success; navigation remains available with error details carried into the shell. Modified/new-tab link activation does not run this mark-read handler. If a destination later proves unavailable, the successfully saved read state remains saved: router.push has no authoritative destination-completion acknowledgement. Opening the inbox never bulk-marks it read. Bulk read is disabled with a confirmed zero or unavailable count.

## Deterministic baseline

Six fixed-ID examples use real existing fictional content:

- Sage: unread assignment (evt-6), severity change (evt-5), Thread reply (root evt-42 / reply-42-1), plus read status change (evt-4).
- River: unread Thread reply (root evt-42 / reply-42-2), plus read recent reply (root evt-4000 / reply-4000-4).

These use different timestamps and exact Timeline/Thread evidence. Actors and recipients are distinct and match current participation/recipient rules. Existing accepted Timeline and Thread content remains unchanged.

A browser-authority transaction performs the fixture upgrade once. It appends missing examples, preserves legitimate rows/read states and existing source receipts, advances unread revisions and places inserted changes in the existing journal publication queue. Reload does not reseed; another workspace remains empty. Demo reset clears the same existing stores and reproduces the baseline on the next authority read. Stress dataset replacement may invalidate old discussion evidence, just as it can invalidate user-generated activity; it does not overwrite inbox history.

## Validation scope

Component/integration tests cover decisions, pending/error states, safe focus, meaningful drafts, revision replacement, source receipts, deterministic IDs, recipient isolation, real targets, read/unread/bulk persistence, failure and reset. Browser tests cover all seeded destinations, account switching/reload, all seven requested widths, keyboard trapping/restoration, background inertness, Escape/backdrop, reduced-motion/forced-colors and existing conflict/maintenance journeys. Existing duplicate/out-of-order delivery, reconnect/resync and mobile bottom-sheet regression checks remain enabled.

No screenshots are generated. Exact validation results and corrective delivery are reported in the completion message.
