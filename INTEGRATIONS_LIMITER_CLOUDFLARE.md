# RemnaDrop 2.8.1: встроенный Limiter 5.1.0 + Cloudflare DNS

> Состояние: feature branch / черновой PR. Полная Docker-сборка проверяется в CI; интеграционные тесты на восстановленной PostgreSQL 2.8.1 и реальных нодах обязательны перед production.

## Архитектура: панель и Limiter в одном Docker-контейнере

Образ `panel-fork:...` теперь содержит **оригинальный Go-бинарник [syvlech/remnawave-limiter 5.1.0](https://github.com/syvlech/remnawave-limiter/releases/tag/5.1.0)**. В процессе запуска NestJS регистрирует `LimiterRunnerService`:

- Когда в **Инструменты → Limiter** переключатель выключен, Go-процесс отсутствует.
- Когда включён — NestJS проверяет настройки, запускает Go Limiter дочерним процессом **в том же контейнере `remnawave`**, наблюдает за его завершением, обновляет статус и перезапускает при изменении настроек.
- Используется уже существующий сокет Valkey `/var/run/valkey/valkey.sock`, логическая Redis DB 8. Не запускаются отдельные Limiter/Valkey-контейнеры, новые Docker volumes и открытые порты.
- Для безопасности `LimiterBridgeSecretsService` генерирует временные случайные внутренние Bearer/HMAC ключи при каждом запуске API. Они передаются только дочернему процессу. `REMNADROP_LIMITER_BRIDGE_TOKEN` и `REMNADROP_LIMITER_WEBHOOK_SECRET` **задавать вручную не требуется**.
- API совместимости доступен только при знании внутреннего Bearer ключа. Внешний API Limiter не публикуется. `/api/limiter-webhook` проверяет HMAC над исходным телом запроса.
- При ошибке запуска (нет Telegram-секретов, Valkey недоступен, бинарник отсутствует) **панель продолжает работать**, а причина выводится в настройках Limiter.
- При остановке панели встроенный Limiter тоже останавливается.

**Важно о Redis:** стандартная конфигурация Valkey для RemnaDrop может содержать `--save "" --appendonly no`: при рестарте такие данные удаляются. Limiter хранит в Redis очереди автовосстановления заблокированных пользователей. Поэтому встроенный runner **запрещает запуск в автоматическом режиме без AOF или RDB**, чтобы не оставлять пользователей отключёнными навсегда. Ручной режим работает без этой настройки. Для полноценной автоблокировки включите долговременное хранение Redis с постоянным volume, затем убедитесь, что данные сохраняются после перезапуска. Не меняйте live Valkey без резервного плана.

### Совместимость API 5.1.0 → Remnawave 2.8.1

У Limiter 5.1.0 другой API. `LimiterBridgeController` предоставляет следующие адаптированные endpoints:

| Upstream API | Вызов в RemnaDrop 2.8.1 |
|---|---|
| `GET nodes` | Таблица nodes |
| `POST/GET connections/by-node` | Очереди `fetch-users-ips` |
| `GET users/:id` | Users по `t_id` + InternalSquads |
| `POST users/:id/actions/disable,enable` | `UsersService` |
| `POST connections/drop` | Очереди нод |
| `GET hwid/devices` | Таблица `hwid_user_devices` |
| `GET users/:id/subscription-request-history` | История обращения к подпискам |
| `POST bandwidth-stats/nodes/usage` | Статистика трафика пользователей по нодам |

Оригинальная логика Limiter 5.1.0 отвечает за IP/ASN группировку, предупреждения, режимы manual/auto, временные блокировки и автовосстановление, поиск аномального трафика, повторных пробных подписок по общему HWID, Telegram-уведомления и inline-кнопки.

### Настройки через интерфейс

Во вкладке `Инструменты → Limiter` задаются:

- Режим, интервал, окно активности IP, HWID-лимиты, допуски, порог и окно нарушений, cooldown и время автовосстановления.
- IPv4 подсети, ASN, исключённые IP/CIDR, пользователи и ноды.
- Аномальный трафик, общий HWID, мониторинг повторных пробных периодов.
- Telegram Bot Token, Chat ID, Admin IDs; при необходимости MaxMind License Key и UUID сквадов.

Telegram/MaxMind ключи шифруются AES-256-GCM в PostgreSQL, никогда не возвращаются в UI. Для стабильности шифрования используйте переменную `REMNADROP_LIMITER_ENCRYPTION_KEY` (32+ случайных символов) **в конфигурации панели**. Альтернативно используется уже существующий стабильный `APP_SECRET` / `JWT_AUTH_SECRET`, если задан.

### Установка ПОСЛЕ интеграционных тестов и слияния PR

```bash
df -h /
cd /opt/remnadrop-git
git switch main
git pull --ff-only origin main
sudo remnadrop check
sudo remnadrop update
```

Установщик собирает один обновлённый образ панели, выполняет резервное копирование и миграции. После обновления:

```bash
docker inspect remnawave --format 'Image={{.Config.Image}} Health={{.State.Health.Status}}'
docker exec remnawave test -x /usr/local/bin/remnawave-limiter
docker ps --filter name=remnawave
```

Дополнительная команда `docker compose ... remnadrop-limiter` **НЕ НУЖНА**. Новые параметры доступны непосредственно на странице Limiter. Пока настройки не сохранены и переключатель выключен, фоновая проверка не запускается.

Перед установкой желательно **8–10 ГиБ свободного места** для Docker-сборки, нового образа, дампа PostgreSQL и проверки отката. Проведите миграцию и API/Redis smoke-тест на тестовом экземпляре. Не обновляйте работающую панель наугад.

## Cloudflare DNS

**Инструменты → Cloudflare DNS** показывает зоны Cloudflare, A/AAAA/CNAME-записи, поддомены, отношения к хостам и нодам. Токен Cloudflare хранится зашифрованным (права Zone Read, DNS Read, DNS Edit); `CLOUDFLARE_DNS_ENCRYPTION_KEY` также задаётся в конфигурации панели.

Разрешено менять Zone ID с проверкой владельца зоны; вручную привязывать запись к хосту с IP вместо домена. При сопоставлении учитывается **host.address**, связанные CNAME и явные привязки. SNI и HTTP Host игнорируются как потенциальные маскировочные поля.

Автозамена IP работает при двух явных условиях: `auto_sync` на зоне Cloudflare и `updateCloudflare` в действии `rotate_ip`. При совпадении старого IP изменяется только A-запись, привязанная к хосту нужной ноды. Посторонние DNS-записи не затрагиваются. История сохраняется в `cf_dns_events`.

Админский API: `/api/cloudflare-dns/overview`, `/api/cloudflare-dns/events`, `/api/cloudflare-dns/settings`, `/api/cloudflare-dns/zones`, `/api/cloudflare-dns/links`, `POST /api/cloudflare-dns/replace-ip`. Входящий HMAC-вебхук — `POST /api/cloudflare-dns/webhook/node-ip-changed`; исходящий — `CLOUDFLARE_DNS_IP_UPDATED` на `CLOUDFLARE_DNS_WEBHOOK_URL` с `CLOUDFLARE_DNS_WEBHOOK_SECRET`.

## Главная и интерфейс

На Главной отображается использование доступного пространства файловой системы панели. Дополнительные диски можно показать через read-only mounts + `REMNADROP_DISK_PATHS`. Кнопка поддержки подписана «Поддержать проект» на десктопе; Telegram-ссылка — https://t.me/remnadrop.

## Проверки перед production

1. CI Dockerfile.dev / NestJS / frontend / Prisma генерация и наличие бинарника Limiter в итоговом образе.
2. Миграция на восстановленном клоне PostgreSQL Remnawave 2.8.1.
3. Limiter включён/выключен через UI; один контейнер `remnawave`; использование Unix Valkey DB 8; ошибка в настройках не останавливает панель.
4. Безопасность HMAC/Bearer, отключение/восстановление тестовых пользователей, Telegram, трафиковые алерты, общий HWID.
5. Cloudflare DNS: Zone ID, домены и поддомены, CNAME, explicit links, PATCH с compare-and-swap IP, отрицательные тесты чужих записей, webhook HMAC, таймаут и повтор события.
6. Работа в браузере с мобильных устройств и после обновления страницы.

Источники: upstream [Limiter 5.1.0](https://github.com/syvlech/remnawave-limiter/releases/tag/5.1.0), документация [Cloudflare DNS API](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/).
