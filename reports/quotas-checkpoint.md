# Quotas and webhook development checkpoint

Implemented in source:
- Persistent per-user/per-squad counters with PostgreSQL transactions and job receipt deduplication.
- Quota CRUD subset: list, configure and reset through authenticated API; editor UI for existing users.
- Squad removal at limit, restoration on reset, fixed-day periods, durable node synchronization requests.
- Database guard against re-adding a quota-blocked membership.
- Five LOCATION_* host tokens for unambiguous inbound/squad mappings.
- Threshold/exhaustion/reset event persistence and signed HTTPS webhook delivery with leases and retries.
- Two additive SQL migrations after the original 112 migrations.

Verified:
- Backend build and frontend TypeScript check pass.
- 19 unit tests pass.
- All 114 migrations applied to a fresh disposable PostgreSQL database.
- PostgreSQL integration: concurrent duplicate event, exact exhaustion, other squad preservation,
  blocked membership guard, reset, zero/unlimited limits, overlapping node rejection and event counts.
- API starts with new module and compatible Swagger; anonymous quota request returns HTTP 401.

Not yet verified: end-to-end node synchronization, active connection termination, webhook receiver
integration, browser UI, migration script end-to-end against an existing deployed 2.8.1 instance.
The smoke container used mounted current compiled output and the compatible Swagger directory;
this was not a validation of a newly rebuilt final Docker image.

Remaining TЗ work includes quota configuration during user creation, monthly calendar periods,
UI webhook destination settings, monitoring, device attribution, compatibility matrix and release QA.
The source archive previously given to the user does NOT include these changes yet.
