# 03. Модель данных

СУБД — Cloudflare D1 (SQLite). Пользователь один, поэтому нигде нет шардирования и почти нет индексов «на будущее».
Все временные метки — `TEXT` в ISO-8601 UTC. Все «даты тренировки» — `TEXT` вида `YYYY-MM-DD` в **локальном** часовом поясе пользователя (иначе тренировка в 07:00 по Варшаве попадала бы во вчерашний день по UTC).

## Схема

```sql
-- Пользователь (по факту один, но пусть будет таблица)
CREATE TABLE users (
  telegram_id     INTEGER PRIMARY KEY,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  remind_at       TEXT NOT NULL DEFAULT '07:30',   -- HH:MM локального времени
  evening_ping_at TEXT             DEFAULT '20:00',
  level           TEXT NOT NULL DEFAULT 'base',    -- base | strong
  has_pullup_bar  INTEGER NOT NULL DEFAULT 0,
  has_band        INTEGER NOT NULL DEFAULT 0,
  block_start     TEXT NOT NULL,                   -- дата начала 4-недельного блока
  paused_until    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Доступные гири: 16, 24 …
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
  equipment   TEXT NOT NULL,             -- none | kettlebell | band | bar | wall
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
  title       TEXT NOT NULL,             -- «Тяга и задняя цепь»
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

-- Текущая рабочая нагрузка по упражнению (состояние прогрессии)
CREATE TABLE progression (
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  weight        REAL,                    -- NULL для упражнений с весом тела
  current_reps  INTEGER NOT NULL,        -- текущая цель по повторам в подходе
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, exercise_code)
);

-- Сессия = одна тренировка одного дня
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  local_date    TEXT NOT NULL,           -- YYYY-MM-DD
  template_code TEXT NOT NULL REFERENCES templates(code),
  week_in_block INTEGER NOT NULL,        -- 1..4, где 4 — разгрузка
  status        TEXT NOT NULL,           -- planned | in_progress | done | skipped
  neck_score    INTEGER,                 -- 0 нет боли … 3 сильно
  rpe           INTEGER,                 -- субъективная тяжесть 1..10
  started_at    TEXT,
  finished_at   TEXT,
  note          TEXT,
  UNIQUE (user_id, local_date)
);

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
Вычислять текущую цель из истории — красиво, но каждый запрос превращается в агрегацию по всей истории плюс правила деload. Отдельная таблица делает состояние явным, отлаживаемым и правимым руками (`UPDATE progression SET weight = 24`). Логи остаются источником истины для аналитики, `progression` — производная, которую всегда можно пересобрать скриптом.

**Почему у сессии `UNIQUE (user_id, local_date)`.**
Одна тренировка в день. Если хочется вторую — это `note` к существующей, а не вторая строка. Упрощает streak и отчёты.

**`neck_safe`.**
Флаг на упражнении, а не на группе: гиревой жим над головой в день острой боли в шее — плохая идея, а тяга в наклоне с опорой — нормальная. День с `neck_score >= 2` фильтрует набор по этому флагу.

**`swap_group`.**
Строка-ключ («horizontal_row», «hinge_heavy», «neck_isometric»). `/swap` предлагает упражнения из той же группы, доступные по инвентарю. Так замена не ломает смысл дня.

## Миграции

Нумерованные SQL-файлы в `migrations/`, применяются `wrangler d1 migrations apply`. Откатов нет — при личном проекте проще написать миграцию-исправление. Перед рискованной миграцией — `wrangler d1 export` в файл (бэкап руками, `data/backups/` в `.gitignore`).

## Бэкап

Раз в неделю cron выгружает сессии в JSON и шлёт файлом мне же в Telegram. Это и бэкап, и бесплатное хранилище истории. Плюс `/export` по требованию.
