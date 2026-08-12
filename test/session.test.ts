import { describe, expect, it } from 'vitest';
import { resolveWorkout } from '../src/domain/program';
import { chainOutcomes, recordsForStep, toSteps } from '../src/domain/session';
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
  it('сворачивает шейный протокол в один шаг', () => {
    // Иначе утро — это семь нажатий до первого настоящего движения (docs/04).
    const steps = toSteps(workoutFor(1));

    expect(steps[0]?.kind).toBe('neck');
    expect(steps[0]?.items.length).toBeGreaterThan(4);
    expect(steps[0]?.sets).toBe(1);
    expect(steps.filter((step) => step.kind === 'neck')).toHaveLength(1);
  });

  it('оставляет остальным упражнениям их подходы', () => {
    const steps = toSteps(workoutFor(1));
    const row = steps.find((step) => step.items[0]?.exercise.code === 'RW1');

    expect(row?.kind).toBe('exercise');
    expect(row?.sets).toBe(3);
  });

  it('нумерует шаги подряд с нуля', () => {
    const steps = toSteps(workoutFor(4));
    expect(steps.map((step) => step.index)).toEqual(steps.map((_, index) => index));
  });

  it('даёт обозримое число шагов на день', () => {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      expect(toSteps(workoutFor(weekday)).length, `день ${weekday}`).toBeLessThanOrEqual(11);
    }
  });
});

describe('recordsForStep', () => {
  it('пишет по строке на каждое упражнение шага', () => {
    const steps = toSteps(workoutFor(1));
    const records = recordsForStep(steps[0]!, 1, 'ok');

    expect(records).toHaveLength(steps[0]!.items.length);
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
