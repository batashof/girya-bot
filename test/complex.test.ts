import { describe, expect, it } from 'vitest';
import { adaptationFor } from '../src/domain/adaptation';
import { resolveWorkout } from '../src/domain/program';
import {
  baseProgression,
  complexFor,
  defaultUser,
  loadChainSteps,
  loadExercises,
} from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();

function resolve(options: { date?: string; neck?: 0 | 1 | 2 | 3 } = {}) {
  return resolveWorkout({
    date: options.date ?? '2026-08-03',
    template: complexFor('C1-NECK'),
    user: defaultUser(),
    exercises,
    chainSteps,
    progression: baseProgression(),
    swaps: new Map(),
    adaptation: adaptationFor(options.neck ?? 0),
    outsideBlock: true,
  });
}

describe('комплекс «Шея и надплечья»', () => {
  it('держит порядок из сида и ничего не теряет', () => {
    const complex = complexFor('C1-NECK');
    const workout = resolve();
    expect(workout.items.map((item) => item.exercise.code)).toEqual(
      complex.items.map((item) => item.exerciseCode),
    );
    expect(workout.dropped).toEqual([]);
  });

  it('содержит упражнения с доказанным эффектом при боли в надплечье', () => {
    // Подъём в стороны — ядро: два РКИ Андерсена (docs/07, ADR-018).
    const codes = resolve().items.map((item) => item.exercise.code);
    expect(codes).toEqual(expect.arrayContaining(['PR7', 'SC11', 'SC12', 'NK11']));
  });

  it('не двигает лестницы: ни один пункт к ним не привязан', () => {
    expect(resolve().items.every((item) => item.chain === null)).toBe(true);
  });

  it('разгрузочная неделя его не режет', () => {
    const normal = resolve({ date: '2026-08-03' });
    const deloadWeek = resolve({ date: '2026-08-24' });
    expect(deloadWeek.deload).toBe(false);
    expect(deloadWeek.items.map((item) => item.sets)).toEqual(
      normal.items.map((item) => item.sets),
    );
  });

  it('при боли в шее ≥2 убирает то, что её грузит (инвариант neck_safe)', () => {
    const calm = resolve();
    const sore = resolve({ neck: 2 });
    expect(calm.items.map((item) => item.exercise.code)).toContain('SC11');
    expect(sore.items.map((item) => item.exercise.code)).not.toContain('SC11');
    expect(sore.items.every((item) => item.exercise.neckSafe)).toBe(true);
    expect(sore.dropped.length).toBeGreaterThan(0);
  });
});
