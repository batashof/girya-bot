-- ADR-018: время тренировки больше не планируется и не ограничивается.
-- Бюджет минут у пользователя и оценка минут у шаблона не нужны; напоминания
-- о микро-блоках убраны ещё в ADR-017. Комплексы (kind = 'complex') получают
-- короткую пометку «для чего».
ALTER TABLE users DROP COLUMN session_minutes;
ALTER TABLE users DROP COLUMN mini_reminders;
ALTER TABLE templates DROP COLUMN est_minutes;
ALTER TABLE templates ADD COLUMN note TEXT;
