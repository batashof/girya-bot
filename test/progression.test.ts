import { describe, expect, it } from 'vitest';
import { startingLevels } from '../src/domain/progression';
import type { Chain } from '../src/domain/types';
import { defaultUser, loadChainSteps } from './fixtures';

const chainSteps = loadChainSteps();

function levels(user: Parameters<typeof startingLevels>[0]): Record<string, number> {
  return Object.fromEntries(
    startingLevels(user, chainSteps).map((state) => [state.chain, state.chainLevel]),
  );
}

describe('startingLevels', () => {
  it('расставляет стартовую ступень по всем лестницам', () => {
    const result = startingLevels(defaultUser(), chainSteps);
    expect(result.map((state) => state.chain).sort()).toEqual([
      'core',
      'hinge',
      'push',
      'row',
      'squat',
    ]);
  });

  it('при росте 190 берёт ступень ниже — длинные рычаги тяжелее (docs/05)', () => {
    const tall = levels(defaultUser({ heightCm: 190 }));
    const average = levels(defaultUser({ heightCm: 175 }));

    expect(tall['push']).toBe((average['push'] ?? 0) - 1);
    expect(tall['squat']).toBe((average['squat'] ?? 0) - 1);
  });

  it('не начинает с реабилитационной ступени здорового взрослого', () => {
    // Отжимания от стены — это запас вниз при откате, а не старт.
    const result = levels(defaultUser());
    expect(result['push']).toBeGreaterThan(1);
  });

  it('у регулярно тренирующегося старт выше', () => {
    const base = levels(defaultUser({ level: 'base' }));
    const strong = levels(defaultUser({ level: 'strong' }));

    expect(strong['push']).toBeGreaterThan(base['push'] ?? 0);
  });

  it('пропускает ступени, для которых нет инвентаря', () => {
    // Ступень 3 в тяге — рюкзак. Без него старт не может на неё попасть.
    const withoutBackpack = startingLevels(
      defaultUser({ level: 'strong', heightCm: 170, hasBackpack: false }),
      chainSteps,
    );
    const row = withoutBackpack.find((state) => state.chain === ('row' as Chain));

    expect(row?.chainLevel).not.toBe(3);
    expect(row?.exerciseCode).not.toBe('RW8');
  });

  it('стартовая цель по повторам — нижняя граница ступени', () => {
    const push = startingLevels(defaultUser(), chainSteps).find((state) => state.chain === 'push');
    const step = chainSteps.find(
      (candidate) => candidate.chain === 'push' && candidate.level === push?.chainLevel,
    );

    expect(push?.currentReps).toBe(step?.targetMin);
  });
});
