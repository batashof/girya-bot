# 08. Деплой за 0 денег

Всё ниже выполняется один раз и не требует карты. Итоговый счёт — $0/мес.

> Цифры лимитов приведены на момент написания документа. Перед деплоем стоит сверить актуальные на страницах тарифов Cloudflare — они меняются, хотя порядок величин остаётся тем же.

## Что понадобится

| Что | Стоимость |
| --- | --- |
| Аккаунт Telegram | бесплатно |
| Аккаунт Cloudflare (Workers Free) | бесплатно, карта не нужна |
| Аккаунт GitHub | уже есть |
| Node 22+, pnpm 11 | локально |

---

## Шаг 1. Бот в Telegram

1. Написать [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Имя: `Girya`. Username: любой свободный, например `girya_personal_bot`.
3. Сохранить токен — он понадобится как секрет `BOT_TOKEN`.
4. Сразу сделать второго бота для разработки (`girya_dev_bot`) — чтобы отладка не ломала боевой.
5. Полезное в BotFather: `/setcommands` — список команд из [04-bot-ux.md](04-bot-ux.md), `/setdescription`, `/setprivacy` → Enabled.

Свой Telegram ID узнать у [@userinfobot](https://t.me/userinfobot) — это `OWNER_TELEGRAM_ID`.

---

## Шаг 2. Cloudflare

```bash
pnpm add -D wrangler
npx wrangler login
```

Создать базу:

```bash
npx wrangler d1 create girya
```

Команда напечатает `database_id` — вставить его в `wrangler.toml`:

```toml
name = "girya-bot"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "girya"
database_id = "<из вывода команды>"

[triggers]
crons = ["*/5 * * * *"]

[vars]
OWNER_TELEGRAM_ID = "<мой telegram id>"
```

Применить миграции:

```bash
pnpm db:local     # схема + контент справочников в локальную базу
pnpm db:remote    # то же в прод
```

`db:*` — это две операции: `wrangler d1 migrations apply` для схемы и применение
`data/seed.generated.sql` для справочников. Контент не миграция: файл начинается с `DELETE`
и применяется повторно, поэтому новое упражнение не требует новой миграции.

---

## Шаг 3. Секреты

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET     # любая случайная строка, например `openssl rand -hex 32`
```

Локально те же значения кладутся в `.dev.vars` (файл в `.gitignore`, в репозиторий не попадает):

```
BOT_TOKEN=123456:dev-bot-token
WEBHOOK_SECRET=dev-secret
```

---

## Шаг 4. Первый деплой

```bash
npx wrangler deploy
```

Вывод содержит адрес вида `https://girya-bot.<subdomain>.workers.dev`.

Прописать вебхук (один раз, и после каждой смены секрета):

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://girya-bot.<subdomain>.workers.dev/tg/<random-path>","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
```

Проверка:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

`pending_update_count: 0` и пустой `last_error_message` — всё в порядке. Затем `/ping` в чат.

---

## Шаг 5. Автодеплой из GitHub

`.github/workflows/deploy.yml`:

```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

Токен API создаётся в Cloudflare → My Profile → API Tokens → шаблон **Edit Cloudflare Workers**. Оба значения кладутся в Settings → Secrets → Actions репозитория.

**Пока секретов нет, деплоя из CI тоже нет.** Шаг `wrangler-action` пропускается, а джоб остаётся зелёным — по замыслу, чтобы не ронять сборку на каждом пуше, но выглядит это в точности как успешный деплой. Проверять надо не цвет галочки, а последнее развёртывание:

```bash
npx wrangler deployments list   # дата сверху должна совпадать с последним пушем
npx wrangler deploy             # выкатить руками
```

Миграции в CI сознательно не запускаются: их мало, они редкие, и применять их руками безопаснее, чем автоматически на проде.

---

## Локальная разработка

```bash
pnpm dev      # wrangler dev --local + dev-бот в long-polling
pnpm test     # Vitest по domain/
pnpm typecheck
```

В dev-режиме вебхук не нужен: бот сам опрашивает Telegram. Один и тот же код бота собирается из `src/bot/bot.ts`, различаются только точки входа.

---

## Эксплуатация

| Задача | Команда |
| --- | --- |
| Живые логи | `npx wrangler tail` |
| SQL-запрос к проду | `npx wrangler d1 execute girya --remote --command "SELECT * FROM sessions ORDER BY id DESC LIMIT 5"` |
| Бэкап | `npx wrangler d1 export girya --remote --output data/backups/$(date +%F).sql` |
| Откат деплоя | `npx wrangler rollback` |
| Снять вебхук | `curl -X POST ".../deleteWebhook"` |

---

## Лимиты бесплатных тарифов

| Ресурс | Лимит | Наш расход | Запас |
| --- | --- | --- | --- |
| Workers requests | 100 000/день | ~300/день | ×300 |
| Workers CPU time | 10 мс/запрос | единицы мс | достаточно |
| Cron triggers | доступны на Free | 288/день | — |
| D1 storage | 5 ГБ | <5 МБ за годы | ×1000 |
| D1 rows read | 5 млн/день | тысячи | ×1000 |
| D1 rows written | 100 тыс./день | сотни | ×300 |
| GitHub Actions (private) | 2 000 мин/мес | ~1 мин на деплой | — |

Ни одного платного компонента. Если Cloudflare когда-нибудь изменит условия — вся логика лежит в `src/domain/`, не зависит от платформы, и переезд на Render/VPS занимает день (см. [09-adr.md](09-adr.md)).
