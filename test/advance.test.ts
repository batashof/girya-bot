import { describe, expect, it } from 'vitest';
import { advance } from '../src/domain/progression';
import type { ChainOutcome } from '../src/domain/session';
import type { ProgressionState } from '../src/domain/types';
import { defaultUser, loadChainSteps } from './fixtures';

const chainSteps = loadChainSteps();
const user = defaultUser();

/** Отжимания: ступени 1–7, диапазон 8–15 повторов на каждой. */
function pushState(overrides: Partial<ProgressionState> = {}): ProgressionState {
  return {
    chain: 'push',
    exerciseCode: 'PR3',
    chainLevel: 3,
    tempo: 'normal',
    weight: null,
    currentReps: 8,
    hardStreak: 0,
    easyStreak: 0,
    ...overrides,
  };
}

const done: ChainOutcome = { chain: 'push', completed: true, feedback: 'ok' };
const hard: ChainOutcome = { chain: 'push', completed: true, feedback: 'hard' };

function run(state: ProgressionState, outcomes: ChainOutcome[]): ProgressionState {
  return outcomes.reduce((acc, outcome) => advance(acc, outcome, chainSteps, user), state);
}

describe('advance', () => {
  it('не двигает нагрузку после одной удачной тренировки', () => {
    // Правило: две тренировки подряд. Одна — это ещё не тенденция.
    const after = advance(pushState(), done, chainSteps, user);

    expect(after.currentReps).toBe(8);
    expect(after.easyStreak).toBe(1);
  });

  it('добавляет повтор после двух удачных тренировок подряд', () => {
    const after = run(pushState(), [done, done]);

    expect(after.currentReps).toBe(9);
    expect(after.chainLevel).toBe(3);
    expect(after.easyStreak).toBe(0);
  });

  it('растит повторы до верхней границы и только потом меняет ступень', () => {
    // ADR-011: сначала повторы, и лишь на верхней границе — следующий вариант.
    const atTop = pushState({ currentReps: 15 });
    const after = run(atTop, [done, done]);

    expect(after.chainLevel).toBe(4);
    expect(after.currentReps).toBe(8);
  });

  it('делает один шаг за раз, даже если тренировок подряд было четыре', () => {
    const after = run(pushState({ currentReps: 15 }), [done, done, done, done]);

    expect(after.chainLevel).toBe(4);
    expect(after.currentReps).toBe(9);
  });

  it('откатывается после двух «тяжело» подряд', () => {
    const after = run(pushState({ currentReps: 12 }), [hard, hard]);

    expect(after.currentReps).toBe(11);
    expect(after.hardStreak).toBe(0);
  });

  it('на нижней границе откат уходит на ступень ниже, к верхней границе', () => {
    const after = run(pushState({ chainLevel: 4, currentReps: 8 }), [hard, hard]);

    expect(after.chainLevel).toBe(3);
    expect(after.currentReps).toBe(15);
  });

  it('сбрасывает серию удач, если тренировка не доделана', () => {
    const missed: ChainOutcome = { chain: 'push', completed: false, feedback: 'ok' };
    const after = run(pushState(), [done, missed, done]);

    expect(after.currentReps).toBe(8);
    expect(after.easyStreak).toBe(1);
  });

  it('одна удачная тренировка гасит накопленное «тяжело»', () => {
    const after = run(pushState({ currentReps: 12 }), [hard, done, hard]);

    expect(after.currentReps).toBe(12);
    expect(after.hardStreak).toBe(1);
  });

  it('не двигает лестницу на боли и на пропуске', () => {
    const pain: ChainOutcome = { chain: 'push', completed: false, feedback: 'pain' };
    const skipped: ChainOutcome = { chain: 'push', completed: false, feedback: 'skipped' };

    expect(run(pushState({ currentReps: 12 }), [pain, pain]).currentReps).toBe(12);
    expect(run(pushState({ currentReps: 12 }), [skipped, skipped]).chainLevel).toBe(3);
  });

  it('перепрыгивает ступень, для которой нет инвентаря', () => {
    // Тяга: ступень 3 — рюкзак. Без него с ступени 2 идём сразу на 4 (стол).
    const row: ProgressionState = {
      chain: 'row',
      exerciseCode: 'RW1',
      chainLevel: 2,
      tempo: 'slow',
      weight: null,
      currentReps: 15,
      hardStreak: 0,
      easyStreak: 0,
    };
    const outcome: ChainOutcome = { chain: 'row', completed: true, feedback: 'ok' };
    const after = [outcome, outcome].reduce(
      (acc, next) => advance(acc, next, chainSteps, defaultUser({ hasBackpack: false })),
      row,
    );

    expect(after.chainLevel).toBe(4);
    expect(after.exerciseCode).toBe('RW7');
  });

  it('на вершине лестницы остаётся на месте', () => {
    const top = pushState({ chainLevel: 7, currentReps: 12 });
    const after = run(top, [done, done, done, done]);

    expect(after.chainLevel).toBe(7);
    expect(after.currentReps).toBe(12);
  });
});
