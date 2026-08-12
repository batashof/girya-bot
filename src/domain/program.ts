import { NO_ADAPTATION, type Adaptation } from './adaptation';
import { daysBetween, type LocalDate } from './time';
import type {
  Chain,
  ChainStep,
  DayTemplate,
  Equipment,
  Exercise,
  LoadHint,
  PlannedItem,
  ProgressionState,
  TemplateItem,
  Unit,
  UserProfile,
  Workout,
} from './types';

/**
 * Резолвер дня: шаблон недели + лестницы + бюджет минут → конкретный набор подходов.
 * Чистая функция: те же входные данные — та же тренировка (ADR-003).
 */

export interface ResolveInput {
  date: LocalDate;
  template: DayTemplate;
  user: UserProfile;
  exercises: Map<string, Exercise>;
  chainSteps: ChainStep[];
  progression: Map<Chain, ProgressionState>;
  /** Ручные замены пользователя: код из плана → код, который он делает вместо (docs/06). */
  swaps: Map<string, string>;
  /** Поправка на боль в шее. По умолчанию — никакой. */
  adaptation?: Adaptation;
}

/** Очередь на вылет, когда день не влезает в бюджет: с конца списка (ADR-012). */
const BLOCK_PRIORITY = [
  'neck',
  'main',
  'circuit',
  'posture',
  'support',
  'mobility',
  'walk',
] as const;

/**
 * Шея и основное движение не режутся никогда: без них день теряет смысл (ADR-008, ADR-012).
 * Прогулка тоже: она не входит в бюджет утренних минут — это «10 минут + прогулка» (docs/05).
 */
const PROTECTED_BLOCKS = new Set(['neck', 'main', 'walk']);

/** Прогулка идёт вне бюджета, поэтому и в оценку длительности не попадает. */
const UNTIMED_BLOCKS = new Set(['walk']);

const DELOAD_MINUTES = 10;
const DELOAD_MAX_SETS = 2;

/** Секунд на повтор в обычном темпе. Грубая, но одинаковая для всех оценка. */
const SECONDS_PER_REP = 2;
const SECONDS_PER_STEP = 0.6;
const TEMPO_FACTOR: Record<string, number> = { normal: 1, slow: 1.6, pause: 1.3 };

/**
 * Номер недели в четырёхнедельном блоке: 1–3 рост, 4 — разгрузочная.
 * Считается от даты начала блока, поэтому пропуск дней ничего не сдвигает (ADR-006).
 */
export function weekInBlock(blockStart: LocalDate, date: LocalDate): number {
  const days = daysBetween(blockStart, date);
  if (days < 0) {
    return 1;
  }
  return (Math.floor(days / 7) % 4) + 1;
}

export function resolveWorkout(input: ResolveInput): Workout {
  const week = weekInBlock(input.user.blockStart, input.date);
  const deload = week === 4;
  const adaptation = input.adaptation ?? NO_ADAPTATION;
  const budgetMinutes = dayBudgetMinutes(input.template, input.user.sessionMinutes, deload);

  const planned: PlannedItem[] = [];
  const dropped: string[] = [];

  for (const item of input.template.items) {
    const resolved = resolveItem(item, input, deload, adaptation);
    if (resolved === null) {
      const missing = input.exercises.get(item.exerciseCode);
      dropped.push(missing?.name ?? item.exerciseCode);
      continue;
    }
    planned.push(resolved);
  }

  const { kept, cut } = trimToBudget(planned, budgetMinutes);
  dropped.push(...cut.map((item) => item.exercise.name));

  return {
    templateCode: input.template.code,
    title: input.template.title,
    weekInBlock: week,
    deload,
    optional: input.template.optional,
    items: kept.map((item, index) => ({ ...item, position: index + 1 })),
    estimatedMinutes: Math.round(totalSeconds(kept) / 60),
    dropped,
  };
}

