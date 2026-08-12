-- Схема из docs/03-data-model.md.
-- Все временные метки — ISO-8601 UTC; все «даты тренировки» — YYYY-MM-DD в локальном
-- часовом поясе пользователя.

CREATE TABLE users (
  telegram_id      INTEGER PRIMARY KEY,
  timezone         TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  remind_at        TEXT NOT NULL DEFAULT '07:30',  -- HH:MM локального времени
  evening_ping_at  TEXT             DEFAULT '20:00',
  session_minutes  INTEGER NOT NULL DEFAULT 15,    -- бюджет времени: 10 | 15 | 20 | 25
  mini_reminders   INTEGER NOT NULL DEFAULT 0,     -- напоминать про /mini днём
  height_cm        INTEGER,
  weight_kg        REAL,
  birth_year       INTEGER,
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
  swap_group  TEXT NOT NULL              -- упражнения одной swap_group взаимозаменяемы
);

CREATE INDEX idx_exercises_chain ON exercises(chain, chain_level);
CREATE INDEX idx_exercises_swap ON exercises(swap_group);

-- Лестницы прогрессии из docs/06-exercise-library.md.
-- Ступень — это не всегда другое упражнение: иногда тот же код с другим темпом
-- или положением тела (ADR-011). Поэтому лестница живёт отдельной таблицей,
-- а не выводится из exercises.chain_level.
CREATE TABLE chain_steps (
  chain         TEXT NOT NULL,           -- push | row | squat | hinge | core
  level         INTEGER NOT NULL,        -- 1 = легче всего
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  variant       TEXT,                    -- «с колен», «ноги прямые» — уточнение к упражнению
  tempo         TEXT NOT NULL DEFAULT 'normal',  -- normal | slow | pause
  load_hint     TEXT,                    -- bodyweight | kb_light | kb_main | kb_heavy | backpack
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
  optional    INTEGER NOT NULL DEFAULT 0 -- суббота по желанию: пропуск не рвёт серию
);

CREATE UNIQUE INDEX idx_templates_weekday ON templates(weekday);

CREATE TABLE template_items (
  template_code TEXT NOT NULL REFERENCES templates(code),
  position      INTEGER NOT NULL,
  exercise_code TEXT NOT NULL REFERENCES exercises(code),
  block         TEXT NOT NULL,           -- neck | main | posture | mobility | circuit | walk
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
  chain         TEXT NOT NULL,           -- push | row | squat | hinge | core
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
  user_id   INTEGER NOT NULL REFERENCES users(telegram_id),
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
