-- M6: демонстрации к упражнениям.
--
-- Отдельная таблица, а не колонка в `exercises`: справочник целиком пересобирается
-- сидом (`data/seed.generated.sql` начинается с DELETE), и колонка терялась бы при
-- каждом добавлении упражнения.
--
-- Хранится только идентификатор файла в Telegram: гифка загружается один раз,
-- дальше отправляется по `file_id` бесконечно и бесплатно. Своего хостинга нет —
-- не-цель из docs/00-vision.md соблюдена (ADR-014).
CREATE TABLE exercise_media (
  exercise_code TEXT PRIMARY KEY REFERENCES exercises(code),
  file_id       TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'animation', -- animation | photo | video
  added_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
