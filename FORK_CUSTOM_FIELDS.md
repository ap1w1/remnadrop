# RemnaDrop: кастомные поля и расширения форка

Документ фиксирует публичный API и поведение, которых нет в исходной Remnawave 2.8.1. **Все дополнительные поля должны сохранять обратную совместимость** с существующими подписками и клиентами.

## Torrent Blocker — `torrent_blocker.report`

В существующем подписанном вебхуке Remnawave (`scope: "torrent_blocker"`) добавлены:
- `data.device`: `{hwid, platform, model, userAgent}` или `null`, если вероятное устройство определить нельзя.
- `data.deviceIdentification`: `{status:"probable"|"unknown", method:"ip", candidateCount:number}`.
- Поля `data.report.device` и `data.report.deviceIdentification` дублируют данные ради совместимости старых получателей.

Устройство определяется по совпадению исходного IP с историей IP запросов подписки, а не по прямому соответствию торрент-соединению. NAT, VPN, мобильные сети и общие публичные IP могут давать ложные совпадения. **Не считать `probable` гарантированной идентификацией.** При неоднозначности `device=null`. Пример формата: [TORRENT_BLOCKER_WEBHOOK_DEVICE.md](TORRENT_BLOCKER_WEBHOOK_DEVICE.md).

Подпись обычных вебхуков Remnawave: `X-Remnawave-Signature=HMAC-SHA256(WEBHOOK_SECRET_HEADER, raw JSON)`; время `X-Remnawave-Timestamp`. HWID может быть персональными данными, поэтому журналируйте только необходимое.

## DPI Checker

API панели:
- `GET /api/dpi-checker/host-options`: `{nodes:[{uuid,name,address,countryCode}],hosts:[{uuid,remark,address,isDisabled,isHidden,inboundUuid,nodeUuids}]}`; все UUID — строки.
- `POST /api/dpi-checker/checks/prepare`: `{hosts: string[], location, pop_ids?:number[]}`; скрытые, но активные хосты допускаются **только в диагностическом временном аккаунте**.
- `GET /api/dpi-checker/checks/:id`: кроме прежних полей, возвращает `remote_response` — рекурсивно санитизированный JSON от DPI Checker, с удалёнными URIs, ключами, паролями и токенами. Проверки, завершившиеся до миграции, могут не иметь `remote_response`.
- `GET /api/dpi-checker/billing-settings`: `{enabled:boolean}`; `PUT` с `{enabled:boolean}` включает/выключает запись **новых** фактических расходов в инфра-биллинг.
- При включении создаётся или находится провайдер `DPI//CHECKER` (по уникальному имени) с указанным favicon и ссылкой бота. Расходы записываются только после `status=completed` и `actual_cost>0`; запись идемпотентна по `job_id`, исходные списания не удваиваются. Исторические проверки не импортируются.

## Автоматизации — результаты DPI и журнал

В `node_automation_rules.actions` добавлены поля:
```json
{
  "type":"dpi_check",
  "hosts":["host-uuid"],
  "location":"russia",
  "locations":[{"location":"russia"},{"location":"russia_mobile"}],
  "gate":{"minUnavailableRegions":2,"timeoutMinutes":15}
}
```
Действие после него может содержать `when`: `always`, `dpi_unavailable`, `dpi_available`, `dpi_unknown`. Опасные операции (смена IP, DNS и скрытие хостов) допустимы только после **подтверждённой** `dpi_unavailable`, а не при незавершённой проверке или ошибке.

В `node_automation_executions.details` появляются `status: "pending"`, `jobs` со ссылками на проверки, `outcome: "unavailable"|"available"|"unknown"` и итоговое описание. `node_automation_executions.status` поддерживает `waiting_dpi`. История и состояние ожидания переживают перезапуск панели. Нода в интерфейсе имеет флаг `countryCode` и адрес `address`.

## Limiter — исходящие вебхуки и диагностический статус

Подробный контракт: [INTEGRATIONS_LIMITER_CLOUDFLARE.md](INTEGRATIONS_LIMITER_CLOUDFLARE.md). Исходящие вебхуки Limiter используют общие `WEBHOOK_ENABLED`, `WEBHOOK_URL` и `WEBHOOK_SECRET_HEADER`. События не переотправляются при смене адреса получателя; очередь хранит попытки и идемпотентный `event_key`.

Исходящий Limiter подписывается стандартным `X-Remnawave-Signature`. Ошибка подключения `Can't reach database server at remnawave-db:5432` означает недоступность PostgreSQL, а не проблему формата вебхука. Проверять нужно контейнер, диск, сеть и PostgreSQL.

## Visual Xray и хосты

Редактор сохраняет произвольные поля исходного JSON и работает поверх `inbounds`, `outbounds`, `routing.rules`, `routing.balancers`, `observatory`, `dns`, `log`.
Поддерживаются `hysteria` + `streamSettings.finalmask.udp` salamander, `streamSettings.hysteriaSettings`, сертификаты TLS, Reality, VLESS, WS/XHTTP/gRPC, SOCKOPT, маршрутизация, outbound и балансировщики.
Логирование: `log.access`, `log.error`, `loglevel` (или существующее `logLevel`), `dnsLog`, `maskAddress`.

Перечень дополнительных отпечатков хостов (поле `fingerprint`):
`hellochrome_auto`, `hellofirefox_auto`, `helloios_auto`, `helloedge_auto`, `hellosafari_auto`, `hello360_auto`, `helloqq_auto`.

**Важное ограничение:** отображение нового fingerprint в выпадающем списке не означает его поддержку каждой сборкой Xray или всеми клиентами. Проверяйте совместимость на тестовом сервере; неизвестные значения могут приводить к ошибке транспорта.

---
Не сохраняйте реальные приватные ключи REALITY, Hysteria/SALAMANDER PSK, VLESS UUID клиентов и токены в примерах, документации или логах CI.
