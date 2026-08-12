import { all, run } from '../db';
import { isNeckScore } from '../../domain/adaptation';
import type { SessionSummary } from '../../domain/stats';

interface SummaryRow {
  local_date: string;
  kind: string;
  status: string;
  neck_score: number | null;
  minutes: number | null;
}

/** Логи для агрегации. Считаем минуты прямо в запросе — хранить их отдельно незачем. */
export async function loadSessionSummaries(
  db: D1Database,
  telegramId: number,
  from: string,
): Promise<SessionSummary[]> {
  const rows = await all<SummaryRow>(
    db,
    `SELECT local_date, kind, status, neck_score,
            CAST(ROUND((julianday(finished_at) - julianday(started_at)) * 24 * 60) AS INTEGER) minutes
       FROM sessions
      WHERE user_id = ? AND local_date >= ?
      ORDER BY local_date`,
    telegramId,
    from,
  );

  return rows.map((row) => ({
    date: row.local_date,
    kind: row.kind === 'mini' ? 'mini' : 'main',
    status: row.status as SessionSummary['status'],
    minutes: row.minutes,
    neckScore: row.neck_score !== null && isNeckScore(row.neck_score) ? row.neck_score : null,
  }));
}

/** Минимальный аудит: что и когда бот посчитал изменившимся (docs/02-architecture.md). */
export async function logEvent(
  db: D1Database,
  telegramId: number,
  kind: string,
  payload: unknown,
): Promise<void> {
  await run(
    db,
    `INSERT INTO events (user_id, kind, payload) VALUES (?, ?, ?)`,
    telegramId,
    kind,
    JSON.stringify(payload),
  );
}

export interface LevelChange {
  chain: string;
  from: string;
  to: string;
}

/**
 * Изменения ступеней за период. История прогрессии не хранится отдельной таблицей —
 * `progression` держит только текущее состояние, поэтому «что изменилось за неделю»
 * читается из журнала событий.
 */
export async function levelChangesSince(
  db: D1Database,
  telegramId: number,
  since: string,
): Promise<LevelChange[]> {
  const rows = await all<{ payload: string }>(
    db,
    `SELECT payload FROM events
      WHERE user_id = ? AND kind = 'level_change' AND created_at >= ?
      ORDER BY created_at`,
    telegramId,
    since,
  );

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload) as LevelChange];
    } catch {
      return [];
    }
  });
}

/** Полная выгрузка подходов для `/export`. */
export async function exportRows(
  db: D1Database,
  telegramId: number,
): Promise<Record<string, string | number | null>[]> {
  return all<Record<string, string | number | null>>(
    db,
    `SELECT s.local_date, s.kind, s.status, s.template_code, s.week_in_block, s.neck_score,
            s.started_at, s.finished_at,
            t.position, t.exercise_code, t.set_index, t.target_value, t.actual_value,
            t.weight, t.side, t.feedback
       FROM sessions s
       LEFT JOIN session_sets t ON t.session_id = s.id
      WHERE s.user_id = ?
      ORDER BY s.local_date, s.id, t.position, t.set_index`,
    telegramId,
  );
}