function resolveItem(
  item: TemplateItem,
  input: ResolveInput,
  deload: boolean,
  adaptation: Adaptation,
): PlannedItem | null {
  const base = deload ? Math.min(item.sets, DELOAD_MAX_SETS) : item.sets;
  const sets = Math.max(1, Math.round(base * adaptation.volumeFactor));

  if (item.followChain !== null) {
    const step = currentStep(item.followChain, input);
    if (step === null) {
      return null;
    }
    const exercise = applySwap(step.exerciseCode, input);
    if (exercise === null || !isAllowed(exercise, adaptation)) {
      return null;
    }
    const state = input.progression.get(item.followChain);
    return {
      position: item.position,
      block: item.block,
      exercise,
      chain: item.followChain,
      variant: step.variant,
      sets,
      // Цель по повторам ведёт прогрессия, а не шаблон: шаблон задаёт только рамку.
      target: clamp(state?.currentReps ?? step.targetMin, step.targetMin, step.targetMax),
      unit: exercise.unit,
      tempo: step.tempo,
      weight: resolveWeight(step.loadHint ?? item.loadHint, input.user),
      restSec: item.restSec,
      unilateral: exercise.unilateral,
    };
  }

  const exercise = applySwap(item.exerciseCode, input);
  if (exercise === null || !isAllowed(exercise, adaptation)) {
    return null;
  }
  return {
    position: item.position,
    block: item.block,
    exercise,
    chain: null,
    variant: null,
    sets,
    target: item.targetMin,
    unit: exercise.unit,
    tempo: 'normal',
    weight: resolveWeight(item.loadHint, input.user),
    restSec: item.restSec,
    unilateral: exercise.unilateral,
  };
}

/**
 * Текущая ступень лестницы. Если на ней нужен инвентарь, которого нет (турник, рюкзак),
 * берётся ближайшая доступная ступень ниже — программа не должна вставать из-за железа.
 */
function currentStep(chain: Chain, input: ResolveInput): ChainStep | null {
  const steps = input.chainSteps
    .filter((step) => step.chain === chain)
    .sort((left, right) => left.level - right.level);
  if (steps.length === 0) {
    return null;
  }

  const level = input.progression.get(chain)?.chainLevel ?? 1;
  const available = steps.filter(
    (step) =>
      step.level <= level &&
      (step.requires === null || hasEquipment(step.requires, input.user)) &&
      isAvailable(input.exercises.get(step.exerciseCode), input.user),
  );

  return available.at(-1) ?? null;
}

/**
 * Ручная замена пользователя, если она есть и доступна по инвентарю, иначе исходный код.
 * Замена живёт в отдельной таблице и действует 7 дней (docs/06), поэтому она сильнее шаблона,
 * но слабее инвентаря: несуществующая штука в плане никому не нужна.
 */
function applySwap(code: string, input: ResolveInput): Exercise | null {
  const replacement = input.swaps.get(code);
  if (replacement !== undefined) {
    const swapped = input.exercises.get(replacement);
    if (swapped !== undefined && isAvailable(swapped, input.user)) {
      return swapped;
    }
  }
  return pickAvailable(code, input);
}

