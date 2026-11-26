## Общая политика подписки (новый режим)

Все ограничения относятся к **user UUID**, а не к скваду. Один пользователь может
быть сразу в нескольких сквадах — ноды при этом учитываются единожды.

Квоты нод и групп учитывают **фактические байты загрузки и отдачи**. Множитель
потребления ноды влияет только на общий счётчик подписки: например, при множителе
`0` общий лимит не расходуется, но квота группы списывает весь переданный трафик.
Порог `USER_USAGE_IGNORE_BELOW_BYTES` также не отбрасывает трафик из квоты группы.
Повторная обработка одного задания не начисляет расход второй раз.

Новая группа начинает учёт с нуля. Изменение её названия или лимита сохраняет
расход существующих участников; добавленная нода начинает отсчёт с нуля.
После обновления старые заниженные значения автоматически не пересчитываются:
история трафика не содержит точной границы создания и ручных сбросов группы.

- **Общее для подписки:** период сброса и процент предупреждения.
- **Отдельно для каждой ноды:** лимит байт, потребление и состояние блокировки.
- После достижения лимита ограничивается **только эта нода**. Смена сквада не должна
  обходить ограничение; синхронизация доступа с Remnawave Node асинхронна.
- При наступлении общего срока **все ноды пользователя** сбрасываются в одной
  транзакции. Нулевой лимит остаётся запрещённым после сброса.
- Существующие записи без общей политики остаются в `legacy`-режиме, без
  неявного изменения их дат и счётчиков. Сохранение общей политики включает новый
  режим, сохраняя израсходованный трафик.

### API (существующие права ADMIN или users:*)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/users/{userUuid}/node-quotas` | Текущие лимиты и `legacyNeedsReview` |
| GET | `/api/users/{userUuid}/node-quotas/status` | Счётчики, остаток, blocked, ожидающая синхронизация |
| GET | `/api/users/{userUuid}/node-quotas/settings` | Общая политика: shared/legacy, период, дата сброса, порог |
| PUT | `/api/users/{userUuid}/node-quotas/settings` | Установить общий период и порог |
| PUT | `/api/users/{userUuid}/node-quotas/{nodeUuid}` | Создать или изменить индивидуальный лимит |
| POST | `/api/users/{userUuid}/node-quotas/reset-all` | Сбросить потребление на всех нодах подписки |
| POST | `/api/users/{userUuid}/node-quotas/{nodeUuid}/reset` | Ручной сброс **только указанной ноды** в любом режиме; общий период подписки не меняется |
| DELETE | `/api/users/{userUuid}/node-quotas/{nodeUuid}` | Удаление индивидуального лимита ноды и постановка синхронизации доступа в очередь |

**Примеры тел запросов:**

```json
{"periodDays":30,"thresholdPercent":80}
```

```json
{"limitBytes":"85899345920","periodDays":null}
```

`limitBytes:null` — безлимит. `limitBytes:"0"` — запрет доступа.
`periodDays:null` у общей политики — только ручной общий сброс.
Сохранение индивидуального лимита **не сбрасывает** уже использованный трафик.

При достижении порога или блокировки ноды генерируются
`node_quota.threshold` / `node_quota.exhausted`, а при общем
сбросе — `node_quota.reset` для каждой ноды. Вебхуки содержат идентификатор
пользователя и ноды; получателю следует проверять подпись и дедуплицировать события.

**Совместимость:** новая миграция `20261121010000_shared_node_quota_preferences`
только создаёт таблицу общей политики. Ранее созданные лимиты сквадов и нод
автоматически не удаляются. Проверка обновления должна включать восстановление
дампа в отдельную тестовую базу и проверку выдачи подписки при превышении лимита.

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
When no limit is configured for the resolved node or group, traffic variables
(N_USED, N_LEFT, N_LIMIT, N_PCT and their NODE_/LOCATION_ aliases) expand to
an empty string. NODE_NAME and N_NAME still show the node name. Hosts associated
with a blocked node are omitted; for a shared host spanning several nodes, use
separate hosts to retain independent
visibility. Server-side quota enforcement still applies to saved configurations.
`N_LIMIT` rounds the displayed size to a whole unit (for example, `10 GiB`);
`NODE_TRAFFIC_LIMIT` and `LOCATION_TRAFFIC_LIMIT` retain their existing precision.

## Upgrading from squad quotas

The new migration removes the old overlap restrictions and restores memberships
removed by old quotas. A squad quota is transferred automatically only when it
maps to exactly one node and no other quota for that user maps to that node.
Counters, limits and reset dates are preserved in that case. Ambiguous quotas are
archived in user_squad_quotas for manual allocation; they are not multiplied across
nodes. A warning in the user form lists quotas requiring review. No old data is
deleted. Use the same install.sh --update path as previous test builds.

## Webhooks

Use the standard Remnawave `WEBHOOK_ENABLED`, `WEBHOOK_URL` and
`WEBHOOK_SECRET_HEADER` settings. Fork events use the same webhook queue and
`X-Remnawave-Signature` / `X-Remnawave-Timestamp` headers as built-in events.
The JSON body uses `id`, `scope`, `event`, `timestamp`, `data` and
`meta.legacyEvent`. The public event names are `node_quota.threshold`,
`node_quota.exhausted`, and `node_quota.reset`. Legacy `QUOTA_WEBHOOK_*`
variables are no longer used. Receivers matching old `LOCATION_TRAFFIC_*`
names must update their filters; the old name is in `meta.legacyEvent`.
`data.location.uuid` identifies the node.
Delivery uses the standard Remnawave queue; receivers must
deduplicate event UUIDs and verify signatures and timestamp freshness.
