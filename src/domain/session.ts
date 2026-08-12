import type { Chain, Feedback, PlannedItem, SetRecord, Workout } from './types';

/**
 * Разбиение тренировки на шаги пошагового режима и разбор её результата.
 *
 * Шаг — это один экран с кнопками, а не одно упражнение: шейный протокол из семи
 * упражнений проходится как один пункт, иначе утро превращается в семь нажатий
 * до первого настоящего движения (docs/04-bot-ux.md).
 */

export interface WorkoutStep {
  index: number;
  kind: 'neck' | 'exercise';
  items: PlannedItem[];
  /** Сколько раз повторить шаг: подходы упражнения либо один круг протокола. */
  sets: number;
}

export function toSteps(workout: Workout): WorkoutStep[] {
  const steps: WorkoutStep[] = [];

  for (const item of workout.items) {
    const last = steps.at(-1);
    if (item.block === 'neck' && last?.kind === 'neck') {
      last.items.push(item);
      continue;
    }
    steps.push({
      index: steps.length,
      kind: item.block === 'neck' ? 'neck' : 'exercise',
      items: [item],
      sets: item.block === 'neck' ? 1 : item.sets,
    });
  }

  return steps;
}

/** Подходы, которые нужно записать, когда шаг отмечен выполненным. */
export function recordsForStep(
  step: WorkoutStep,
  setIndex: number,
  feedback: Feedback,
): SetRecord[] {
  return step.items.map((item) => ({
    position: item.position,
    exerciseCode: item.exercise.code,
    setIndex,
    targetValue: item.target,
    actualValue: feedback === 'skipped' ? null : item.target,
    feedback,
  }));
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
