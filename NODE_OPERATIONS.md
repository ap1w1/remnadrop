# RemnaDrop — nodes, DPI Checker and automations

This changeset adds node operations to the Remnawave 2.8.1 development fork. It is a DEVELOPMENT build and has not been exercised against a live PostgreSQL database, Xray node, or a paid DPI Checker account.

## Navigation and UX

- Desktop and mobile: **Nodes** → **Monitoring** (View / Settings), **DPI Checker**, **Automations**.
- Edit Node → **IP Management** tab shows the pool and manual TCP probes. Rotation modifies the **hosts' client-facing address only**, not the management connection address or Xray node listening IP.
- DPI Checker: API key settings, current balance, region/optimal PoPs/custom PoPs, host selection, cost estimate/confirmation, live progress, recent jobs, result rows.
- User → node quotas: choose each node, set limit in GiB/MiB/bytes, reset period, alert threshold, view progress and reset one node without resetting the rest.
- Monitoring: separate view and settings, common and per-node detector rules.

## Database and secrets

Run the existing supported install/migration procedure against a **backup copy** of your 2.8.1 database first. New migrations:
- `20261120180000_dpi_ip_automations` (already supplied in fork archive)
- `20261120181000_dpi_credentials` (new encrypted key table)

DPI Checker key is sent via `PUT /api/dpi-checker/settings` (admins only), verified by `/profile`, then encrypted with AES-256-GCM before storage. The plaintext token is never returned to the client or stored in job rows. It is held only in process memory during API requests. Use a stable `DPICHECKER_ENCRYPTION_KEY` environment variable containing at least 32 random characters; as a backwards-compatible fallback the system uses `APP_SECRET` / `JWT_AUTH_SECRET`. Rotating this key without migrating the ciphertext renders the saved DPI token unreadable. To avoid key loss, set and back up `DPICHECKER_ENCRYPTION_KEY` securely and independently.

`DPICHECKER_API_KEY` can still be set as an environment variable if no key is saved through the panel. The panel never displays or exposes the stored token. The status endpoint returns only configured/source/timestamp; profile returns the balance. For mobile Russia checks the provider requires paid API eligibility; see the provider API documentation.

For automation webhooks also set `AUTOMATIONS_WEBHOOK_SECRET` (min 32 chars). Destination must be public HTTPS port 443; `postSignedWebhook` signs payloads and rejects private DNS resolutions.

## Endpoints

All routes below have the existing `/api` prefix and require panel authentication/appropriate node scope. Secret writes additionally require ADMIN:

- `GET /dpi-checker/settings`: { configured, source, updatedAt } (no credential)
- `PUT /dpi-checker/settings`: `{ "apiKey": "..." }`; validates key remotely, stores encrypted
- `DELETE /dpi-checker/settings`: deletes panel credential (falls back to environment if set)
- `GET /dpi-checker/profile`: returns `balance` and `currency: USD`
- `GET /dpi-checker/pops?location=russia[&optimal=true]`
- `GET /dpi-checker/checks`, `GET /dpi-checker/checks/:id`
- `POST /dpi-checker/checks/prepare`: `{ "hosts":["host-uuid"], "location":"russia" }` (optional `pop_ids`); creates expiring test identity, computes paid estimate
- `POST /dpi-checker/checks/:id/start`: rechecks estimate then submits paid job with idempotency key
- `DELETE /dpi-checker/checks/:id`: cancel prepared or still-pending check
- `GET /nodes/:uuid/ip-pool`, `POST /nodes/:uuid/ip-pool` (`ip`, optional `rotationMinutes`)
- `POST /nodes/:uuid/ip-pool/probe` (`ip`), `POST /nodes/:uuid/ip-pool/:id/rotate`, `DELETE /nodes/:uuid/ip-pool/:id`
- `GET /node-automations`, `GET /node-automations/executions`, `POST /node-automations`, `PUT /node-automations/:id`, `DELETE /node-automations/:id`
- Existing node quota APIs: `GET /users/:userUuid/node-quotas`, `PUT /users/:userUuid/node-quotas/:nodeUuid`, `POST /users/:userUuid/node-quotas/:nodeUuid/reset`.

## Design and operational safeguards

DPI Checker uses temporary Remnawave VLESS credentials and never writes URIs to check history; terminal jobs trigger account removal. Scheduler polls every 20 seconds. UI polls every 15 seconds; actual progress originates from provider response. Manual paid checks require cost preview confirmation. Automations intentionally issue paid checks as an action selected by the administrator; automatic DPI runs enforce a server-side `DPICHECKER_AUTOMATION_MAX_COST_USD` cap (default USD 1 per run), revalidated at execution; total account budgets are not implemented.

All IPs added to the pool must be public IPv4. A node IP probe currently tests whether a TCP connection to any configured host port succeeds; **it does not prove VLESS protocol authentication, identity or DPI accessibility**. A real VLESS check is essential before production autonomous IP rotation. For first activation the IP must already be used by an associated host. Rotation refuses to rewrite a host shared by multiple nodes. Existing domains are not changed, and changing hosts' address in the panel does not allocate/route/announce an IP on your VPS network interface — provisioning the IP is the operator's responsibility.

Automation rule monitors an explicit drop in online users using recent node metric samples; it waits `duration_minutes` with a cooldown. Missing metrics are not interpreted as a drop. Actions include DPI check, hide selected node-specific hosts, signed webhook, and IP rotation. No cascading (DPI verdict-based) branching or rollback on partial failure is implemented.

## Verification and limitations

- `node check-syntax.cjs` checks TypeScript/TSX source parses without syntax diagnostics.
- Full `npm ci`/`tsc`/Nest build did not finish in the execution environment because dependency installation timed out. It is **NOT VERIFIED** that the changed project compiles or that migrations execute successfully.
- Before release: compile on Node 24 per upstream fork README; test migrations on a restored copy of production DB, verify credentials across restarts, use sandbox test account, confirm quota enforcement with concurrent nodes, fail/recover automation and IP failover on disposable nodes, test active subscriptions, and security-review automatic paid actions.
