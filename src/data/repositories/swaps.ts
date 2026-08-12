import { all, run } from '../db';

/** Ручные замены, действующие на указанную дату: `until = NULL` — навсегда (docs/06). */
export async function loadSwaps(
  db: D1Database,
  telegramId: number,
  localDate: string,
): Promise<Map<string, string>> {
  const rows = await all<{ from_code: string; to_code: string }>(
    db,
    `SELECT from_code, to_code FROM swaps
      WHERE user_id = ? AND (until IS NULL OR until >= ?)`,
    telegramId,
    localDate,
  );
  return new Map(rows.map((row) => [row.from_code, row.to_code]));
}

export async function saveSwap(
  db: D1Database,
  telegramId: number,
  fromCode: string,
  toCode: string,
  until: string | null,
): Promise<void> {
  await run(
    db,
    `INSERT INTO swaps (user_id, from_code, to_code, until) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, from_code) DO UPDATE SET
        to_code = excluded.to_code,
        until   = excluded.until`,
    telegramId,
    fromCode,
    toCode,
    until,
  );
}
