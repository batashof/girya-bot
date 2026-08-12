import { all, run } from '../db';
import type { ReminderKind } from '../../domain/reminders';

/** Что уже отправлено сегодня. Дедупликация нужна: cron просыпается каждые 5 минут. */
export async function sentToday(
  db: D1Database,
  telegramId: number,
  localDate: string,
): Promise<Set<ReminderKind>> {
  const rows = await all<{ kind: string }>(
    db,
    `SELECT kind FROM reminders_log WHERE user_id = ? AND local_date = ?`,
    telegramId,
    localDate,
  );
  return new Set(rows.map((row) => row.kind as ReminderKind));
}

export async function markSent(
  db: D1Database,
  telegramId: number,
  localDate: string,
  kind: ReminderKind,
): Promise<void> {
  await run(
    db,
    `INSERT INTO reminders_log (user_id, local_date, kind) VALUES (?, ?, ?)
     ON CONFLICT (user_id, local_date, kind) DO NOTHING`,
    telegramId,
    localDate,
    kind,
  );
}

/** Отмена отметки — чтобы отложенное «через час» напоминание пришло второй раз. */
export async function unmarkSent(
  db: D1Database,
  telegramId: number,
  localDate: string,
  kind: ReminderKind,
): Promise<void> {
  await run(
    db,
    `DELETE FROM reminders_log WHERE user_id = ? AND local_date = ? AND kind = ?`,
    telegramId,
    localDate,
    kind,
  );
}
