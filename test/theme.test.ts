import { describe, expect, it } from 'vitest';
import { adaptationFor, NO_ADAPTATION } from '../src/domain/adaptation';
import { themeDose, themeMenu, type DoseInput } from '../src/domain/theme';
import type { Exercise, TemplateItem } from '../src/domain/types';
import {
  baseProgression,
  defaultUser,
  loadChainSteps,
  loadExercises,
  loadTemplates,
} from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();
const templateItems: TemplateItem[] = loadTemplates().flatMap((template) => template.items);

function exercise(code: string): Exercise {
  const found = exercises.get(code);
  if (found === undefined) {
    throw new Error(`Нет упражнения ${code}`);
  }
  return found;
}

function dose(code: string, overrides: Partial<DoseInput> = {}) {
  return themeDose({
    exercise: exercise(code),
    position: 1,
    user: defaultUser(),
    chainSteps,
    progression: baseProgression(),
    templateItems,
    adaptation: NO_ADAPTATION,
    ...overrides,
  });
}

describe('themeMenu', () => {
  it('собирает группу по коду и сортирует NK2 раньше NK10', () => {
    const menu = themeMenu('neck', exercises.values(), defaultUser(), NO_ADAPTATION);
    const codes = menu.exercises.map((item) => item.code);
    expect(codes[0]).toBe('NK1');
    expect(codes.at(-1)).toBe('NK10');
    expect(menu.exercises.every((item) => item.groupCode === 'neck')).toBe(true);
  });

  it('не предлагает упражнения без нужного инвентаря', () => {
    const noBar = themeMenu('scap', exercises.values(), defaultUser(), NO_ADAPTATION);
    expect(noBar.exercises.map((item) => item.code)).not.toContain('SC8');

    const withBar = themeMenu(
      'scap',
      exercises.values(),
      defaultUser({ hasPullupBar: true }),
      NO_ADAPTATION,
    );
    expect(withBar.exercises.map((item) => item.code)).toContain('SC8');
  });

  it('при боли в шее ≥2 прячет упражнения с neck_safe = 0 и говорит сколько', () => {
    // Инвариант из docs/03 общий для программы дня и темы: жим над головой не предлагается.
    const menu = themeMenu('press', exercises.values(), defaultUser(), adaptationFor(2));
    expect(menu.exercises.map((item) => item.code)).not.toContain('PR1');
    expect(menu.exercises.every((item) => item.neckSafe)).toBe(true);
    expect(menu.hiddenForNeck).toBe(1);

    const calm = themeMenu('press', exercises.values(), defaultUser(), NO_ADAPTATION);
    expect(calm.exercises.map((item) => item.code)).toContain('PR1');
    expect(calm.hiddenForNeck).toBe(0);
  });
});

describe('themeDose', () => {
  it('упражнение из лестницы берёт текущую ступень и цель пользователя', () => {
    const progression = baseProgression({ push: { chainLevel: 4, currentReps: 12 } });
    const item = dose('PR3', { progression });
    expect(item.variant).toBe('с пола');
    expect(item.target).toBe(12);
    // Подходы и отдых — как у пункта дня, который ведёт лестницу отжиманий.
    expect(item.sets).toBe(3);
    expect(item.restSec).toBe(60);
  });

  it('пункт темы не привязан к лестнице — прогрессию он не двигает', () => {
    // ADR-016: иначе упражнение, выбранное «по настроению», сдвигало бы программу дня.
    expect(dose('PR3').chain).toBeNull();
    expect(dose('NK1').chain).toBeNull();
  });

  it('вариант сложнее текущей ступени начинается с нижней границы самой лёгкой его ступени', () => {
    // Тяга под столом — ступени 4–6 лестницы тяги, пользователь на первой.
    const item = dose('RW7');
    expect(item.variant).toBe('ноги согнуты');
    expect(item.target).toBe(8);
  });

  it('перерос упражнение — берётся его самая трудная ступень с верхней границей', () => {
    const progression = baseProgression({ row: { chainLevel: 7, exerciseCode: 'RW6' } });
    const item = dose('RW7', { progression });
    expect(item.variant).toBe('ноги на возвышении');
    expect(item.target).toBe(12);
  });

  it('упражнение из шаблона берёт подходы, цель и отдых оттуда', () => {
    // NK1 стоит в шейном протоколе: один подход, 10 повторов, 15 секунд отдыха.
    const item = dose('NK1');
    expect(item.sets).toBe(1);
    expect(item.target).toBe(10);
    expect(item.restSec).toBe(15);
  });

  it('упражнение вне шаблонов и лестниц получает скромное умолчание и гирю из инвентаря', () => {
    // Жим стоя не стоит ни в одном дне: доза по умолчанию, вес — из гирь пользователя.
    const item = dose('PR1');
    expect(item.sets).toBe(2);
    expect(item.target).toBe(10);
    expect(item.weight).toBe(5);
  });

  it('боль в шее режет объём так же, как в программе дня', () => {
    expect(dose('PR3', { adaptation: adaptationFor(2) }).sets).toBe(2);
  });

  it('позиция — порядковый номер в тренировке по теме', () => {
    expect(dose('NK1', { position: 4 }).position).toBe(4);
  });
});
