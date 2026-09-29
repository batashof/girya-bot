-- Понятная доза в карточке (ADR-017): повторы и время одного повтора, без «оценки на подход».
--
-- У каждого упражнения своя доза для выбора вне программы дня (тема, ADR-016): подходы,
-- повторы (у удержаний — сколько раз держать) и отдых. Плюс время одного повтора: у
-- удержания это и есть задание («держи 30 с»), у движения — темп («~4 с: 1 с вверх,
-- 3 с вниз»). Раньше время жило в тексте техники и спорило с заданием.
ALTER TABLE exercises ADD COLUMN dose_sets INTEGER NOT NULL DEFAULT 3;
ALTER TABLE exercises ADD COLUMN dose_reps INTEGER NOT NULL DEFAULT 10;
ALTER TABLE exercises ADD COLUMN dose_rest_sec INTEGER NOT NULL DEFAULT 45;
ALTER TABLE exercises ADD COLUMN rep_sec INTEGER NOT NULL DEFAULT 3;
ALTER TABLE exercises ADD COLUMN rep_note TEXT;

-- Ступень с темпом или паузой («темп 3-1-3», «пауза 2 с внизу») меняет время повтора.
ALTER TABLE chain_steps ADD COLUMN rep_sec INTEGER;
ALTER TABLE chain_steps ADD COLUMN rep_note TEXT;

-- У удержаний цель пункта — секунды одного удержания, а сколько их в подходе — здесь.
ALTER TABLE template_items ADD COLUMN holds INTEGER NOT NULL DEFAULT 1;
