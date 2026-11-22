# Limiter 5.1.0 + Cloudflare DNS в RemnaDrop 2.8.1

> Статус: **черновой PR**, на рабочую панель не устанавливать до успешной сборки и интеграционных испытаний на клоне PostgreSQL.

## Почему 5.1.0 и что адаптировано

Remnawave Limiter **5.1.0** (релиз 2026-11-20, upstream commit `b422f430de562d1fe48b417e0431b934f53495be`) работает с API Remnawave 3.x, а RemnaDrop сохраняет API 2.8.1.

Не нужно возвращаться к устаревшему Limiter 3.0.0 или переписывать все его функции. В каталоге `integrations/limiter-5.1` используется **оригинальный Go-бинарник версии 5.1.0**, без изменений. Встроенный в backend API-адаптер `/api/limiter-bridge` транслирует запросы нового клиента к ресурсам RemnaDrop 2.8.1:

| API Limiter 5.1.0 | Источник данных RemnaDrop 2.8.1 |
|---|---|
| `GET /api/nodes` | БД `nodes` |
| `POST /api/connections/by-node/:uuid` и `GET /api/connections/by-node/:jobId` | `NodesQueuesService.queryUsersIpsList` / `getUsersIpsListResult` |
| `GET /api/users/:numericId` | `users.t_id`, `internal_squad_members` |
| `POST /api/users/:numericId/actions/disable|enable` | `UsersService.disableUser / enableUser` через UUID |
| `POST /api/connections/drop` | `NodesQueuesService.dropUsersConnections` на подключённых нодах |
| `GET /api/hwid/devices` и `GET /api/hwid/devices/:numericId` | `hwid_user_devices` с фильтрацией по HWID |
| `GET /api/users/:numericId/subscription-request-history` | `user_subscription_request_history` |
| `POST /api/bandwidth-stats/nodes/usage` | `nodes_user_usage_history` по дате, ноде, пользователю |

В результате сохраняется логика исходного 5.1.0: группировка IP/подсетей/ASN, предупреждения, временные блокировки и автовосстановление, Telegram rich-уведомления с кнопками, статистика, обнаружение трафиковых аномалий и повторных пробных подписок по общему HWID.

**Вкладка «Инструменты → Limiter»** меняет штатные параметры upstream. Отдельный `supervisor.py` опрашивает `GET /api/limiter-bridge/runtime` каждые 30 секунд, перезапускает Go-процесс при изменениях, сохраняет Redis-данные в томе. Пока `enabled=false`, Go-процесс не запускается. При пропадании панели более чем на 60 секунд процесс останавливается (fail-closed). Никакого `docker.sock` и privileged-контейнеров не требуется.

Секретные настройки Telegram и MaxMind вносятся на этой же странице; AES-256-GCM с постоянным `REMNADROP_LIMITER_ENCRYPTION_KEY`, 32+ символа. Секреты **не возвращаются браузеру**. Если в БД они не настроены, допускается заполнить переменные в `.env.limiter` на сервере.

### Как подключить отдельный Limiter после прохождения тестов

1. Получить изменения из PR и обновить **тестовую**, а не производственную панель. Убедиться, что миграция создала таблицы `limiter_settings`, `limiter_credentials`, `limiter_events`.
2. В среде панели задать постоянные `REMNADROP_LIMITER_BRIDGE_TOKEN` и `REMNADROP_LIMITER_WEBHOOK_SECRET` (каждый 32+ символа). **Те же значения** прописать в `integrations/limiter-5.1/.env.limiter`. Секреты генерируются отдельно:
   ```bash
   openssl rand -hex 32
   openssl rand -hex 32
   openssl rand -hex 32
   ```
3. Задать `REMNADROP_LIMITER_ENCRYPTION_KEY` в панели (третий секрет, при необходимости) и сохранить Telegram Bot Token / Chat ID / Admin IDs через UI. Можно также указать MaxMind ключ и UUID сквадов.
4. Убедиться, что панель подключена к Docker-сети `remnawave-network`, hostname `remnawave` доступен внутри сети на порту 3000, и настройки не раскрыты через внешние endpoints.
5. Из корня репозитория (сборка Dockerfile использует контекст корня):
   ```bash
   cd /opt/remnadrop-git
   cp integrations/limiter-5.1/.env.limiter.example integrations/limiter-5.1/.env.limiter
   chmod 600 integrations/limiter-5.1/.env.limiter
   # отредактировать .env.limiter и поместить в безопасное хранилище
   docker compose -f integrations/limiter-5.1/docker-compose.yml up -d --build
   ```
6. Проверить логи `docker logs --tail 100 remnadrop-limiter`, затем в UI включить Limiter **в ручном режиме**. Telegram-уведомления проверить на тестовых подписках. Только после проверки решать об автоматических блокировках.

