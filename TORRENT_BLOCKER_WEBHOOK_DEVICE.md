# Torrent Blocker webhook: device attribution

The `torrent_blocker.report` webhook includes two additional fields inside `data`:

- `device`: a probable HWID device (fields: `hwid`, `platform`, `model`, `userAgent`) or `null`.
- `deviceIdentification`: `{status: 'probable' | 'unknown', method: 'ip', candidateCount: number}`.

Existing `data.report` fields and consumers remain compatible. The enriched `data.report.device` and `data.report.deviceIdentification` remain available as well.

Example (abbreviated):

```json
{
  "scope": "torrent_blocker",
  "event": "torrent_blocker.report",
  "timestamp": "2026-11-20T22:00:00.000Z",
  "data": {
    "node": {},
    "user": {},
    "device": {
      "hwid": "example-hwid",
      "platform": "android",
      "model": "example-model",
      "userAgent": "example-user-agent"
    },
    "deviceIdentification": {
      "status": "probable",
      "method": "ip",
      "candidateCount": 1
    },
    "report": {
      "device": {
        "hwid": "example-hwid",
        "platform": "android",
        "model": "example-model",
        "userAgent": "example-user-agent"
      },
      "deviceIdentification": {
        "status": "probable",
        "method": "ip",
        "candidateCount": 1
      },
      "actionReport": {},
      "xrayReport": {}
    }
  }
}
```

**Important:** This is **not a reliable attribution of torrent traffic to a specific physical device**. The existing processor matches the blocked IP against registered HWID subscription request IPs within a 24-hour time window. If no unique match exists (including shared NATs, proxies, or stale request IP records), `device` is `null` and `status` is `unknown`. A unique IP match is marked `probable`, not `confirmed`.

Webhooks contain potentially identifying HWID data; use HTTPS and verify the Remnawave webhook signature at the receiver. Do not log HWIDs to public logs.

## Deploy

This patch changes the panel's backend and local contracts; it does **not** require a Prisma migration. The running Docker image still requires rebuilding from the new Git commit. Use the existing guarded update process and a staging rehearsal. Do not restart the earlier 2.8.1 image against an already migrated database.
