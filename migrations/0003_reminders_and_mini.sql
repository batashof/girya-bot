-- M4: напоминания, микро-блоки и адаптация дня.

-- Перенос утреннего напоминания на час — кнопка из docs/04-bot-ux.md.
-- Момент в UTC: сравнивать его с расписанием проще, чем городить локальные смещения.
ALTER TABLE users ADD COLUMN snooze_until TEXT;

-- Начало паузы. Без него из `paused_until` не восстановить, какие дни серия должна
-- простить: пауза — это диапазон, а не дедлайн (docs/04, «/pause 3»).
ALTER TABLE users ADD COLUMN paused_from TEXT;

-- Микро-блоки (/mini) — такой же контент, как дни недели, и живут в тех же таблицах:
-- отдельная пара таблиц ради трёх блоков по три упражнения себя не окупает.
-- День недели у них 0, поэтому уникальность «один шаблон на день» становится частичной.
ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'day';  -- day | mini

DROP INDEX idx_templates_weekday;
CREATE UNIQUE INDEX idx_templates_weekday ON templates(weekday) WHERE kind = 'day';
