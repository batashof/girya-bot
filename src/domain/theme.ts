import type { Adaptation } from './adaptation';
import { clamp, isAvailable, resolveWeight } from './program';
import type {
  Chain,
  ChainStep,
  Exercise,
  LoadHint,
  PlannedItem,
  ProgressionState,
  Tempo,
  TemplateItem,
  UserProfile,
} from './types';

/**
 * Тренировка по теме (ADR-016): выбираешь группу — шею, лопатки, ноги — и из её
 * упражнений любое, в любом порядке. Здесь только чистая логика: что из группы можно
 * делать сегодня и сколько.
 *
 * Дневная программа и её лестницы отсюда не трогаются: пункт темы никогда не привязан
 * к лестнице (`chain = null`), поэтому ни прогрессию, ни серию он не двигает.
 */

export interface ThemeMenu {
  /** Упражнения группы, доступные по инвентарю и шее, в порядке кодов: NK1, NK2 … NK10. */
  exercises: Exercise[];
  /** Сколько упражнений спрятано из-за боли в шее. Показываем, чтобы список не «пропадал» молча. */
  hiddenForNeck: number;
}

/**
 * Состав темы на сегодня. Упражнения с `neck_safe = 0` в день боли ≥2 не предлагаются —
 * это тот же инвариант, что и для программы дня (docs/03), а не опция темы.
 */
export function themeMenu(
  groupCode: string,
  exercises: Iterable<Exercise>,
  user: UserProfile,
  adaptation: Adaptation,
): ThemeMenu {
  const inGroup = [...exercises].filter(
    (exercise) => exercise.groupCode === groupCode && isAvailable(exercise, user),
  );
  const allowed = inGroup.filter((exercise) => !adaptation.dropNeckUnsafe || exercise.neckSafe);
  return {
    exercises: allowed.sort(byCode),
    hiddenForNeck: inGroup.length - allowed.length,
  };
}

export interface DoseInput {
  exercise: Exercise;
  /** Порядковый номер упражнения внутри тренировки по теме, с 1. */
  position: number;
  user: UserProfile;
  chainSteps: ChainStep[];
  progression: Map<Chain, ProgressionState>;
  /**
   * Пункты шаблонов, откуда брать подходы и отдых: сначала дни недели, потом микро-блоки.
   * Первое совпадение выигрывает — у дня доза полноценная, у микро-блока урезанная.
   */
  templateItems: TemplateItem[];
  adaptation: Adaptation;
}

/** Если упражнение не встречается ни в одном шаблоне и ни в одной лестнице. */
const FALLBACK_SETS = 2;
const FALLBACK_REST_SEC = 60;
const FALLBACK_TARGET: Record<Exercise['unit'], number> = { reps: 10, seconds: 30, steps: 40 };
/** Подходов у упражнения из лестницы, если в шаблонах дней оно не встречается. */
const CHAIN_SETS = 3;

/**
 * Сколько и как делать упражнение, выбранное вне программы дня.
 *
 * Источник дозы — то, что программа уже знает об этом упражнении:
 * 1. упражнение из лестницы — ступень, на которой пользователь сейчас (или ближайшая
 *    к ней ступень этого упражнения), с его текущей целью по повторам;
 * 2. упражнение из шаблона — подходы, цель и отдых из шаблона;
 * 3. иначе — скромное умолчание по единице измерения.
 *
 * Боль в шее режет объём так же, как в программе дня.
 */
export function themeDose(input: DoseInput): PlannedItem {
  const { exercise, user, adaptation } = input;
  const fromChain = chainDose(input);
  const fromTemplate = input.templateItems.find(
    (item) => item.followChain === null && item.exerciseCode === exercise.code,
  );

  let sets: number;
  let target: number;
  let restSec: number;
  let loadHint: LoadHint | null;
  let tempo: Tempo = 'normal';
  let variant: string | null = null;
  let block: PlannedItem['block'] = 'support';

  if (fromChain !== null) {
    ({ sets, target, restSec, loadHint, tempo, variant } = fromChain);
    block = 'main';
  } else if (fromTemplate !== undefined) {
    sets = fromTemplate.sets;
    target = fromTemplate.targetMin;
    restSec = fromTemplate.restSec;
    loadHint = fromTemplate.loadHint;
    block = fromTemplate.block;
  } else {
    sets = FALLBACK_SETS;
    target = FALLBACK_TARGET[exercise.unit];
    restSec = FALLBACK_REST_SEC;
    loadHint = exercise.equipment === 'kettlebell' ? 'kb_main' : null;
  }

  return {
    position: input.position,
    block,
    exercise,
    // Пункт темы не принадлежит лестнице: иначе выбранное «по настроению» упражнение
    // двигало бы прогрессию программы дня (ADR-016).
    chain: null,
    variant,
    sets: Math.max(1, Math.round(sets * adaptation.volumeFactor)),
    target,
    unit: exercise.unit,
    tempo,
    weight: resolveWeight(loadHint, user),
    restSec,
    unilateral: exercise.unilateral,
  };
}

interface ChainDose {
  sets: number;
  target: number;
  restSec: number;
  loadHint: LoadHint | null;
  tempo: Tempo;
  variant: string | null;
}

/**
 * Доза из лестницы. Если пользователь стоит на ступени этого упражнения — берём её и его
 * текущую цель. Если он ниже — самую лёгкую ступень упражнения с нижней границей цели:
 * вариант сложнее текущего не должен начинаться с верхней. Если выше — самую трудную
 * ступень упражнения с верхней границей: он его уже перерос.
 */
function chainDose(input: DoseInput): ChainDose | null {
  const own = input.chainSteps
    .filter((step) => step.exerciseCode === input.exercise.code)
    .sort((left, right) => left.level - right.level);
  const first = own[0];
  const last = own.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }

  const chain = first.chain;
  const state = input.progression.get(chain);
  let step: ChainStep = first;
  let target = first.targetMin;

  if (state !== undefined) {
    const current = own.find((candidate) => candidate.level === state.chainLevel);
    if (current !== undefined) {
      step = current;
      target = clamp(state.currentReps, current.targetMin, current.targetMax);
    } else if (state.chainLevel > last.level) {
      step = last;
      target = last.targetMax;
    }
  }

  // Подходы и отдых — как у пункта дня, который ведёт эту лестницу.
  const dayItem = input.templateItems.find((item) => item.followChain === chain);
  return {
    sets: dayItem?.sets ?? CHAIN_SETS,
    target,
    restSec: dayItem?.restSec ?? FALLBACK_REST_SEC,
    loadHint: step.loadHint ?? dayItem?.loadHint ?? null,
    tempo: step.tempo,
    variant: step.variant,
  };
}

/** NK2 раньше NK10: сравнение по префиксу, потом по числу. */
function byCode(left: Exercise, right: Exercise): number {
  const a = splitCode(left.code);
  const b = splitCode(right.code);
  return a.prefix === b.prefix ? a.number - b.number : a.prefix.localeCompare(b.prefix);
}

function splitCode(code: string): { prefix: string; number: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(code);
  return match === null
    ? { prefix: code, number: 0 }
    : { prefix: match[1] ?? code, number: Number(match[2]) };
}
