import { one, run } from '../db';

export interface UiState<T> {
  screen: string;
  payload: T;
}

/**
 * Чего бот ждёт от пользователя прямо сейчас. Нужно там, где ответ приходит текстом:
 * рост/вес/возраст в онбординге, фактическое число повторов в пошаговом режиме.
 */
export async function getUiState<T>(
  db: D1Database,
  telegramId: number,
): Promise<UiState<T> | null> {
  const row = await one<{ screen: string; payload: string }>(
    db,
    `SELECT screen, payload FROM ui_state WHERE user_id = ?`,
    telegramId,
  );
  if (row === null) {
    return null;
  }
  return { screen: row.screen, payload: JSON.parse(row.payload) as T };
}

export async function setUiState<T>(
  db: D1Database,
  telegramId: number,
  screen: string,
  payload: T,
): Promise<void> {
  await run(
    db,
    `INSERT INTO ui_state (user_id, screen, payload) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
        screen = excluded.screen,
        payload = excluded.payload,
        updated_at = datetime('now')`,
    telegramId,
    screen,
    JSON.stringify(payload),
  );
}

export async function clearUiState(db: D1Database, telegramId: number): Promise<void> {
  await run(db, `DELETE FROM ui_state WHERE user_id = ?`, telegramId);
}