**Важно:** команда `remnadrop update` не запускает отдельный Compose для Limiter. Запуск указан отдельно, чтобы установка обновления панели не создавала новый сервис с произвольными настройками. На VPS должно быть достаточно свободного места для образов и резервного копирования.

### API и вебхуки Limiter

- `GET/PUT /api/limiter/settings` — параметры, `GET /api/limiter/events` — события нарушения лимитов.
- `GET/PUT/DELETE /api/limiter/credentials` — статус и сохранение/сброс зашифрованных Telegram/MaxMind секретов.
- `POST /api/limiter/ignore/:uuid`, `POST /api/limiter/unignore/:uuid` — исключения.
- Внутренний `/api/limiter-bridge/*` принимает только Bearer `REMNADROP_LIMITER_BRIDGE_TOKEN`, который никогда не должен быть опубликован.
- Исходный Go Limiter посылает событие в `POST /api/limiter-webhook`. Подпись `X-Signature-V2` = HMAC-SHA256(secret, `X-Timestamp + '.' + rawJSONBody`), срок 5 минут. Повторная доставка того же сообщения не дублирует запись. События о превышении сохраняются в PostgreSQL, а Telegram Rich-события трафика и HWID идут напрямую через upstream-бота.

### Проверки адаптера 5.1.0 на тестовом окружении

- Все описанные API-операции на тестовой БД 2.8.1 с полями `t_id` и UUID, включая смену статусов и drop connections.
- Негативные тесты: неверный Bridge Bearer, неверный HMAC, пустые и слишком большие массивы пользователей, старая подпись.
- Два активных узла; недоступная нода; переподключение; ложные срабатывания NAT и IPv6.
- Трафик за день, архив трафика, последние HWID и поиск совпадающего HWID; отчёт Telegram и buttons actions.
- Обновление настроек из UI, криптография при рестарте, отсутствие секретов в логах, поведение при недоступной панели.

## Cloudflare DNS

Раздел **Инструменты → Cloudflare DNS** содержит зашифрованный токен Cloudflare (нужны права Zone Read, DNS Read и DNS Edit), список зон, A/AAAA/CNAME записей, связи с хостами и нодами, включая поддомены и CNAME-цепочки. Для хостов, где вместо домена указан IP, предусмотрены **явные привязки DNS-записей к хостам**.

Zone ID можно изменить; перед сохранением проверяется, что он принадлежит выбранной зоне. Изменение IP в отдельной A/AAAA-записи выполняется только если её текущее значение совпадает с ожидаемым старым IP, а запись связана с хостом указанной ноды. Прокси-флаг, TTL и остальные поля сохраняются.

**Автоматизация после ротации IP** требует одновременно включить `auto_sync` на зоне и `updateCloudflare` в действии `rotate_ip`. Обновляются только соответствующие A-записи со старым IP; если Cloudflare недоступен, автоматизация фиксирует `partial_failure`, уже выполненная ротация IP ноды не откатывается.

- `GET /api/cloudflare-dns/overview`, `GET /api/cloudflare-dns/events`
- `GET/PUT/DELETE /api/cloudflare-dns/settings`: API Token
- `PUT /api/cloudflare-dns/zones`: `{domain,zoneId,autoSync}`
- `GET/PUT/DELETE /api/cloudflare-dns/links` — ручные связи DNS/хост
- `POST /api/cloudflare-dns/replace-ip`: `{zoneId,recordId,nodeUuid,expectedOldIp,newIp}`
- `POST /api/cloudflare-dns/webhook/node-ip-changed` — входящий подписанный запрос с `eventId,nodeUuid,oldIp,newIp`; `X-Webhook-Timestamp`, `X-Webhook-Event-Id`, `X-Webhook-Signature`, секрет `CLOUDFLARE_DNS_INCOMING_SECRET`.
- Исходящий `CLOUDFLARE_DNS_IP_UPDATED` отправляется на `CLOUDFLARE_DNS_WEBHOOK_URL` при наличии `CLOUDFLARE_DNS_WEBHOOK_SECRET`.

## Диски и шапка

`GET /api/remnadrop/disk-metrics` использует `statfs` для файловой системы контейнера (обычно тот же backing disk хоста). Дополнительные диски доступны при read-only mount в контейнер и заданном `REMNADROP_DISK_PATHS=/,/mnt/data,...`. На главной: всего / свободно, процент занятости, предупреждения 85/95%. Кнопка доната показывает надпись только на desktop, Telegram ведёт на https://t.me/remnadrop.

## Источники

- Upstream Limiter 5.1.0: https://github.com/syvlech/remnawave-limiter/releases/tag/5.1.0
- Cloudflare DNS API: https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/
