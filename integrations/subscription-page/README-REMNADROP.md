# Страница подписки RemnaDrop

Исходная основа: [Remnawave Subscription Page 7.2.6](https://github.com/remnawave/subscription-page/tree/7.2.6), лицензия AGPL-3.0-only. Изменения RemnaDrop сохраняются в этом репозитории вместе с исходным кодом и файлом `LICENCE`.

Страница показывает кнопки поддержки, Telegram и сайта из **Subpage Editor → Брендинг**, если соответствующие ссылки заданы. Переменные `{{EMAIL}}`, `{{ID}}`, `{{USERNAME}}`, `{{TELEGRAM_ID}}` в ссылках подставляет панель. Публичная страница также показывает группы квот нод из ответа `/api/sub/:shortUuid/info`. Если групп нет, блок скрыт.

В редакторе можно настроить фон, цвет карточек, акцент и основной текст. Старые конфигурации получают стандартную тёмную палитру. После сохранения конфигурации обновите страницу подписки в браузере: Subpage запросит актуальные настройки у панели.

## Установка поверх Subpage из remnawave-scripts

Установите страницу штатным скриптом `remnawave-scripts`, чтобы получить `.env`, сеть и прокси. Затем на сервере, где установлен Docker и доступен исходный код RemnaDrop:

```bash
cd /opt/remnadrop-git/integrations/subscription-page
docker build -t remnadrop/subscription-page:7.2.6 .
```

В compose-файле, который запускает сервис `remnawave-subscription-page`, замените только его `image` на `remnadrop/subscription-page:7.2.6`, сохранив существующие `env_file`, порты и сеть. Из каталога этого compose-файла выполните:

```bash
docker compose up -d --no-deps remnawave-subscription-page
docker compose ps remnawave-subscription-page
```

После обновления панели пересоберите образ из актуального исходного кода, затем повторите `docker compose up -d --no-deps remnawave-subscription-page`. Настройки страницы хранятся в панели и не перезаписываются сборкой.

**Важно:** страница должна иметь доступ к API панели через прежний `REMNAWAVE_PANEL_URL` и действующий `REMNAWAVE_API_TOKEN` из её `.env`. Секрет сеанса `INTERNAL_JWT_SECRET` создаётся при запуске контейнера. Не публикуйте `.env` и не добавляйте его в репозиторий.
