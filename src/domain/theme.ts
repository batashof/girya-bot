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
  adaptation: Adaptation;
}

/**
 * Сколько и как делать упражнение, выбранное вне программы дня.
 *
 * У каждого упражнения своя доза в справочнике (`exercises.dose_*`, ADR-017): подходы,
 * повторы (или удержания) и отдых. Если упражнение — ступень лестницы, повторы берутся
 * из лестницы: там, где стоит пользователь, с его текущей целью. Боль в шее режет объём
 * так же, как в программе дня.
 */
export function themeDose(input: DoseInput): PlannedItem {
  const { exercise, user, adaptation } = input;
  const { dose } = exercise;
  const fromChain = chainDose(input);
  const hold = exercise.unit === 'seconds';

  // У удержания доза — «N удержаний по repSec секунд», у движения — «N повторов».
  let target = hold ? exercise.repSec : dose.reps;
  let repSec = exercise.repSec;
  let repNote = exercise.repNote;
  let tempo: Tempo = 'normal';
  let variant: string | null = null;
  let loadHint: LoadHint | null = defaultLoad(exercise);

  if (fromChain !== null) {
    target = fromChain.target;
    tempo = fromChain.step.tempo;
    variant = fromChain.step.variant;
    loadHint = fromChain.step.loadHint ?? loadHint;
    if (fromChain.step.repSec !== null) {
      repSec = fromChain.step.repSec;
      repNote = fromChain.step.repNote;
    }
  }

  return {
    position: input.position,
    block: fromChain === null ? 'support' : 'main',
    exercise,
    // Пункт темы не принадлежит лестнице: иначе выбранное «по настроению» упражнение
    // двигало бы прогрессию программы дня (ADR-016).
    chain: null,
    variant,
    sets: Math.max(1, Math.round(dose.sets * adaptation.volumeFactor)),
    target,
    holds: hold ? dose.reps : 1,
    repSec,
    repNote,
    unit: exercise.unit,
    tempo,
    weight: resolveWeight(loadHint, user),
    restSec: dose.restSec,
    unilateral: exercise.unilateral,
  };
}

/** Гиревое упражнение вне лестницы делается с основной гирей пользователя. */
function defaultLoad(exercise: Exercise): LoadHint | null {
  return exercise.equipment === 'kettlebell' ? 'kb_main' : null;
}

/**
 * Ступень лестницы для упражнения. Если пользователь стоит на ступени этого упражнения —
 * берём её и его текущую цель. Если он ниже — самую лёгкую ступень упражнения с нижней
 * границей цели. Если выше — самую трудную ступень упражнения с верхней границей: он его
 * уже перерос.
 */
function chainDose(input: DoseInput): { step: ChainStep; target: number } | null {
  const own = input.chainSteps
    .filter((step) => step.exerciseCode === input.exercise.code)
    .sort((left, right) => left.level - right.level);
  const first = own[0];
  const last = own.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }

  const state = input.progression.get(first.chain);
  if (state !== undefined) {
    const current = own.find((candidate) => candidate.level === state.chainLevel);
    if (current !== undefined) {
      return {
        step: current,
        target: clamp(state.currentReps, current.targetMin, current.targetMax),
      };
    }
    if (state.chainLevel > last.level) {
      return { step: last, target: last.targetMax };
    }
  }
  return { step: first, target: first.targetMin };
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
