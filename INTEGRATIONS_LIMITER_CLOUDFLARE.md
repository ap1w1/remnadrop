# RemnaDrop 2.8.1: Limiter + Cloudflare DNS

**Статус:** экспериментальная интеграция, feature branch. Не разворачивать на рабочей панели до прохождения CI и тестов на копии PostgreSQL.

## Limiter (Инструменты → Limiter)

Нативный монитор NestJS использует API/очереди Remnawave 2.8.1 через `NodesQueuesService.queryUsersIpsList` и `getUsersIpsListResult`: тот же маршрут `fetch-users-ips`, что используется в исходном [remnawave-limiter 3.0.0](https://github.com/syvlech/remnawave-limiter/tree/3.0.0).

В интерфейсе можно включить проверки, выбрать ручное предупреждение без блокировки или автоматическое отключение через UsersService. Настраиваются HWID fallback, допуск, число повторений, окно активности IP, cooldown, исключения нод/пользователей/IP и группировка IPv4 по /24. Журнал `limiter_events` хранит время, пользователя, IP и ноды. По умолчанию всё выключено, `manual`.

**Отличия от upstream Go 3.0.0:** эта версия НЕ включает Telegram inline-кнопки, MaxMind ASN, полноценные CIDR исключения, отдельный Redis state, штатные upstream Telegram /stats /settings и отчёты. Возможен бесплатный вариант без Telegram; опциональные текстовые уведомления требуют переменных `LIMITER_TELEGRAM_BOT_TOKEN` и `LIMITER_TELEGRAM_CHAT_ID`.

При отсутствии ответа хотя бы одной включённой ноды в текущем цикле автоматическое применение блокировок отменяется, чтобы не ошибиться на неполных данных. Для автоматического режима обязательны тесты с динамическими / NAT клиентами. Действия Limiter не управляют внутренними ограничениями сквадов — меняют только глобальный статус подписки.

API (только JWT администратор):
- `GET /api/limiter/settings` — настройки и последняя проверка
- `PUT /api/limiter/settings` — изменить настройки
- `GET /api/limiter/events` — последние 250 событий
- `POST /api/limiter/ignore/{userUuid}` и `POST /api/limiter/unignore/{userUuid}`

## Cloudflare DNS (Инструменты → Cloudflare DNS)

**Токен:** создать Cloudflare scoped API Token с правами **Zone:Read, DNS:Read, DNS:Edit** только для нужных зон. Вставить в UI, хранится AES-256-GCM в PostgreSQL. Для расшифровки задайте постоянную секретную переменную на сервере `CLOUDFLARE_DNS_ENCRYPTION_KEY` длиной от 32 символов (лучше случайные 48+ символов). Не размещайте токен в UI логах, Git или URL. Секрет должен совпадать у всех инстансов панели.

В UI перечислены зоны и A/AAAA/CNAME, вычисляются связи по address/host/SNI в хостах Remnawave с соответствующими нодами, включая CNAME цепочки до 6 переходов. Для хостов с IP вместо имени можно использовать кнопку ручной привязки DNS-записи к конкретному хосту. Можно задать и отредактировать Zone ID (проверяется через API).

Автоматическая синхронизация требует **двух независимых включений**: флаг `auto_sync` для зоны в Cloudflare DNS и опция `После смены IP обновлять Cloudflare DNS` в правиле автоматизации действия `rotate_ip`. Будут изменяться только A-записи, уже содержащие старый IP, связаные с хостами данной ноды. Новая запись не создаётся, соседние домены не затрагиваются. При ошибке Cloudflare изменение IP на ноде не откатывается, а в истории появится partial_failure.

Административные API (JWT):
- `GET /api/cloudflare-dns/overview` — зоны, записи, связанные хосты/ноды
- `GET /api/cloudflare-dns/settings` и `PUT /api/cloudflare-dns/settings` с `{ "apiToken": "..." }`
- `PUT /api/cloudflare-dns/zones` с `{ "domain": "example.com", "zoneId": "32_hex_chars", "autoSync": true }`
- `GET /api/cloudflare-dns/links` и `PUT /api/cloudflare-dns/links` с `{ "zoneId": "...", "recordId": "...", "hostUuid": "..." }`
- `DELETE /api/cloudflare-dns/links/{zoneId}/{recordId}/{hostUuid}`
- `POST /api/cloudflare-dns/replace-ip` с `{ "zoneId": "...", "recordId": "...", "nodeUuid": "...", "expectedOldIp": "198.51.100.10", "newIp": "198.51.100.20" }` (адреса здесь примеры, не реальные IP)
- `GET /api/cloudflare-dns/events` — история успешных/неуспешных замен

**Входящий вебхук:** `POST /api/cloudflare-dns/webhook/node-ip-changed`, включается при наличии `CLOUDFLARE_DNS_INCOMING_SECRET` (не менее 32 символов). Требования: JSON тело `{ "eventId": "<uuid>", "nodeUuid": "<uuid>", "oldIp": "<oldIPv4>", "newIp": "<newIPv4>" }`, заголовки `X-Webhook-Event-Id: <eventId>`, `X-Webhook-Timestamp: <Unix seconds UTC>`, `X-Webhook-Signature: sha256=<hex>`, где HMAC-SHA256 считается от `timestamp + '.' + JSON.stringify(body)` с ключом `CLOUDFLARE_DNS_INCOMING_SECRET`. Допуск 5 минут. EventId защищает от повторной доставки. Для данного вебхука не нужен admin JWT, только HMAC; защитите URL сетевыми правилами.

**Исходящий вебхук:** успешная замена IP отправляет `CLOUDFLARE_DNS_IP_UPDATED` на `CLOUDFLARE_DNS_WEBHOOK_URL` при заданном `CLOUDFLARE_DNS_WEBHOOK_SECRET` длиной 32+ символов; используется существующая защищённая функция `postSignedWebhook` с полями `X-Webhook-Event-Id`, `X-Webhook-Timestamp`, `X-Webhook-Signature` от `timestamp + '.' + body`. Необходим HTTPS endpoint с публичным IPv4; доставку надо контролировать по логам.

## Метрика дисков

`GET /api/remnadrop/disk-metrics` возвращает место на файловой системе контейнера панели (`/`), что на обычном Docker overlay соответствует лежащему под ним разделу хоста. Для **отдельных дисков** пробросьте каталоги в контейнер в режиме read-only, задайте `REMNADROP_DISK_PATHS=/,/mnt/data,...`; метрики read-only. Не пробрасывайте чувствительные директории (`/var/run/docker.sock`, PostgreSQL data) и не запускайте контейнер как privileged ради мониторинга.

## Подготовка к запуску

1. Дождаться зелёной Docker CI сборки. Изменения пока в draft PR.
2. Сохранить актуальный образ и дамп PostgreSQL 2.8.1, восстановить в изолированную тестовую БД.
3. Выполнить миграцию только на тестовой БД и проверить оба модуля (по умолчанию отключены), маршруты и авторизацию.
4. Проверить 2 ноды, пропуск при сбое одной ноды, ручной/автоматический Limiter и возврат после срока. НЕ тестировать автоблокировку на реальных клиентах.
5. Cloudflare тесты: неверный token/zone, A/CNAME и IP-only хост, CAS mismatch старого IP, не связанная запись, таймштамп и HMAC неверные, повтор webhook, частичный сбой Cloudflare.
6. Dashboard desktop/mobile, админские права, health и расход диска. На production требуется достаточный запас: для сборки, экспортов контейнера и тестового восстановления БД.

### Внешние источники

- https://github.com/syvlech/remnawave-limiter/tree/3.0.0
- https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/

Обратите внимание на GPLv3 upstream при использовании или переносе его исходных файлов. Эта реализация написана отдельно для 2.8.1, полный исходный Go проект в форк не добавлен.