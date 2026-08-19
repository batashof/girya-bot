# 03. Модель данных

СУБД — Cloudflare D1 (SQLite). Пользователь один, поэтому нигде нет шардирования и почти нет индексов «на будущее».
Все временные метки — `TEXT` в ISO-8601 UTC. Все «даты тренировки» — `TEXT` вида `YYYY-MM-DD` в **локальном** часовом поясе пользователя (иначе тренировка в 07:00 по Варшаве попадала бы во вчерашний день по UTC).

## Схема

```sql
-- Пользователь (по факту один, но пусть будет таблица)
CREATE TABLE users (
  telegram_id      INTEGER PRIMARY KEY,
  timezone         TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  remind_at        TEXT NOT NULL DEFAULT '07:30',  -- HH:MM локального времени
  evening_ping_at  TEXT             DEFAULT '20:00',
  session_minutes  INTEGER NOT NULL DEFAULT 15,    -- бюджет времени: 10 | 15 | 20 | 25
  mini_reminders   INTEGER NOT NULL DEFAULT 0,     -- напоминать про /mini днём
  height_cm        INTEGER,                        -- 190
  weight_kg        REAL,                           -- 73
  birth_year       INTEGER,                        -- 1996
  level            TEXT NOT NULL DEFAULT 'base',   -- base | strong (стартовый уровень лестниц)
  has_pullup_bar   INTEGER NOT NULL DEFAULT 0,
  has_band         INTEGER NOT NULL DEFAULT 0,
  has_backpack     INTEGER NOT NULL DEFAULT 1,     -- DEFAULT из 0001; фактическое стартовое значение — 0, см. src/data/starter.ts
  block_start      TEXT NOT NULL,                  -- дата начала 4-недельного блока
  paused_from      TEXT,                           -- пауза — диапазон, а не дедлайн
  paused_until     TEXT,
  snooze_until     TEXT,                           -- утреннее напоминание отложено кнопкой «Через час», UTC
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Доступные гири. Стартовая конфигурация: две по 5 кг
CREATE TABLE kettlebells (
  user_id INTEGER NOT NULL REFERENCES users(telegram_id),
  weight  REAL    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, weight)
);

-- Справочник упражнений (сид из data/exercises.seed.json)
CREATE TABLE exercises (
  code        TEXT PRIMARY KEY,          -- NK1, RW2, PC3 …
  name        TEXT NOT NULL,
  group_code  TEXT NOT NULL,             -- neck | scap | row | posterior | press | legs | core | mobility
  pattern     TEXT NOT NULL,             -- hinge | squat | pull | push | carry | isometric | stretch | mobility | complex
  equipment   TEXT NOT NULL,             -- none | kettlebell | band | bar | wall | backpack
  chain       TEXT,                      -- push | row | squat | hinge | core — лестница прогрессии
  chain_level INTEGER,                   -- позиция в лестнице (1 = легче всего)
  unit        TEXT NOT NULL,             -- reps | seconds | steps
  unilateral  INTEGER NOT NULL DEFAULT 0,
  cues        TEXT NOT NULL,             -- краткая техника
  mistakes    TEXT,                      -- типичные ошибки
  video_url   TEXT,
  neck_safe   INTEGER NOT NULL DEFAULT 1,-- можно ли делать в день боли в шее
  swap_group  TEXT NOT NULL              -- чем заменяемо: упражнения одной swap_group взаимозаменяемы
);

-- Лестницы прогрессии из 06-exercise-library.md.
-- Ступень — не всегда другое упражнение: уровень 2 в тяге это тот же RW1, но с темпом
-- 3-1-3, а уровни 4–6 — одна и та же тяга под столом с разным положением ног.
-- Поэтому лестница живёт отдельной таблицей, а не выводится из exercises.chain_level.
CREATE TABLE chain_steps (
  chain         TEXT NOT NULL,           -- push | row | squat | hinge | core
  level         INTEGER NOT NULL,        -- 1 = легче всего
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  variant       TEXT,                    -- «с колен», «ноги прямые» — уточнение к упражнению
  tempo         TEXT NOT NULL DEFAULT 'normal',
  load_hint     TEXT,
  requires      TEXT,                    -- bar | band | backpack — без чего ступень недоступна
  target_min    INTEGER NOT NULL,        -- стартовый диапазон повторов/секунд на ступени
  target_max    INTEGER NOT NULL,
  PRIMARY KEY (chain, level)
);

-- Шаблоны дней: W-A … W-G
CREATE TABLE templates (
  code        TEXT PRIMARY KEY,          -- W-A
  title       TEXT NOT NULL,             -- «Спина и осанка»
  weekday     INTEGER NOT NULL,          -- 1=Пн … 7=Вс
  intensity   TEXT NOT NULL,             -- heavy | medium | light | recovery
  est_minutes INTEGER NOT NULL,
  optional    INTEGER NOT NULL DEFAULT 0,-- суббота по желанию: пропуск не рвёт серию
  kind        TEXT NOT NULL DEFAULT 'day' -- day | mini
);

-- «Один шаблон на день недели» — только для дней: у микро-блоков weekday = 0.
CREATE UNIQUE INDEX idx_templates_weekday ON templates(weekday) WHERE kind = 'day';

CREATE TABLE template_items (
  template_code TEXT NOT NULL REFERENCES templates(code),
  position      INTEGER NOT NULL,
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  block         TEXT NOT NULL,           -- neck | main | circuit | posture | support | mobility | walk
  follow_chain  TEXT,                    -- если задано — упражнение берётся из лестницы пользователя
  sets          INTEGER NOT NULL,
  target_min    INTEGER NOT NULL,        -- нижняя граница диапазона повторов/секунд
  target_max    INTEGER NOT NULL,        -- верхняя граница
  rest_sec      INTEGER NOT NULL DEFAULT 60,
  load_hint     TEXT,                    -- bodyweight | kb_light | kb_main | kb_heavy | backpack
  optional      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_code, position)
);

-- Текущая нагрузка по лестнице движения (состояние прогрессии).
-- Ключ — не упражнение, а цепочка: прогрессируем «тягу», а не конкретный её вариант.
CREATE TABLE progression (
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  chain         TEXT NOT NULL,           -- push | row | squat | hinge | core | scap …
  exercise_code TEXT NOT NULL REFERENCES exercises(code),  -- текущий вариант
  chain_level   INTEGER NOT NULL,        -- текущая ступень лестницы
  tempo         TEXT NOT NULL DEFAULT 'normal',  -- normal | slow | pause
  weight        REAL,                    -- 5 | 10 | вес рюкзака | NULL для веса тела
  current_reps  INTEGER NOT NULL,        -- текущая цель по повторам в подходе
  hard_streak   INTEGER NOT NULL DEFAULT 0,  -- подряд тренировок с фидбэком «тяжело»
  easy_streak   INTEGER NOT NULL DEFAULT 0,  -- подряд выполнено по верхней границе
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, chain)
);

-- Сессия = одна тренировка одного дня
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  local_date    TEXT NOT NULL,           -- YYYY-MM-DD
  template_code TEXT NOT NULL REFERENCES templates(code),
  kind          TEXT NOT NULL DEFAULT 'main',  -- main | mini (микро-сессия по /mini)
  week_in_block INTEGER NOT NULL,        -- 1..4, где 4 — разгрузка
  status        TEXT NOT NULL,           -- planned | in_progress | done | skipped
  neck_score    INTEGER,                 -- 0 нет боли … 3 сильно
  rpe           INTEGER,                 -- субъективная тяжесть 1..10
  started_at    TEXT,
  finished_at   TEXT,
  note          TEXT
);

-- Основная тренировка — одна в день. Микро-сессий (/mini) может быть сколько угодно.
CREATE UNIQUE INDEX idx_sessions_main_per_day
  ON sessions(user_id, local_date) WHERE kind = 'main';

-- Факт по подходам
CREATE TABLE session_sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,        -- порядок упражнения в тренировке
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  set_index     INTEGER NOT NULL,
  target_value  INTEGER NOT NULL,
  actual_value  INTEGER,
  weight        REAL,
  side          TEXT,                    -- left | right | NULL
  feedback      TEXT,                    -- easy | ok | hard | pain | skipped
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Замены упражнений, сделанные пользователем (учитываются при генерации)
CREATE TABLE swaps (
  user_id  INTEGER NOT NULL REFERENCES users(telegram_id),
  from_code TEXT NOT NULL REFERENCES exercises(code),
  to_code   TEXT NOT NULL REFERENCES exercises(code),
  until     TEXT,                        -- NULL = навсегда
  PRIMARY KEY (user_id, from_code)
);

-- Отправленные напоминания (чтобы cron не слал дубли)
CREATE TABLE reminders_log (
  user_id    INTEGER NOT NULL REFERENCES users(telegram_id),
  local_date TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- morning | evening | weekly_report
  sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, local_date, kind)
);

-- Состояние диалога: чего бот ждёт от пользователя прямо сейчас.
-- Нужно там, где ответ приходит текстом, а не кнопкой (онбординг, ввод числа повторов).
CREATE TABLE ui_state (
  user_id    INTEGER PRIMARY KEY REFERENCES users(telegram_id),
  screen     TEXT NOT NULL,              -- onboarding | …
  payload    TEXT NOT NULL DEFAULT '{}', -- JSON: шаг и уже собранные ответы
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Демонстрации к упражнениям. Только идентификатор файла в Telegram: гифка
-- загружается один раз и переотправляется по file_id бесплатно (ADR-014).
-- Отдельная таблица, а не колонка в exercises: справочник пересобирается сидом целиком.
CREATE TABLE exercise_media (
  exercise_code TEXT PRIMARY KEY REFERENCES exercises(code),
  file_id       TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'animation', -- animation | photo | video
  source        TEXT NOT NULL DEFAULT 'user',      -- user | builtin
  added_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
-- source = 'builtin' — кеш file_id для встроенной схемы из бандла: после первой
-- отправки файл больше не грузится. Своя гифка (`/gif`) пишется с source = 'user'
-- и такой кеш никогда не перетирает.

-- Минимальный аудит
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  kind       TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user_date ON sessions(user_id, local_date DESC);
CREATE INDEX idx_sets_session ON session_sets(session_id);
CREATE INDEX idx_sets_exercise ON session_sets(exercise_code);
```

