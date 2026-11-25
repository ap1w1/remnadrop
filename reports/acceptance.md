# Test-build acceptance

Implemented: per-user node limits, fixed-day/manual reset, zero/unlimited limits,
node access enforcement, durable quota counters and synchronization queue,
receipt deduplication, signed threshold/exhaustion/reset webhook outbox, traffic
template variables, device attribution with explicit probable/unknown status,
90-day metric history, selectable nodes/period, averaged charts, CSV, CPU agent,
threshold/recovery metric events, installation and rollback scripts.

Local checks include TypeScript compilation, unit checks and PostgreSQL integration
for concurrent receipts, quota exhaustion, preservation of unrelated membership,
resets, overlapping squads, per-node startup configurations, metric history,
percentage drops, alert transitions and CPU authorization. Upgrade checks cover
preserving unambiguous legacy quotas and retaining ambiguous quotas for review.
Original Metrics is unchanged; monitoring has separate view/settings pages and
global/per-node detector rules. The host picker includes node balance variables;
Torrent Blocker reports expose device attribution in a table column.
The Docker deployment runs separate API, processor and scheduler processes.

Remaining acceptance work on real infrastructure:

- Test active-connection termination and access restoration on each supported node version.
- Verify signed webhook delivery against the intended external receiver, including retries.
- Browser acceptance of editing users, quotas, graphs and Torrent Blocker reports.
  Local login and navigation menu were checked; the upstream license acceptance
  dialog prevented further browser checks without accepting terms for the user.
- Full installer and rollback rehearsal using the target server's Compose layout.
- Resolve dependency audit findings before production: current audit snapshots still
  contain high-severity dependency findings; several upgrades require contract or
  Prisma/Zod major-version changes and cannot be blindly applied to 2.8.1.
- Verify the bundled Xray editor validator and schemas in the browser.

IP attribution is not proof of device identity. Node access synchronization is
asynchronous, so small traffic overruns remain possible. CPU data requires the
separate agent; unavailable values are null. No mixed-version compatibility or
production-readiness claim is made by these local checks.