/** Упражнение из шаблона либо, если инвентаря нет, замена из той же swap_group (docs/06). */
function pickAvailable(code: string, input: ResolveInput): Exercise | null {
  const exercise = input.exercises.get(code);
  if (exercise === undefined) {
    return null;
  }
  if (isAvailable(exercise, input.user)) {
    return exercise;
  }
  for (const candidate of input.exercises.values()) {
    if (candidate.swapGroup === exercise.swapGroup && isAvailable(candidate, input.user)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Упражнения с `neck_safe = 0` в день боли ≥2 не предлагаются. Это инвариант, а не
 * настройка: гиревой жим над головой в такой день — плохая идея (docs/03).
 */
function isAllowed(exercise: Exercise, adaptation: Adaptation): boolean {
  return !adaptation.dropNeckUnsafe || exercise.neckSafe;
}

function isAvailable(exercise: Exercise | undefined, user: UserProfile): boolean {
  if (exercise === undefined) {
    return false;
  }
  return hasEquipment(exercise.equipment, user);
}

function hasEquipment(equipment: Equipment, user: UserProfile): boolean {
  switch (equipment) {
    case 'none':
    case 'wall':
      return true;
    case 'kettlebell':
      return user.kettlebells.length > 0;
    case 'band':
      return user.hasBand;
    case 'bar':
      return user.hasPullupBar;
    case 'backpack':
      return user.hasBackpack;
  }
}

/** Вес берётся из инвентаря пользователя, а не из констант в коде. */
function resolveWeight(hint: LoadHint | null, user: UserProfile): number | null {
  if (hint === null || hint === 'bodyweight' || hint === 'backpack') {
    return null;
  }
  const weights = user.kettlebells.map((bell) => bell.weight).sort((left, right) => left - right);
  if (weights.length === 0) {
    return null;
  }
  return hint === 'kb_light' ? (weights[0] ?? null) : (weights.at(-1) ?? null);
}

/**
 * Урезание под бюджет минут. Режем по одному пункту с конца очереди приоритетов,
 * пока день не влезет; шею и основное движение не трогаем никогда.
 */
function trimToBudget(
  items: PlannedItem[],
  budgetMinutes: number,
): { kept: PlannedItem[]; cut: PlannedItem[] } {
  const budgetSeconds = budgetMinutes * 60;
  const kept = [...items];
  const cut: PlannedItem[] = [];

  while (totalSeconds(kept) > budgetSeconds) {
    let victimIndex = -1;
    let victimPriority = -1;
    for (const [index, item] of kept.entries()) {
      if (PROTECTED_BLOCKS.has(item.block)) {
        continue;
      }
      const priority = BLOCK_PRIORITY.indexOf(item.block);
      if (priority > victimPriority) {
        victimPriority = priority;
        victimIndex = index;
      }
    }
    if (victimIndex === -1) {
      break;
    }
    const [victim] = kept.splice(victimIndex, 1);
    if (victim !== undefined) {
      cut.push(victim);
    }
  }

  return { kept, cut };
}

/**
 * Бюджет минут на день.
 *
 * Обычный день живёт по настройке пользователя. На разгрузочной неделе потолок — 10 минут.
 * Длинный день по желанию (суббота) — единственное исключение: у него свой потолок 20–25 минут,
 * иначе круговой блок из docs/05 просто не влезал бы никогда (ADR-012).
 */
export function dayBudgetMinutes(
  template: DayTemplate,
  sessionMinutes: number,
  deload: boolean,
): number {
  if (deload) {
    return Math.min(DELOAD_MINUTES, sessionMinutes);
  }
  return template.optional ? Math.max(sessionMinutes, template.estMinutes) : sessionMinutes;
}

export function totalSeconds(items: PlannedItem[]): number {
  return items
    .filter((item) => !UNTIMED_BLOCKS.has(item.block))
    .reduce((sum, item) => sum + estimateSeconds(item), 0);
}

/**
 * Оценка длительности пункта: работа плюс отдых между подходами.
 * Стороны одностороннего упражнения идут подряд, отдых между ними не считается —
 * иначе тяга одной рукой «съедала» бы половину дня в расчёте, но не на практике.
 */
export function estimateSeconds(item: PlannedItem): number {
  const sides = item.unilateral ? 2 : 1;
  const rounds = item.sets * sides;
  const work = perSetSeconds(item.target, item.unit) * (TEMPO_FACTOR[item.tempo] ?? 1);
  const rest = Math.max(0, item.sets - 1) * item.restSec;
  return Math.round(rounds * work + rest);
}

function perSetSeconds(target: number, unit: Unit): number {
  switch (unit) {
    case 'reps':
      return target * SECONDS_PER_REP;
    case 'seconds':
      return target;
    case 'steps':
      return target * SECONDS_PER_STEP;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
