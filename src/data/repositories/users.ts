import { all, bool, one, run } from '../db';
import { STARTER_KETTLEBELLS } from '../starter';
import type { Kettlebell, User } from '../../domain/types';

interface UserRow {
  telegram_id: number;
  timezone: string;
  remind_at: string;
  evening_ping_at: string | null;
  session_minutes: number;
  mini_reminders: number;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  level: string;
  has_pullup_bar: number;
  has_band: number;
  has_backpack: number;
  block_start: string;
  paused_from: string | null;
  paused_until: string | null;
  snooze_until: string | null;
}

export async function getUser(db: D1Database, telegramId: number): Promise<User | null> {
  const row = await one<UserRow>(db, `SELECT * FROM users WHERE telegram_id = ?`, telegramId);
  if (row === null) {
    return null;
  }
  const kettlebells = await getKettlebells(db, telegramId);
  return {
    telegramId: row.telegram_id,
    timezone: row.timezone,
    remindAt: row.remind_at,
    eveningPingAt: row.evening_ping_at,
    sessionMinutes: row.session_minutes,
    miniReminders: bool(row.mini_reminders),
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    birthYear: row.birth_year,
    level: row.level === 'strong' ? 'strong' : 'base',
    hasPullupBar: bool(row.has_pullup_bar),
    hasBand: bool(row.has_band),
    hasBackpack: bool(row.has_backpack),
    kettlebells,
    blockStart: row.block_start,
    pausedFrom: row.paused_from,
    pausedUntil: row.paused_until,
    snoozeUntil: row.snooze_until,
  };
}

/**
 * Создаёт пользователя со стартовой конфигурацией, если его ещё нет.
 * Умолчания берутся из схемы — здесь задаётся только то, чего SQLite сам не знает.
 */
export async function ensureUser(db: D1Database, telegramId: number, today: string): Promise<User> {
  const existing = await getUser(db, telegramId);
  if (existing !== null) {
    return existing;
  }

  await run(db, `INSERT INTO users (telegram_id, block_start) VALUES (?, ?)`, telegramId, today);
  await setKettlebells(db, telegramId, [...STARTER_KETTLEBELLS]);

  const created = await getUser(db, telegramId);
  if (created === null) {
    throw new Error('Пользователь не создался');
  }
  return created;
}

/** Поля, которые правит онбординг и `/settings`. Ключи — колонки, значения уже проверены. */
export interface UserPatch {
  timezone?: string;
  remind_at?: string;
  evening_ping_at?: string | null;
  session_minutes?: number;
  mini_reminders?: number;
  height_cm?: number;
  weight_kg?: number;
  birth_year?: number;
  level?: string;
  has_pullup_bar?: number;
  has_band?: number;
  has_backpack?: number;
  block_start?: string;
  paused_from?: string | null;
  paused_until?: string | null;
  snooze_until?: string | null;
}

export async function updateUser(
  db: D1Database,
  telegramId: number,
  patch: UserPatch,
): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
  const values = entries.map(([, value]) => value as string | number | null);
  await run(db, `UPDATE users SET ${assignments} WHERE telegram_id = ?`, ...values, telegramId);
}

/** Все пользователи — их один, но планировщику нужен список (ADR-005). */
export async function allUsers(db: D1Database): Promise<User[]> {
  const rows = await all<{ telegram_id: number }>(db, `SELECT telegram_id FROM users`);
  const users: User[] = [];
  for (const row of rows) {
    const user = await getUser(db, row.telegram_id);
    if (user !== null) {
      users.push(user);
    }
  }
  return users;
}

export async function getKettlebells(db: D1Database, telegramId: number): Promise<Kettlebell[]> {
  const rows = await all<{ weight: number; count: number }>(
    db,
    `SELECT weight, count FROM kettlebells WHERE user_id = ? ORDER BY weight`,
    telegramId,
  );
  return rows.map((row) => ({ weight: row.weight, count: row.count }));
}

export async function setKettlebells(
  db: D1Database,
  telegramId: number,
  bells: Kettlebell[],
): Promise<void> {
  const statements = [
    db.prepare(`DELETE FROM kettlebells WHERE user_id = ?`).bind(telegramId),
    ...bells.map((bell) =>
      db
        .prepare(`INSERT INTO kettlebells (user_id, weight, count) VALUES (?, ?, ?)`)
        .bind(telegramId, bell.weight, bell.count),
    ),
  ];
  await db.batch(statements);
}
