import { describe, expect, it } from 'vitest';
import { adaptationFor, effectiveScore, NO_ADAPTATION } from '../src/domain/adaptation';
import { resolveWorkout } from '../src/domain/program';
import {
  baseProgression,
  defaultUser,
  loadChainSteps,
  loadExercises,
  templateFor,
} from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();

function resolve(weekday: number, score: 0 | 1 | 2 | 3) {
  return resolveWorkout({
    date: '2026-08-03',
    template: templateFor(weekday),
    user: defaultUser(),
    exercises,
    chainSteps,
    progression: baseProgression(),
    swaps: new Map(),
    adaptation: adaptationFor(score),
  });
}

describe('adaptationFor', () => {
  it('на 0 и 1 день идёт как есть', () => {
    expect(adaptationFor(0)).toEqual(NO_ADAPTATION);
    expect(adaptationFor(1)).toEqual(NO_ADAPTATION);
  });

  it('на 2 убирает небезопасные для шеи упражнения и режет объём', () => {
    const adaptation = adaptationFor(2);

    expect(adaptation.dropNeckUnsafe).toBe(true);
    expect(adaptation.volumeFactor).toBeLessThan(1);
    expect(adaptation.recoveryOnly).toBe(false);
  });

  it('на 3 заменяет день восстановительным и показывает красные флаги', () => {
    const adaptation = adaptationFor(3);

    expect(adaptation.recoveryOnly).toBe(true);
    expect(adaptation.showRedFlags).toBe(true);
  });

  it('показывает красные флаги на третий день подряд с оценкой ≥2 (docs/10)', () => {
    expect(adaptationFor(2, [1, 2]).showRedFlags).toBe(false);
    expect(adaptationFor(2, [2, 2]).showRedFlags).toBe(true);
  });
});

describe('effectiveScore', () => {
  it('сегодняшний ответ важнее вчерашнего', () => {
    expect(effectiveScore(0, 3)).toBe(0);
    expect(effectiveScore(2, 0)).toBe(2);
  });

  it('переносит вчерашние 2–3 на сегодня, пока не спросили', () => {
    // «Оценка 2–3 → завтра автоматически разгрузочный день» (M4).
    expect(effectiveScore(null, 2)).toBe(2);
    expect(effectiveScore(null, 3)).toBe(3);
  });

  it('вчерашние 0–1 на сегодня не переносятся', () => {
    expect(effectiveScore(null, 1)).toBe(0);
    expect(effectiveScore(null, null)).toBe(0);
  });
});

describe('resolveWorkout с болью в шее', () => {
  it('в день боли не даёт упражнений с neck_safe = 0', () => {
    // Суббота: turkish get-up помечен небезопасным для шеи.
    const normal = resolve(6, 0);
    const painful = resolve(6, 2);

    expect(normal.items.some((item) => !item.exercise.neckSafe)).toBe(true);
    expect(painful.items.every((item) => item.exercise.neckSafe)).toBe(true);
  });

  it('режет объём на оценке 2', () => {
    const normal = resolve(1, 0);
    const painful = resolve(1, 2);
    const sets = (workout: typeof normal): number =>
      workout.items.reduce((sum, item) => sum + item.sets, 0);

    expect(sets(painful)).toBeLessThan(sets(normal));
  });

  it('оставляет шейный протокол даже в день боли', () => {
    // ADR-008: протокол безопасен и работает от частоты, поэтому он не выключается.
    expect(resolve(1, 2).items[0]?.block).toBe('neck');
  });
});
