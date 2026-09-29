import { all, bool } from '../db';
import type { Chain, ChainStep, Exercise } from '../../domain/types';

interface ExerciseRow {
  code: string;
  name: string;
  group_code: string;
  pattern: string;
  equipment: string;
  chain: string | null;
  chain_level: number | null;
  unit: string;
  unilateral: number;
  cues: string;
  mistakes: string | null;
  video_url: string | null;
  neck_safe: number;
  swap_group: string;
  dose_sets: number;
  dose_reps: number;
  dose_rest_sec: number;
  rep_sec: number;
  rep_note: string | null;
}

interface ChainStepRow {
  chain: string;
  level: number;
  exercise_code: string;
  variant: string | null;
  tempo: string;
  load_hint: string | null;
  requires: string | null;
  target_min: number;
  target_max: number;
  rep_sec: number | null;
  rep_note: string | null;
}

/** Справочник целиком: 61 строка, читать его по одной незачем. */
export async function loadExercises(db: D1Database): Promise<Map<string, Exercise>> {
  const rows = await all<ExerciseRow>(
    db,
    `SELECT code, name, group_code, pattern, equipment, chain, chain_level,
            unit, unilateral, cues, mistakes, video_url, neck_safe, swap_group,
            dose_sets, dose_reps, dose_rest_sec, rep_sec, rep_note
       FROM exercises`,
  );

  const map = new Map<string, Exercise>();
  for (const row of rows) {
    map.set(row.code, {
      code: row.code,
      name: row.name,
      groupCode: row.group_code,
      pattern: row.pattern,
      equipment: row.equipment as Exercise['equipment'],
      chain: row.chain as Chain | null,
      chainLevel: row.chain_level,
      unit: row.unit as Exercise['unit'],
      unilateral: bool(row.unilateral),
      cues: row.cues,
      mistakes: row.mistakes,
      videoUrl: row.video_url,
      neckSafe: bool(row.neck_safe),
      swapGroup: row.swap_group,
      dose: { sets: row.dose_sets, reps: row.dose_reps, restSec: row.dose_rest_sec },
      repSec: row.rep_sec,
      repNote: row.rep_note,
    });
  }
  return map;
}

export async function loadChainSteps(db: D1Database): Promise<ChainStep[]> {
  const rows = await all<ChainStepRow>(
    db,
    `SELECT chain, level, exercise_code, variant, tempo, load_hint, requires, target_min, target_max,
            rep_sec, rep_note
       FROM chain_steps
      ORDER BY chain, level`,
  );

  return rows.map((row) => ({
    chain: row.chain as Chain,
    level: row.level,
    exerciseCode: row.exercise_code,
    variant: row.variant,
    tempo: row.tempo as ChainStep['tempo'],
    loadHint: row.load_hint as ChainStep['loadHint'],
    requires: row.requires as ChainStep['requires'],
    targetMin: row.target_min,
    targetMax: row.target_max,
    repSec: row.rep_sec,
    repNote: row.rep_note,
  }));
}
