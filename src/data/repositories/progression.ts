import { all } from '../db';
import { startingLevels } from '../../domain/progression';
import type { Chain, ChainStep, ProgressionState, UserProfile } from '../../domain/types';

interface ProgressionRow {
  chain: string;
  exercise_code: string;
  chain_level: number;
  tempo: string;
  weight: number | null;
  current_reps: number;
  hard_streak: number;
  easy_streak: number;
}

export async function loadProgression(
  db: D1Database,
  telegramId: number,
): Promise<Map<Chain, ProgressionState>> {
  const rows = await all<ProgressionRow>(
    db,
    `SELECT chain, exercise_code, chain_level, tempo, weight, current_reps, hard_streak, easy_streak
       FROM progression WHERE user_id = ?`,
    telegramId,
  );

  const map = new Map<Chain, ProgressionState>();
  for (const row of rows) {
    const chain = row.chain as Chain;
    map.set(chain, {
      chain,
      exerciseCode: row.exercise_code,
      chainLevel: row.chain_level,
      tempo: row.tempo as ProgressionState['tempo'],
      weight: row.weight,
      currentReps: row.current_reps,
      hardStreak: row.hard_streak,
      easyStreak: row.easy_streak,
    });
  }
  return map;
}

export async function saveProgression(
  db: D1Database,
  telegramId: number,
  states: ProgressionState[],
): Promise<void> {
  const statements = states.map((state) =>
    db
      .prepare(
        `INSERT INTO progression (user_id, chain, exercise_code, chain_level, tempo, weight,
                                  current_reps, hard_streak, easy_streak)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, chain) DO UPDATE SET
              exercise_code = excluded.exercise_code,
              chain_level   = excluded.chain_level,
              tempo         = excluded.tempo,
              weight        = excluded.weight,
              current_reps  = excluded.current_reps,
              hard_streak   = excluded.hard_streak,
              easy_streak   = excluded.easy_streak,
              updated_at    = datetime('now')`,
      )
      .bind(
        telegramId,
        state.chain,
        state.exerciseCode,
        state.chainLevel,
        state.tempo,
        state.weight,
        state.currentReps,
        state.hardStreak,
        state.easyStreak,
      ),
  );
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function initProgression(
  db: D1Database,
  telegramId: number,
  user: UserProfile,
  chainSteps: ChainStep[],
): Promise<void> {
  await saveProgression(db, telegramId, startingLevels(user, chainSteps));
}