## Ключевые решения

**Почему `progression` отдельной таблицей, а не вычисляется из логов.**
Вычислять текущую цель из истории — красиво, но каждый запрос превращается в агрегацию по всей истории плюс правила деload. Отдельная таблица делает состояние явным, отлаживаемым и правимым руками (`UPDATE progression SET chain_level = 3`). Логи остаются источником истины для аналитики, `progression` — производная, которую всегда можно пересобрать скриптом.

**Почему ключ прогрессии — цепочка, а не упражнение.**
Вес зафиксирован на 5 кг, поэтому нагрузка растёт сменой варианта: отжимания от стола → с пола → с паузой. Если хранить состояние по коду упражнения, при каждом переходе оно теряется. Цепочка (`push`, `row`, `squat`, `hinge`, `core`) — стабильная сущность, а конкретное упражнение и темп — её текущее состояние. Подробнее — [05-training-program.md](05-training-program.md).

**Почему основная тренировка одна в день.**
Частичный уникальный индекс по `kind = 'main'`: одна утренняя сессия формирует streak и прогрессию. Микро-сессии `/mini` пишутся в ту же таблицу с `kind = 'mini'`, но на прогрессию не влияют и в объём тренировок не входят — иначе три раза размяв шею за день, получишь ложное «выполнено».

