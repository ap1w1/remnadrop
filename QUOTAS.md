# Per-user node quotas

Open a user and use “Лимиты по серверам”. Choose a node, enter the byte limit,
reset period in days and threshold percentage. Empty limit is unlimited; zero
denies access. An empty reset period means manual reset. Saving a quota is separate
from saving the main user form.

API: GET /api/users/{userUuid}/node-quotas, PUT /{nodeUuid}, POST /{nodeUuid}/reset.
PUT body: {"limitBytes":"85899345920","periodDays":30,"thresholdPercent":80}.
Existing admin authentication or users:* API scope is required. GET also returns
legacyNeedsReview for old squad quotas that could not be mapped unambiguously.

Counters belong to user UUID + node UUID, regardless of overlapping squads.
Usage is consumption-weighted as in upstream accounting. Global and node counters
commit atomically with a persistent queue receipt. Node access is removed on
exhaustion; squad memberships are never removed. Synchronization, individual and
bulk user updates, and node startup configurations respect node blocks. Resets
only restore access still permitted by normal user status and memberships.
Synchronization remains asynchronous, so a small traffic overrun is possible.
Periods apply at processing time, including traffic queued across a reset.

## Host variables

The host remark variable picker includes NODE_NAME, NODE_TRAFFIC_USED,
NODE_TRAFFIC_LEFT, NODE_TRAFFIC_LIMIT and NODE_TRAFFIC_PERCENT, each enclosed
in double braces. LOCATION_* variants are aliases for compatibility.
Select one node in the host's “Ноды” field for an unambiguous balance. If no node
is selected, an inbound mapped to exactly one node can resolve it automatically.
Ambiguous balances display “—”. Hosts associated with a blocked node are omitted;
for a shared host spanning several nodes, use separate hosts to retain independent
visibility. Server-side quota enforcement still applies to saved configurations.

## Upgrading from squad quotas

The new migration removes the old overlap restrictions and restores memberships
removed by old quotas. A squad quota is transferred automatically only when it
maps to exactly one node and no other quota for that user maps to that node.
Counters, limits and reset dates are preserved in that case. Ambiguous quotas are
archived in user_squad_quotas for manual allocation; they are not multiplied across
nodes. A warning in the user form lists quotas requiring review. No old data is
deleted. Use the same install.sh --update path as previous test builds.

## Webhooks

Set QUOTA_WEBHOOK_SECRET (at least 32 random characters) and separate HTTPS URLs:
QUOTA_WEBHOOK_LOCATION_TRAFFIC_THRESHOLD_URL,
QUOTA_WEBHOOK_LOCATION_TRAFFIC_EXHAUSTED_URL,
QUOTA_WEBHOOK_LOCATION_TRAFFIC_RESET_URL.
Event names are preserved; location.uuid now identifies the node.
Only public IPv4 HTTPS port 443 destinations are allowed; redirects are rejected.
Headers: X-Webhook-Event-Id, X-Webhook-Timestamp, X-Webhook-Signature.
Signature is sha256= + HMAC-SHA256(secret, timestamp + '.' + exact body), hex encoded.
Delivery is at least once with 20 attempts and exponential backoff; receivers must
deduplicate event UUIDs and verify signatures and timestamp freshness.
