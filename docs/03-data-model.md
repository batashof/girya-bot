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
  has_backpack     INTEGER NOT NULL DEFAULT 1,     -- рюкзак с книгами = регулируемый вес
  block_start      TEXT NOT NULL,                  -- дата начала 4-недельного блока
  paused_until     TEXT,
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
  pattern     TEXT NOT NULL,             -- hinge | squat | pull | push | carry | isometric | stretch | mobility
  equipment   TEXT NOT NULL,             -- none | kettlebell | band | bar | wall | backpack
  chain       TEXT,                      -- push | row | squat | hinge | core — лестница прогрессии
  chain_level INTEGER,                   -- позиция в лестнице (1 = легче всего)
  unit        TEXT NOT NULL,             -- reps | seconds | meters
  unilateral  INTEGER NOT NULL DEFAULT 0,
  cues        TEXT NOT NULL,             -- краткая техника
  mistakes    TEXT,                      -- типичные ошибки
  video_url   TEXT,
  neck_safe   INTEGER NOT NULL DEFAULT 1,-- можно ли делать в день боли в шее
  swap_group  TEXT NOT NULL              -- чем заменяемо: упражнения одной swap_group взаимозаменяемы
);

-- Шаблоны дней: W-A … W-G
CREATE TABLE templates (
  code        TEXT PRIMARY KEY,          -- W-A
  title       TEXT NOT NULL,             -- «Спина и осанка»
  weekday     INTEGER NOT NULL,          -- 1=Пн … 7=Вс
  intensity   TEXT NOT NULL,             -- heavy | medium | light | recovery
  est_minutes INTEGER NOT NULL
);

CREATE TABLE template_items (
  template_code TEXT NOT NULL REFERENCES templates(code),
  position      INTEGER NOT NULL,
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  sets          INTEGER NOT NULL,
  target_min    INTEGER NOT NULL,        -- нижняя граница диапазона повторов/секунд
  target_max    INTEGER NOT NULL,        -- верхняя граница
  rest_sec      INTEGER NOT NULL DEFAULT 60,
  load_hint     TEXT,                    -- bodyweight | kb_light | kb_main | kb_heavy
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

## Миграции

Нумерованные SQL-файлы в `migrations/`, применяются `wrangler d1 migrations apply`. Откатов нет — при личном проекте проще написать миграцию-исправление. Перед рискованной миграцией — `wrangler d1 export` в файл (бэкап руками, `data/backups/` в `.gitignore`).

## Бэкап

Раз в неделю cron выгружает сессии в JSON и шлёт файлом мне же в Telegram. Это и бэкап, и бесплатное хранилище истории. Плюс `/export` по требованию.