**`neck_safe`.**
Флаг на упражнении, а не на группе: гиревой жим над головой в день острой боли в шее — плохая идея, а тяга в наклоне с опорой — нормальная. День с `neck_score >= 2` фильтрует набор по этому флагу.

**`swap_group`.**
Строка-ключ («horizontal_row», «hinge_heavy», «neck_isometric»). `/swap` предлагает упражнения из той же группы, доступные по инвентарю. Так замена не ломает смысл дня.

**Почему лестница — отдельная таблица `chain_steps`, а не порядок в `exercises`.**
Ступень лестницы не всегда равна упражнению. В тяге уровень 1 и уровень 2 — это один и тот же `RW1`, разница только в темпе; уровни 4–6 — один и тот же `RW7` с разным положением ног. Если хранить лестницу как `exercises.chain_level`, пришлось бы плодить упражнения-двойники ради темпа и угла. `chain_steps` описывает ступень как «упражнение + вариант + темп + вес», а `exercises.chain` остаётся пометкой принадлежности к лестнице.

**Почему микро-блоки живут в `templates`.**
`/mini` — это те же три минуты по списку упражнений, что и день недели, только короче. Заводить ради трёх блоков отдельную пару таблиц значит дублировать и загрузку, и отрисовку. Микро-блоки помечены `kind = 'mini'` и `weekday = 0`, а уникальность «один шаблон на день недели» стала частичной. Сессии по ним пишутся с `kind = 'mini'` и на прогрессию и серию не влияют (ADR-013).

**`snooze_until` и `paused_from`.**
Кнопка «Через час» переносит утреннее напоминание: момент хранится в UTC, а отметка об отправке снимается из `reminders_log`, иначе дедупликация не дала бы прислать его второй раз. `paused_from` нужен потому, что серия должна знать, какие именно дни прощать: из одного `paused_until` диапазон не восстановить.

**`template_items.block` и `follow_chain`.**
`block` — роль пункта в дне: шея, основное движение, осанка, поддерживающее, мобилити, круг, прогулка. Он же задаёт очередь на вылет, когда день не влезает в бюджет минут (ADR-012), и позволяет показать шейный протокол одной строкой вместо семи. `follow_chain` помечает пункт, который берётся не из шаблона, а из текущей ступени пользователя: в понедельник это «тяга», в четверг «отжимания». Без явной пометки пришлось бы подменять любое упражнение с непустым `chain`, и свинг в пятницу превращался бы в good morning.

## Миграции

В `migrations/` — только схема: нумерованные SQL-файлы, применяются `wrangler d1 migrations apply`. Откатов нет — при личном проекте проще написать миграцию-исправление. Перед рискованной миграцией — `wrangler d1 export` в файл (бэкап руками, `data/backups/` в `.gitignore`).

**Контент справочников миграцией не является.** `data/seed.generated.sql` собирается из `data/*.seed.json` командой `pnpm seed:build` и применяется отдельно (`pnpm seed:apply`). Файл начинается с `DELETE` всех четырёх справочных таблиц, поэтому применяется повторно сколько угодно раз, и добавление упражнения не требует новой миграции. Если держать сид среди миграций, его приходится вклинивать между `ALTER`-ами: первая же колонка, добавленная после сида, ломает применение на чистой базе.

## Бэкап

Раз в неделю cron выгружает сессии в JSON и шлёт файлом мне же в Telegram. Это и бэкап, и бесплатное хранилище истории. Плюс `/export` по требованию.
