import { all, bool, one } from '../db';
import type { Chain, Complex, DayTemplate, TemplateItem, Theme } from '../../domain/types';

interface TemplateRow {
  code: string;
  title: string;
  weekday: number;
  intensity: string;
  optional: number;
}

interface TemplateItemRow {
  position: number;
  exercise_code: string;
  block: string;
  follow_chain: string | null;
  sets: number;
  target_min: number;
  target_max: number;
  holds: number;
  rest_sec: number;
  load_hint: string | null;
  optional: number;
}

/** Шаблон дня недели: 1 = понедельник … 7 = воскресенье (ADR-006). */
export async function loadTemplateForWeekday(
  db: D1Database,
  weekday: number,
): Promise<DayTemplate | null> {
  const template = await one<TemplateRow>(
    db,
    `SELECT code, title, weekday, intensity, optional
       FROM templates WHERE weekday = ? AND kind = 'day'`,
    weekday,
  );
  return template === null ? null : withItems(db, template);
}

/** Шаблон по коду: день восстановления и комплексы берутся именно так. */
export async function loadTemplate(db: D1Database, code: string): Promise<DayTemplate | null> {
  const template = await one<TemplateRow>(
    db,
    `SELECT code, title, weekday, intensity, optional FROM templates WHERE code = ?`,
    code,
  );
  return template === null ? null : withItems(db, template);
}

/** Темы тренировки по запросу в порядке меню (ADR-016). */
export async function loadThemes(db: D1Database): Promise<Theme[]> {
  const rows = await all<{ code: string; title: string; group_code: string | null }>(
    db,
    `SELECT code, title, group_code FROM templates WHERE kind = 'theme' ORDER BY code`,
  );
  return rows.flatMap((row) =>
    row.group_code === null
      ? []
      : [{ code: row.code, title: row.title, groupCode: row.group_code }],
  );
}

/** Комплексы под конкретную проблему в порядке меню (ADR-018). Пункты — через `loadTemplate`. */
export async function loadComplexes(db: D1Database): Promise<Complex[]> {
  const rows = await all<{ code: string; title: string; note: string | null }>(
    db,
    `SELECT code, title, note FROM templates WHERE kind = 'complex' ORDER BY code`,
  );
  return rows.map((row) => ({ code: row.code, title: row.title, note: row.note ?? '' }));
}

async function withItems(db: D1Database, template: TemplateRow): Promise<DayTemplate> {
  const items = await all<TemplateItemRow>(
    db,
    `SELECT position, exercise_code, block, follow_chain, sets,
            target_min, target_max, holds, rest_sec, load_hint, optional
       FROM template_items
      WHERE template_code = ?
      ORDER BY position`,
    template.code,
  );

  return {
    code: template.code,
    title: template.title,
    weekday: template.weekday,
    intensity: template.intensity as DayTemplate['intensity'],
    optional: bool(template.optional),
    items: items.map(toItem),
  };
}

function toItem(row: TemplateItemRow): TemplateItem {
  return {
    position: row.position,
    exerciseCode: row.exercise_code,
    block: row.block as TemplateItem['block'],
    followChain: row.follow_chain as Chain | null,
    sets: row.sets,
    targetMin: row.target_min,
    targetMax: row.target_max,
    holds: row.holds,
    restSec: row.rest_sec,
    loadHint: row.load_hint as TemplateItem['loadHint'],
    optional: bool(row.optional),
  };
}
