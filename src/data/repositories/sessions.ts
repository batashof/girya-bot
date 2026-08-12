import { all, one, run } from '../db';
import type { Feedback, SetRecord } from '../../domain/types';

export interface Session {
  id: number;
  localDate: string;
  templateCode: string;
  weekInBlock: number;
  status: 'planned' | 'in_progress' | 'done' | 'skipped';
  startedAt: string | null;
  finishedAt: string | null;
}

interface SessionRow {
  id: number;
  local_date: string;
  template_code: string;
  week_in_block: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function getMainSession(
  db: D1Database,
  telegramId: number,
  localDate: string,
): Promise<Session | null> {
  const row = await one<SessionRow>(
    db,
    `SELECT id, local_date, template_code, week_in_block, status, started_at, finished_at
       FROM sessions
      WHERE user_id = ? AND local_date = ? AND kind = 'main'`,
    telegramId,
    localDate,
  );
  return row === null ? null : toSession(row);
}

/**
 * Основная тренировка дня. Уникальный индекс по (user_id, local_date) при kind = 'main'
 * гарантирует, что второй `/go` продолжит начатую, а не заведёт вторую (docs/03).
 */
export async function startMainSession(
  db: D1Database,
  telegramId: number,
  session: { localDate: string; templateCode: string; weekInBlock: number },
): Promise<Session> {
  const existing = await getMainSession(db, telegramId, session.localDate);
  if (existing !== null) {
    if (existing.status === 'planned') {
      await run(
        db,
        `UPDATE sessions SET status = 'in_progress', started_at = datetime('now') WHERE id = ?`,
        existing.id,
      );
      return { ...existing, status: 'in_progress' };
    }
    return existing;
  }

  await run(
    db,
    `INSERT INTO sessions (user_id, local_date, template_code, kind, week_in_block, status, started_at)
          VALUES (?, ?, ?, 'main', ?, 'in_progress', datetime('now'))`,
    telegramId,
    session.localDate,
    session.templateCode,
    session.weekInBlock,
  );

  const created = await getMainSession(db, telegramId, session.localDate);
  if (created === null) {
    throw new Error('Сессия не создалась');
  }
  return created;
}

/**
 * Каждый подход пишется сразу, а не в конце: падение воркера посреди тренировки
 * не должно стоить тренировки (CLAUDE.md).
 */
export async function recordSets(
  db: D1Database,
  sessionId: number,
  records: SetRecord[],
  weight: number | null,
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await db.batch(
    records.map((record) =>
      db
        .prepare(
          `INSERT INTO session_sets
             (session_id, position, exercise_code, set_index, target_value, actual_value, weight, feedback)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          record.position,
          record.exerciseCode,
          record.setIndex,
          record.targetValue,
          record.actualValue,
          weight,
          record.feedback,
        ),
    ),
  );
}

export async function loadSets(db: D1Database, sessionId: number): Promise<SetRecord[]> {
  const rows = await all<{
    position: number;
    exercise_code: string;
    set_index: number;
    target_value: number;
    actual_value: number | null;
    feedback: string | null;
  }>(
    db,
    `SELECT position, exercise_code, set_index, target_value, actual_value, feedback
       FROM session_sets WHERE session_id = ? ORDER BY position, set_index`,
    sessionId,
  );

  return rows.map((row) => ({
    position: row.position,
    exerciseCode: row.exercise_code,
    setIndex: row.set_index,
    targetValue: row.target_value,
    actualValue: row.actual_value,
    feedback: (row.feedback ?? 'ok') as Feedback,
  }));
}

export async function finishSession(db: D1Database, sessionId: number): Promise<number> {
  await run(
    db,
    `UPDATE sessions SET status = 'done', finished_at = datetime('now') WHERE id = ?`,
    sessionId,
  );
  const row = await one<{ minutes: number | null }>(
    db,
    // Округляем, а не отбрасываем дробь: 13.9 минуты — это четырнадцать, а не тринадцать.
    `SELECT CAST(ROUND((julianday(finished_at) - julianday(started_at)) * 24 * 60) AS INTEGER) minutes
       FROM sessions WHERE id = ?`,
    sessionId,
  );
  return row?.minutes ?? 0;
}

export async function skipSession(db: D1Database, sessionId: number): Promise<void> {
  await run(db, `UPDATE sessions SET status = 'skipped' WHERE id = ?`, sessionId);
}

/**
 * Серия — сколько дней подряд, считая назад от сегодня, есть выполненная основная
 * тренировка. Микро-сессии не считаются (ADR-013). «Заморозка» пропуска — M4.
 */
export async function countStreak(
  db: D1Database,
  telegramId: number,
  today: string,
): Promise<number> {
  const rows = await all<{ local_date: string }>(
    db,
    `SELECT local_date FROM sessions
      WHERE user_id = ? AND kind = 'main' AND status = 'done' AND local_date <= ?
      ORDER BY local_date DESC
      LIMIT 400`,
    telegramId,
    today,
  );

  const done = new Set(rows.map((row) => row.local_date));
  let streak = 0;
  let cursor = today;
  while (done.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    localDate: row.local_date,
    templateCode: row.template_code,
    weekInBlock: row.week_in_block,
    status: row.status as Session['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
