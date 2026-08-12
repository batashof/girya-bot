import type { ChainOutcome } from './session';
import type { Chain, ChainStep, ProgressionState, UserProfile } from './types';

/**
 * Стартовые ступени лестниц.
 *
 * Правило из docs/05: нормативы из интернета игнорируются, при длинных рычагах старт берётся
 * на ступень ниже. Ошибиться вниз безопасно — лестница поднимается за пару тренировок,
 * а слишком высокий старт означает технику через силу.
 */

/** С этого роста рычаги делают отжимания и приседы объективно тяжелее (docs/05). */
const TALL_CM = 185;

/**
 * Ступень, с которой начинает здоровый взрослый. Ниже — реабилитационные варианты
 * (отжимания от стены), они нужны как запас вниз при откате, а не как старт.
 */
const NOMINAL_START: Record<UserProfile['level'], number> = { base: 3, strong: 4 };

const CHAINS: Chain[] = ['push', 'row', 'squat', 'hinge', 'core'];

export function startingLevels(user: UserProfile, chainSteps: ChainStep[]): ProgressionState[] {
  const nominal = NOMINAL_START[user.level];
  const wanted = user.heightCm !== null && user.heightCm >= TALL_CM ? nominal - 1 : nominal;

  const states: ProgressionState[] = [];
  for (const chain of CHAINS) {
    const steps = chainSteps
      .filter((step) => step.chain === chain)
      .sort((left, right) => left.level - right.level);
    if (steps.length === 0) {
      continue;
    }

    const step = pickStep(steps, wanted, user);
    states.push({
      chain,
      exerciseCode: step.exerciseCode,
      chainLevel: step.level,
      tempo: step.tempo,
      weight: null,
      currentReps: step.targetMin,
      hardStreak: 0,
      easyStreak: 0,
    });
  }
  return states;
}

/** Ближайшая доступная ступень не выше желаемой: ступени с недостающим железом пропускаются. */
function pickStep(steps: ChainStep[], wanted: number, user: UserProfile): ChainStep {
  const available = steps.filter(
    (step) => step.level <= Math.max(1, wanted) && hasRequirement(step, user),
  );
  const chosen = available.at(-1) ?? steps.find((step) => hasRequirement(step, user)) ?? steps[0];
  if (chosen === undefined) {
    throw new Error('В лестнице нет ни одной ступени');
  }
  return chosen;
}

/** Сколько тренировок подряд нужно, чтобы сдвинуть лестницу в любую сторону (docs/05). */
const STREAK_TO_MOVE = 2;

/**
 * Шаг по лестнице после тренировки.
 *
 * Вверх: все подходы выполнены по цели, фидбэк не «тяжело», и так две тренировки подряд.
 * Сначала растут повторы внутри диапазона ступени, и только на верхней границе —
 * следующая ступень (ADR-011: повторы → темп → вариант → вес, темп и вариант зашиты
 * в порядок ступеней).
 *
 * Вниз: «тяжело» две тренировки подряд — зеркально, сначала повторы, потом ступень.
 * Это регулировка, а не наказание, поэтому один шаг за раз в обе стороны.
 */
export function advance(
  state: ProgressionState,
  outcome: ChainOutcome,
  chainSteps: ChainStep[],
  user: UserProfile,
): ProgressionState {
  const steps = ladder(chainSteps, state.chain);
  const current = steps.find((step) => step.level === state.chainLevel);
  if (current === undefined) {
    return state;
  }

  if (outcome.feedback === 'hard') {
    const hardStreak = state.hardStreak + 1;
    if (hardStreak < STREAK_TO_MOVE) {
      return { ...state, hardStreak, easyStreak: 0 };
    }
    return { ...stepDown(state, current, steps, user), hardStreak: 0, easyStreak: 0 };
  }

  // Боль и пропуск не двигают лестницу ни вверх, ни вниз: разбираться с ними — дело
  // адаптации дня, а не прогрессии.
  if (!outcome.completed || outcome.feedback === 'pain' || outcome.feedback === 'skipped') {
    return { ...state, easyStreak: 0, hardStreak: 0 };
  }

  const easyStreak = state.easyStreak + 1;
  if (easyStreak < STREAK_TO_MOVE) {
    return { ...state, easyStreak, hardStreak: 0 };
  }
  return { ...stepUp(state, current, steps, user), easyStreak: 0, hardStreak: 0 };
}

function stepUp(
  state: ProgressionState,
  current: ChainStep,
  steps: ChainStep[],
  user: UserProfile,
): ProgressionState {
  if (state.currentReps < current.targetMax) {
    return { ...state, currentReps: state.currentReps + 1 };
  }
  const next = steps.find((step) => step.level > current.level && hasRequirement(step, user));
  if (next === undefined) {
    // Вершина лестницы: дальше растёт только качество, цель остаётся на верхней границе.
    return state;
  }
  return {
    ...state,
    chainLevel: next.level,
    exerciseCode: next.exerciseCode,
    tempo: next.tempo,
    currentReps: next.targetMin,
  };
}

function stepDown(
  state: ProgressionState,
  current: ChainStep,
  steps: ChainStep[],
  user: UserProfile,
): ProgressionState {
  if (state.currentReps > current.targetMin) {
    return { ...state, currentReps: state.currentReps - 1 };
  }
  const previous = [...steps]
    .reverse()
    .find((step) => step.level < current.level && hasRequirement(step, user));
  if (previous === undefined) {
    return state;
  }
  return {
    ...state,
    chainLevel: previous.level,
    exerciseCode: previous.exerciseCode,
    tempo: previous.tempo,
    currentReps: previous.targetMax,
  };
}

function ladder(chainSteps: ChainStep[], chain: Chain): ChainStep[] {
  return chainSteps
    .filter((step) => step.chain === chain)
    .sort((left, right) => left.level - right.level);
}

function hasRequirement(step: ChainStep, user: UserProfile): boolean {
  switch (step.requires) {
    case null:
      return true;
    case 'bar':
      return user.hasPullupBar;
    case 'band':
      return user.hasBand;
    case 'backpack':
      return user.hasBackpack;
    case 'kettlebell':
      return user.kettlebells.length > 0;
  }
}
