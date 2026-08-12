import { all, one, run } from '../db';

export interface ExerciseMedia {
  exerciseCode: string;
  fileId: string;
  kind: 'animation' | 'photo' | 'video';
}

/**
 * Демонстрации к упражнениям. Храним только `file_id`: файл лежит у Telegram,
 * загружается один раз и отправляется повторно бесплатно (ADR-014).
 */
export async function getMedia(
  db: D1Database,
  exerciseCode: string,
): Promise<ExerciseMedia | null> {
  const row = await one<{ exercise_code: string; file_id: string; kind: string }>(
    db,
    `SELECT exercise_code, file_id, kind FROM exercise_media WHERE exercise_code = ?`,
    exerciseCode,
  );
  return row === null
    ? null
    : {
        exerciseCode: row.exercise_code,
        fileId: row.file_id,
        kind: row.kind as ExerciseMedia['kind'],
      };
}

export async function saveMedia(db: D1Database, media: ExerciseMedia): Promise<void> {
  await run(
    db,
    `INSERT INTO exercise_media (exercise_code, file_id, kind) VALUES (?, ?, ?)
     ON CONFLICT (exercise_code) DO UPDATE SET
        file_id  = excluded.file_id,
        kind     = excluded.kind,
        added_at = datetime('now')`,
    media.exerciseCode,
    media.fileId,
    media.kind,
  );
}

export async function deleteMedia(db: D1Database, exerciseCode: string): Promise<void> {
  await run(db, `DELETE FROM exercise_media WHERE exercise_code = ?`, exerciseCode);
}

/** Коды упражнений, у которых уже есть демонстрация. */
export async function codesWithMedia(db: D1Database): Promise<Set<string>> {
  const rows = await all<{ exercise_code: string }>(db, `SELECT exercise_code FROM exercise_media`);
  return new Set(rows.map((row) => row.exercise_code));
}
