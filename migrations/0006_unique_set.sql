-- Один подход — одна строка.
--
-- Уникального ключа не было, и повторное нажатие кнопки (например, когда карточка
-- ушла, а состояние не сохранилось) писало дубликат. Прогрессия считает выполнение
-- по числу записанных подходов, поэтому дубликаты искажают и её, и статистику.
DELETE FROM session_sets
 WHERE id NOT IN (
   SELECT min(id) FROM session_sets GROUP BY session_id, position, set_index
 );

CREATE UNIQUE INDEX idx_session_sets_slot ON session_sets (session_id, position, set_index);
