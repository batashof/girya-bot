-- Инвентаря, кроме гирь, нет.
--
-- Рюкзак с книгами стоял в умолчаниях как «регулируемый вес», но умолчание «есть»
-- заставляет программу планировать то, чего у человека нет. Теперь всё необязательное
-- выключено по умолчанию и включается в /settings → Инвентарь.
--
-- В SQLite нельзя поменять DEFAULT колонки, поэтому таблица пересобирается. Колонки
-- перечислены явно: после ALTER-ов из 0002 их физический порядок не совпадает с 0001.
ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
  telegram_id      INTEGER PRIMARY KEY,
  timezone         TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  remind_at        TEXT NOT NULL DEFAULT '07:30',
  evening_ping_at  TEXT             DEFAULT '20:00',
  session_minutes  INTEGER NOT NULL DEFAULT 15,
  mini_reminders   INTEGER NOT NULL DEFAULT 0,
  height_cm        INTEGER,
  weight_kg        REAL,
  birth_year       INTEGER,
  level            TEXT NOT NULL DEFAULT 'base',
  has_pullup_bar   INTEGER NOT NULL DEFAULT 0,
  has_band         INTEGER NOT NULL DEFAULT 0,
  has_backpack     INTEGER NOT NULL DEFAULT 0,
  block_start      TEXT NOT NULL,
  paused_from      TEXT,
  paused_until     TEXT,
  snooze_until     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users (
  telegram_id, timezone, remind_at, evening_ping_at, session_minutes, mini_reminders,
  height_cm, weight_kg, birth_year, level, has_pullup_bar, has_band, has_backpack,
  block_start, paused_from, paused_until, snooze_until, created_at
)
SELECT
  telegram_id, timezone, remind_at, evening_ping_at, session_minutes, mini_reminders,
  height_cm, weight_kg, birth_year, level, has_pullup_bar, has_band, has_backpack,
  block_start, paused_from, paused_until, snooze_until, created_at
FROM users_old;

DROP TABLE users_old;

-- У единственного пользователя реквизита нет вовсе: только пара гирь.
UPDATE users SET has_pullup_bar = 0, has_band = 0, has_backpack = 0;
