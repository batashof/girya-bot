/**
 * Загрузка реального контента из data/*.seed.json в доменные типы.
 * Тесты гоняются по тому же содержимому, что уезжает в базу, — иначе они проверяли бы
 * выдуманную программу, а не ту, по которой я тренируюсь.
 */
import exercisesSeed from '../data/exercises.seed.json';
import chainsSeed from '../data/chains.seed.json';
import templatesSeed from '../data/templates.seed.json';
import type {
  Chain,
  ChainStep,
  DayTemplate,
  Exercise,
  ProgressionState,
  TemplateItem,
  UserProfile,
} from '../src/domain/types';

type RawExercise = (typeof exercisesSeed)[number];
type RawStep = {
  level: number;
  exercise: string;
  variant?: string | null;
  tempo?: string;
  load_hint?: string | null;
  requires?: string | null;
  target_min: number;
  target_max: number;
};
type RawItem = {
  protocol?: string;
  exercise?: string;
  block?: string;
  follow_chain?: string;
  sets?: number;
  target_min?: number;
  target_max?: number;
  rest_sec?: number;
  load_hint?: string | null;
  optional?: number;
};

export function loadExercises(): Map<string, Exercise> {
  const map = new Map<string, Exercise>();
  for (const raw of exercisesSeed as RawExercise[]) {
    map.set(raw.code, {
      code: raw.code,
      name: raw.name,
      groupCode: raw.group_code,
      pattern: raw.pattern,
      equipment: raw.equipment as Exercise['equipment'],
      chain: (raw.chain ?? null) as Chain | null,
      chainLevel: raw.chain_level ?? null,
      unit: raw.unit as Exercise['unit'],
      unilateral: raw.unilateral === 1,
      cues: raw.cues,
      mistakes: raw.mistakes ?? null,
      videoUrl: null,
      neckSafe: raw.neck_safe === 1,
      swapGroup: raw.swap_group,
    });
  }
  return map;
}

export function loadChainSteps(): ChainStep[] {
  const steps: ChainStep[] = [];
  for (const [chain, raw] of Object.entries(chainsSeed)) {
    if (chain.startsWith('_')) {
      continue;
    }
    for (const step of raw as RawStep[]) {
      steps.push({
        chain: chain as Chain,
        level: step.level,
        exerciseCode: step.exercise,
        variant: step.variant ?? null,
        tempo: (step.tempo ?? 'normal') as ChainStep['tempo'],
        loadHint: (step.load_hint ?? null) as ChainStep['loadHint'],
        requires: (step.requires ?? null) as ChainStep['requires'],
        targetMin: step.target_min,
        targetMax: step.target_max,
      });
    }
  }
  return steps;
}

export function loadTemplates(): DayTemplate[] {
  const protocols = templatesSeed.protocols as Record<string, RawItem[]>;
  return templatesSeed.templates.map((raw) => {
    const expanded = (raw.items as RawItem[]).flatMap((item) =>
      item.protocol === undefined ? [item] : (protocols[item.protocol] ?? []),
    );
    const items: TemplateItem[] = expanded.map((item, index) => ({
      position: index + 1,
      exerciseCode: item.exercise ?? '',
      block: item.block as TemplateItem['block'],
      followChain: (item.follow_chain ?? null) as Chain | null,
      sets: item.sets ?? 1,
      targetMin: item.target_min ?? 0,
      targetMax: item.target_max ?? 0,
      restSec: item.rest_sec ?? 60,
      loadHint: (item.load_hint ?? null) as TemplateItem['loadHint'],
      optional: item.optional === 1,
    }));
    return {
      code: raw.code,
      title: raw.title,
      weekday: raw.weekday,
      intensity: raw.intensity as DayTemplate['intensity'],
      estMinutes: raw.est_minutes,
      optional: raw.optional === 1,
      items,
    };
  });
}

export function templateFor(weekday: number): DayTemplate {
  const template = loadTemplates().find((candidate) => candidate.weekday === weekday);
  if (template === undefined) {
    throw new Error(`Нет шаблона на день недели ${weekday}`);
  }
  return template;
}

/** Стартовая конфигурация из docs/05: 190 см, 73 кг, пара пятёрок, 15 минут. */
export function defaultUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    timezone: 'Europe/Warsaw',
    sessionMinutes: 15,
    heightCm: 190,
    level: 'base',
    hasPullupBar: false,
    hasBand: false,
    hasBackpack: true,
    kettlebells: [{ weight: 5, count: 2 }],
    blockStart: '2026-08-03',
    ...overrides,
  };
}

/** Прогрессия на первой ступени каждой лестницы, как после онбординга. */
export function baseProgression(
  overrides: Partial<Record<Chain, Partial<ProgressionState>>> = {},
): Map<Chain, ProgressionState> {
  const steps = loadChainSteps();
  const map = new Map<Chain, ProgressionState>();
  for (const chain of ['push', 'row', 'squat', 'hinge', 'core'] as Chain[]) {
    const first = steps.find((step) => step.chain === chain && step.level === 1);
    if (first === undefined) {
      continue;
    }
    map.set(chain, {
      chain,
      exerciseCode: first.exerciseCode,
      chainLevel: first.level,
      tempo: first.tempo,
      weight: null,
      currentReps: first.targetMin,
      hardStreak: 0,
      easyStreak: 0,
      ...overrides[chain],
    });
  }
  return map;
}
