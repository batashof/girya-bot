import { all, one, run } from '../db';

export type MediaSource = 'user' | 'builtin';

export interface ExerciseMedia {
  exerciseCode: string;
  fileId: string;
  kind: 'animation' | 'photo' | 'video';
  source: MediaSource;
}

interface MediaRow {
  exercise_code: string;
  file_id: string;
  kind: string;
  source: string;
}

/**
 * Демонстрации к упражнениям. Храним только `file_id`: файл лежит у Telegram,
 * загружается один раз и отправляется повторно бесплатно (ADR-014).
 */
export async function getMedia(
  db: D1Database,
  exerciseCode: string,
): Promise<ExerciseMedia | null> {
  const row = await one<MediaRow>(
    db,
    `SELECT exercise_code, file_id, kind, source FROM exercise_media WHERE exercise_code = ?`,
    exerciseCode,
  );
  return row === null ? null : toMedia(row);
}

/** Все демонстрации разом: карточкам тренировки нужен весь день, а не по одной. */
export async function loadMedia(db: D1Database): Promise<Map<string, ExerciseMedia>> {
  const rows = await all<MediaRow>(
    db,
    `SELECT exercise_code, file_id, kind, source FROM exercise_media`,
  );
  return new Map(rows.map((row) => [row.exercise_code, toMedia(row)]));
}

export async function saveMedia(db: D1Database, media: ExerciseMedia): Promise<void> {
  await run(
    db,
    `INSERT INTO exercise_media (exercise_code, file_id, kind, source) VALUES (?, ?, ?, ?)
     ON CONFLICT (exercise_code) DO UPDATE SET
        file_id  = excluded.file_id,
        kind     = excluded.kind,
        source   = excluded.source,
        added_at = datetime('now')`,
    media.exerciseCode,
    media.fileId,
    media.kind,
    media.source,
  );
}

/**
 * Запомнить `file_id` только что отправленной встроенной схемы. Свою присланную гифку
 * такой кеш не трогает: `/gif` сильнее схемы из бандла.
 */
export async function cacheBuiltinMedia(
  db: D1Database,
  exerciseCode: string,
  fileId: string,
): Promise<void> {
  await run(
    db,
    `INSERT INTO exercise_media (exercise_code, file_id, kind, source)
     VALUES (?, ?, 'animation', 'builtin')
     ON CONFLICT (exercise_code) DO UPDATE SET
        file_id  = excluded.file_id,
        added_at = datetime('now')
     WHERE exercise_media.source = 'builtin'`,
    exerciseCode,
    fileId,
  );
}

export async function deleteMedia(db: D1Database, exerciseCode: string): Promise<void> {
  await run(db, `DELETE FROM exercise_media WHERE exercise_code = ?`, exerciseCode);
}

/** Коды упражнений, у которых уже есть своя присланная демонстрация. */
export async function codesWithMedia(db: D1Database): Promise<Set<string>> {
  const rows = await all<{ exercise_code: string }>(
    db,
    `SELECT exercise_code FROM exercise_media WHERE source = 'user'`,
  );
  return new Set(rows.map((row) => row.exercise_code));
}

function toMedia(row: MediaRow): ExerciseMedia {
  return {
    exerciseCode: row.exercise_code,
    fileId: row.file_id,
    kind: row.kind as ExerciseMedia['kind'],
    source: row.source === 'builtin' ? 'builtin' : 'user',
  };
}
