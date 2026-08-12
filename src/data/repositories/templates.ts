import { all, bool, one } from '../db';
import type { Chain, DayTemplate, TemplateItem } from '../../domain/types';

interface TemplateRow {
  code: string;
  title: string;
  weekday: number;
  intensity: string;
  est_minutes: number;
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
    `SELECT code, title, weekday, intensity, est_minutes, optional
       FROM templates WHERE weekday = ? AND kind = 'day'`,
    weekday,
  );
  return template === null ? null : withItems(db, template);
}

/** Шаблон по коду: день восстановления и микро-блоки берутся именно так. */
export async function loadTemplate(db: D1Database, code: string): Promise<DayTemplate | null> {
  const template = await one<TemplateRow>(
    db,
    `SELECT code, title, weekday, intensity, est_minutes, optional FROM templates WHERE code = ?`,
    code,
  );
  return template === null ? null : withItems(db, template);
}

export async function loadMiniBlocks(db: D1Database): Promise<{ code: string; title: string }[]> {
  return all<{ code: string; title: string }>(
    db,
    `SELECT code, title FROM templates WHERE kind = 'mini' ORDER BY code`,
  );
}

async function withItems(db: D1Database, template: TemplateRow): Promise<DayTemplate> {
  const items = await all<TemplateItemRow>(
    db,
    `SELECT position, exercise_code, block, follow_chain, sets,
            target_min, target_max, rest_sec, load_hint, optional
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
    estMinutes: template.est_minutes,
    optional: bool(template.optional),
    items: items.map((row): TemplateItem => ({
      position: row.position,
      exerciseCode: row.exercise_code,
      block: row.block as TemplateItem['block'],
      followChain: row.follow_chain as Chain | null,
      sets: row.sets,
      targetMin: row.target_min,
      targetMax: row.target_max,
      restSec: row.rest_sec,
      loadHint: row.load_hint as TemplateItem['loadHint'],
      optional: bool(row.optional),
    })),
  };
}
