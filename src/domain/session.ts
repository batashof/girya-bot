import type { Chain, Feedback, PlannedItem, SetRecord, Workout } from './types';

/**
 * Разбиение тренировки на шаги пошагового режима и разбор её результата.
 *
 * Шаг — это одно упражнение: у каждого своё сообщение, своя схема движения и свой
 * счётчик подходов (docs/04-bot-ux.md). Шейный протокол тоже разворачивается по одному:
 * семь названий в одном сообщении не объясняют, что именно делать руками и головой.
 */

export interface WorkoutStep {
  index: number;
  item: PlannedItem;
  /** Сколько подходов в этом шаге. */
  sets: number;
}

export function toSteps(workout: Workout): WorkoutStep[] {
  return workout.items.map((item, index) => ({ index, item, sets: item.sets }));
}

/** Общее число подходов в тренировке — знаменатель прогресс-бара. */
export function totalSets(steps: WorkoutStep[]): number {
  return steps.reduce((sum, step) => sum + step.sets, 0);
}

/** Сколько подходов уже позади, если сейчас идёт `setIndex` шага `stepIndex` (оба 1-based по смыслу). */
export function setsBefore(steps: WorkoutStep[], stepIndex: number, setIndex: number): number {
  const done = steps.slice(0, stepIndex).reduce((sum, step) => sum + step.sets, 0);
  return done + (setIndex - 1);
}

/** Подходы, которые нужно записать, когда шаг отмечен выполненным. */
export function recordsForStep(
  step: WorkoutStep,
  setIndex: number,
  feedback: Feedback,
): SetRecord[] {
  return [
    {
      position: step.item.position,
      exerciseCode: step.item.exercise.code,
      setIndex,
      targetValue: step.item.target,
      actualValue: feedback === 'skipped' ? null : step.item.target,
      feedback,
    },
  ];
}

export interface ChainOutcome {
  chain: Chain;
  /** Все запланированные подходы сделаны не ниже цели. */
  completed: boolean;
  /** Худший фидбэк по упражнению: он и решает, куда двигать лестницу. */
  feedback: Feedback;
}

const FEEDBACK_SEVERITY: Record<Feedback, number> = {
  easy: 0,
  ok: 1,
  hard: 2,
  pain: 3,
  skipped: 4,
};

/**
 * Что тренировка говорит о каждой лестнице. Считается только по пунктам, привязанным
 * к лестнице: свинг в пятницу и растяжка на прогрессию не влияют.
 */
export function chainOutcomes(items: PlannedItem[], records: SetRecord[]): ChainOutcome[] {
  const outcomes: ChainOutcome[] = [];

  for (const item of items) {
    if (item.chain === null) {
      continue;
    }
    const own = records.filter((record) => record.position === item.position);
    if (own.length === 0) {
      continue;
    }

    const worst = own.reduce<Feedback>(
      (acc, record) =>
        FEEDBACK_SEVERITY[record.feedback] > FEEDBACK_SEVERITY[acc] ? record.feedback : acc,
      'easy',
    );

    outcomes.push({
      chain: item.chain,
      completed:
        own.length >= item.sets &&
        own.every(
          (record) => record.actualValue !== null && record.actualValue >= record.targetValue,
        ),
      feedback: worst,
    });
  }

  return outcomes;
}
