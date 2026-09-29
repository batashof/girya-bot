import { describe, expect, it } from 'vitest';
import { adaptationFor, NO_ADAPTATION } from '../src/domain/adaptation';
import { themeDose, themeMenu, type DoseInput } from '../src/domain/theme';
import type { Exercise } from '../src/domain/types';
import { baseProgression, defaultUser, loadChainSteps, loadExercises } from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();

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
    adaptation: NO_ADAPTATION,
    ...overrides,
  });
}

describe('themeMenu', () => {
  it('собирает группу по коду и сортирует NK2 раньше NK10 и NK11', () => {
    const menu = themeMenu('neck', exercises.values(), defaultUser(), NO_ADAPTATION);
    const codes = menu.exercises.map((item) => item.code);
    expect(codes[0]).toBe('NK1');
    expect(codes.slice(-2)).toEqual(['NK10', 'NK11']);
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
    const progression = baseProgression({ push: { chainLevel: 4, currentReps: 14 } });
    const item = dose('PR3', { progression });
    expect(item.variant).toBe('с пола');
    expect(item.target).toBe(14);
    // Подходы и отдых — из дозы самого упражнения.
    expect(item.sets).toBe(exercise('PR3').dose.sets);
    expect(item.restSec).toBe(exercise('PR3').dose.restSec);
  });

  it('ступень с паузой меняет время повтора и его расшифровку', () => {
    const progression = baseProgression({ push: { chainLevel: 5, currentReps: 10 } });
    const item = dose('PR3', { progression });
    expect(item.repSec).toBe(6);
    expect(item.repNote).toContain('пауза 2 с');
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
    expect(item.target).toBe(10);
  });

  it('перерос упражнение — берётся его самая трудная ступень с верхней границей', () => {
    const progression = baseProgression({ row: { chainLevel: 7, exerciseCode: 'RW6' } });
    const item = dose('RW7', { progression });
    expect(item.variant).toBe('ноги на возвышении');
    expect(item.target).toBe(15);
  });

  it('удержание: цель — секунды одного удержания, сколько их — в holds', () => {
    // Chin tuck: подбородок назад и держать, а не «10 повторов по 5 секунд» (ADR-017).
    const item = dose('NK1');
    expect(item.unit).toBe('seconds');
    expect(item.target).toBe(exercise('NK1').repSec);
    expect(item.target).toBeGreaterThanOrEqual(30);
    expect(item.holds).toBe(exercise('NK1').dose.reps);
  });

  it('упражнение вне лестниц берёт свою дозу и гирю из инвентаря', () => {
    const item = dose('PR1');
    expect(item.sets).toBe(exercise('PR1').dose.sets);
    expect(item.target).toBe(exercise('PR1').dose.reps);
    expect(item.repSec).toBe(exercise('PR1').repSec);
    expect(item.weight).toBe(5);
  });

  it('боль в шее режет объём так же, как в программе дня', () => {
    expect(dose('PR3', { adaptation: adaptationFor(2) }).sets).toBe(2);
  });

  it('позиция — порядковый номер в тренировке по теме', () => {
    expect(dose('NK1', { position: 4 }).position).toBe(4);
  });
});
