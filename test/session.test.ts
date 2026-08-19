import { describe, expect, it } from 'vitest';
import { resolveWorkout } from '../src/domain/program';
import {
  chainOutcomes,
  recordsForStep,
  remainingSeconds,
  secondsPerSet,
  setsBefore,
  toSteps,
  totalSets,
} from '../src/domain/session';
import type { SetRecord, Workout } from '../src/domain/types';
import {
  baseProgression,
  defaultUser,
  loadChainSteps,
  loadExercises,
  templateFor,
} from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();

function workoutFor(weekday: number): Workout {
  return resolveWorkout({
    date: '2026-08-03',
    template: templateFor(weekday),
    user: defaultUser(),
    exercises,
    chainSteps,
    progression: baseProgression(),
    swaps: new Map(),
  });
}

describe('toSteps', () => {
  it('даёт по шагу на каждое упражнение, включая шейный протокол', () => {
    // Одно сообщение на упражнение: список из семи названий не объясняет технику (docs/04).
    const workout = workoutFor(1);
    const steps = toSteps(workout);

    expect(steps).toHaveLength(workout.items.length);
    expect(steps.filter((step) => step.item.block === 'neck').length).toBeGreaterThan(4);
  });

  it('оставляет упражнению его подходы', () => {
    const steps = toSteps(workoutFor(1));
    const row = steps.find((step) => step.item.exercise.code === 'RW1');

    expect(row?.sets).toBe(3);
  });

  it('нумерует шаги подряд с нуля', () => {
    const steps = toSteps(workoutFor(4));
    expect(steps.map((step) => step.index)).toEqual(steps.map((_, index) => index));
  });
});

describe('прогресс и время', () => {
  const steps = toSteps(workoutFor(1));

  it('считает все подходы дня', () => {
    expect(totalSets(steps)).toBe(steps.reduce((sum, step) => sum + step.sets, 0));
  });

  it('в начале тренировки позади ноль подходов, в конце — все', () => {
    expect(setsBefore(steps, 0, 1)).toBe(0);
    const last = steps.length - 1;
    expect(setsBefore(steps, last, steps[last]!.sets)).toBe(totalSets(steps) - 1);
  });

  it('остаток времени только убывает по ходу тренировки', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const step of steps) {
      for (let set = 1; set <= step.sets; set += 1) {
        const left = remainingSeconds(steps, step.index, set);
        expect(left).toBeLessThan(previous);
        previous = left;
      }
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('в начале остаток совпадает с оценкой дня', () => {
    // Расхождение больше минуты означало бы, что карточка и план дня считают по-разному.
    const planned = workoutFor(1).estimatedMinutes * 60;
    expect(Math.abs(remainingSeconds(steps, 0, 1) - planned)).toBeLessThan(60);
  });

  it('подход не длиннее упражнения целиком', () => {
    for (const step of steps) {
      expect(secondsPerSet(step)).toBeLessThanOrEqual(remainingSeconds(steps, step.index, 1));
    }
  });
});

describe('recordsForStep', () => {
  it('пишет строку на упражнение шага', () => {
    const steps = toSteps(workoutFor(1));
    const records = recordsForStep(steps[0]!, 1, 'ok');

    expect(records).toHaveLength(1);
    expect(records[0]?.exerciseCode).toBe(steps[0]!.item.exercise.code);
    expect(records.every((record) => record.actualValue === record.targetValue)).toBe(true);
  });

  it('у пропущенного подхода нет фактического значения', () => {
    const steps = toSteps(workoutFor(1));
    const records = recordsForStep(steps[1]!, 2, 'skipped');

    expect(records[0]?.actualValue).toBeNull();
    expect(records[0]?.setIndex).toBe(2);
  });
});

describe('chainOutcomes', () => {
  const workout = workoutFor(4);
  const main = workout.items.find((item) => item.block === 'main');

  function records(overrides: Partial<SetRecord>[]): SetRecord[] {
    return overrides.map((override, index) => ({
      position: main!.position,
      exerciseCode: main!.exercise.code,
      setIndex: index + 1,
      targetValue: main!.target,
      actualValue: main!.target,
      feedback: 'ok',
      ...override,
    }));
  }

  it('считает только пункты, привязанные к лестнице', () => {
    // Растяжка и свинг на прогрессию не влияют.
    const all = workout.items.map((item, index) => ({
      position: item.position,
      exerciseCode: item.exercise.code,
      setIndex: index + 1,
      targetValue: item.target,
      actualValue: item.target,
      feedback: 'ok' as const,
    }));

    const outcomes = chainOutcomes(workout.items, all);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.chain).toBe('push');
  });

  it('засчитывает выполнение, только если сделаны все подходы', () => {
    const full = chainOutcomes(workout.items, records([{}, {}, {}]));
    const partial = chainOutcomes(workout.items, records([{}, {}]));

    expect(full[0]?.completed).toBe(true);
    expect(partial[0]?.completed).toBe(false);
  });

  it('не засчитывает подход, сделанный ниже цели', () => {
    const short = chainOutcomes(workout.items, records([{}, {}, { actualValue: 1 }]));
    expect(short[0]?.completed).toBe(false);
  });

  it('берёт худший фидбэк по упражнению', () => {
    // Два лёгких подхода и один тяжёлый — это «тяжело», а не «в среднем нормально».
    const mixed = chainOutcomes(
      workout.items,
      records([{ feedback: 'easy' }, { feedback: 'hard' }, { feedback: 'easy' }]),
    );
    expect(mixed[0]?.feedback).toBe('hard');
  });

  it('пропускает упражнения, по которым ничего не записано', () => {
    expect(chainOutcomes(workout.items, [])).toHaveLength(0);
  });
});
