import { describe, expect, it } from 'vitest';
import { resolveWorkout, weekInBlock } from '../src/domain/program';
import type { Chain, PlannedItem } from '../src/domain/types';
import {
  baseProgression,
  defaultUser,
  loadChainSteps,
  loadExercises,
  templateFor,
} from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();

function resolve(options: {
  weekday: number;
  date?: string;
  user?: Partial<ReturnType<typeof defaultUser>>;
  levels?: Partial<Record<Chain, number>>;
  swaps?: [string, string][];
  short?: boolean;
}) {
  const progressionOverrides: Partial<Record<Chain, { chainLevel: number }>> = {};
  for (const [chain, level] of Object.entries(options.levels ?? {})) {
    progressionOverrides[chain as Chain] = { chainLevel: level };
  }
  return resolveWorkout({
    date: options.date ?? '2026-08-03',
    template: templateFor(options.weekday),
    user: defaultUser(options.user),
    exercises,
    chainSteps,
    progression: baseProgression(progressionOverrides),
    swaps: new Map(options.swaps ?? []),
    short: options.short ?? false,
  });
}

function codes(items: PlannedItem[]): string[] {
  return items.map((item) => item.exercise.code);
}

describe('weekInBlock', () => {
  it('делит блок на четыре недели, где четвёртая — разгрузочная', () => {
    expect(weekInBlock('2026-08-03', '2026-08-03')).toBe(1);
    expect(weekInBlock('2026-08-03', '2026-08-09')).toBe(1);
    expect(weekInBlock('2026-08-03', '2026-08-10')).toBe(2);
    expect(weekInBlock('2026-08-03', '2026-08-24')).toBe(4);
    expect(weekInBlock('2026-08-03', '2026-08-31')).toBe(1);
  });

  it('не уходит в минус, если дата раньше начала блока', () => {
    expect(weekInBlock('2026-08-03', '2026-07-30')).toBe(1);
  });
});

describe('resolveWorkout', () => {
  it('ставит шейный протокол первым пунктом любого дня', () => {
    // ADR-008: NP не опция, поэтому проверяем все семь дней.
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const workout = resolve({ weekday });
      expect(workout.items[0]?.block, `день ${weekday}`).toBe('neck');
      expect(workout.items[0]?.exercise.code, `день ${weekday}`).toBe('NK1');
    }
  });

  it('ничего не выкидывает ради времени: время не планируется (ADR-018)', () => {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const template = templateFor(weekday);
      const workout = resolve({ weekday });
      expect(workout.items, `день ${weekday}`).toHaveLength(template.items.length);
      expect(workout.dropped, `день ${weekday}`).toEqual([]);
    }
  });

  it('подставляет текущую ступень лестницы вместо упражнения из шаблона', () => {
    // Четверг — день жима: шаблон ссылается на PR3, ступень задаёт вариант.
    const knees = resolve({ weekday: 4, levels: { push: 3 } });
    const floor = resolve({ weekday: 4, levels: { push: 4 } });

    expect(knees.items.find((item) => item.block === 'main')?.variant).toBe('с колен');
    expect(floor.items.find((item) => item.block === 'main')?.variant).toBe('с пола');
  });

  it('поднимает темп, а не вес, на второй ступени тяги', () => {
    // ADR-011: ступень 2 в лестнице row — то же упражнение с темпом 3-1-3.
    const main = resolve({ weekday: 1, levels: { row: 2 } }).items.find(
      (item) => item.block === 'main',
    );
    expect(main?.exercise.code).toBe('RW1');
    expect(main?.tempo).toBe('slow');
  });

  it('откатывается на доступную ступень, если нужного инвентаря нет', () => {
    // Ступень 3 в тяге — рюкзак, ступень 4 — стол. Без рюкзака остаётся ступень 2.
    const withBackpack = resolve({ weekday: 1, levels: { row: 3 } });
    const withoutBackpack = resolve({
      weekday: 1,
      levels: { row: 3 },
      user: { hasBackpack: false },
    });

    expect(withBackpack.items.find((item) => item.block === 'main')?.exercise.code).toBe('RW8');
    expect(withoutBackpack.items.find((item) => item.block === 'main')?.exercise.code).toBe('RW1');
  });

  it('берёт вес из инвентаря пользователя, а не из константы', () => {
    const light = resolve({ weekday: 1 });
    const heavier = resolve({ weekday: 1, user: { kettlebells: [{ weight: 8, count: 2 }] } });

    expect(light.items.find((item) => item.block === 'main')?.weight).toBe(5);
    expect(heavier.items.find((item) => item.block === 'main')?.weight).toBe(8);
  });

  it('на разгрузочной неделе режет подходы, но не уровни и не состав', () => {
    const normal = resolve({ weekday: 1, date: '2026-08-03' });
    const deload = resolve({ weekday: 1, date: '2026-08-24' });

    expect(normal.deload).toBe(false);
    expect(deload.deload).toBe(true);
    expect(codes(deload.items)).toEqual(codes(normal.items));
    expect(Math.max(...deload.items.map((item) => item.sets))).toBeLessThanOrEqual(2);
    expect(deload.items.find((item) => item.block === 'main')?.exercise.code).toBe(
      normal.items.find((item) => item.block === 'main')?.exercise.code,
    );
  });

  it('сокращённая версия — только шея и основное движение', () => {
    const short = resolve({ weekday: 1, short: true });
    const blocks = new Set(short.items.map((item) => item.block));

    expect(blocks).toEqual(new Set(['neck', 'main']));
    // Не «не влезло», а сокращение по просьбе: в dropped оно не попадает.
    expect(short.dropped).toEqual([]);
  });

  it('длинный день и круговой блок целиком', () => {
    const saturday = resolve({ weekday: 6 });

    expect(saturday.optional).toBe(true);
    expect(codes(saturday.items).filter((code) => code === 'PC3')).toHaveLength(1);
    expect(saturday.items.filter((item) => item.block === 'circuit')).toHaveLength(4);
  });

  it('воскресенье заканчивается прогулкой', () => {
    expect(codes(resolve({ weekday: 7 }).items).at(-1)).toBe('MB9');
  });

  it('заменяет упражнение, если инвентаря нет, на доступное из той же группы', () => {
    // Без гирь тяга одной рукой невозможна — уходит в замену по swap_group.
    const noBells = resolve({ weekday: 1, user: { kettlebells: [] } });
    expect(codes(noBells.items)).not.toContain('CR3');
    expect(noBells.items.every((item) => item.exercise.equipment !== 'kettlebell')).toBe(true);
  });
});
