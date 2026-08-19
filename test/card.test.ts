import { describe, expect, it } from 'vitest';
import { resolveWorkout } from '../src/domain/program';
import { toSteps } from '../src/domain/session';
import { renderCard, renderDone } from '../src/bot/ui/workout';
import type { Workout } from '../src/domain/types';
import {
  baseProgression,
  defaultUser,
  loadChainSteps,
  loadExercises,
  templateFor,
} from './fixtures';

const exercises = loadExercises();
const chainSteps = loadChainSteps();

/** Лимит подписи к медиа в Telegram: длиннее — и карточка уедет без схемы движения. */
const CAPTION_LIMIT = 1024;

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

function allCards(): { code: string; text: string }[] {
  const cards: { code: string; text: string }[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const steps = toSteps(workoutFor(weekday));
    for (const step of steps) {
      for (let set = 1; set <= step.sets; set += 1) {
        cards.push({ code: step.item.exercise.code, text: renderCard(steps, step.index, set) });
      }
    }
  }
  return cards;
}

describe('карточка упражнения', () => {
  it('влезает в подпись к схеме движения', () => {
    for (const card of allCards()) {
      expect(card.text.length, card.code).toBeLessThanOrEqual(CAPTION_LIMIT);
    }
  });

  it('называет упражнение, объём и время', () => {
    const steps = toSteps(workoutFor(1));
    const row = steps.find((step) => step.item.exercise.code === 'RW1')!;
    const card = renderCard(steps, row.index, 2);

    expect(card).toContain('<b>Тяга одной рукой в наклоне</b>');
    expect(card).toContain('Подход 2 из 3');
    expect(card).toContain('3 подхода по 12 повторов на каждую сторону');
    expect(card).toContain('Гиря 5 кг');
    expect(card).toMatch(/Осталось ~\d+ мин/);
  });

  it('у удержания показывает секунды, а не повторы', () => {
    const steps = toSteps(workoutFor(1));
    const hold = steps.find((step) => step.item.unit === 'seconds')!;
    const card = renderCard(steps, hold.index, 1);

    expect(card).toContain('секунд удержания');
    expect(card).not.toContain('повтор');
  });

  it('всегда называет число подходов рядом с объёмом', () => {
    // Иначе «30 секунд» — это число, а не задание: непонятно, сколько раз.
    for (const card of allCards()) {
      expect(card.text, card.code).toMatch(/🔁 (Один подход:|\d+ подход)/);
    }
  });

  it('раздаёт объём по сторонам, когда подход всего один', () => {
    // «Один подход: 30 секунд на каждую сторону» читается как «всего 30 секунд».
    const steps = toSteps(workoutFor(1));
    const single = steps.find((step) => step.sets === 1 && step.item.unilateral)!;

    expect(renderCard(steps, single.index, 1)).toContain('Один подход: по ');
  });

  it('расшифровывает шкалу оценки: у кнопок нет подписей', () => {
    const steps = toSteps(workoutFor(1));
    expect(renderCard(steps, 0, 1)).toContain('😮‍💨 тяжело · 👌 нормально · 😴 легко');
  });

  it('разбивает технику на пронумерованные шаги', () => {
    const steps = toSteps(workoutFor(1));
    const card = renderCard(steps, 0, 1);

    expect(card).toContain('Как делать:');
    expect(card).toContain('\n1. ');
    expect(card).toContain('\n2. ');
  });

  it('прогресс-бар заполняется от пустого к полному', () => {
    const steps = toSteps(workoutFor(1));
    const first = renderCard(steps, 0, 1).split('\n')[0]!;
    const last = renderCard(steps, steps.length - 1, steps.at(-1)!.sets).split('\n')[0]!;

    expect(first.startsWith('▱▱▱▱▱▱▱▱')).toBe(true);
    expect(last.startsWith('▰▰▰▰▰▰▰')).toBe(true);
  });

  it('сворачивает пройденное упражнение в одну строку', () => {
    const steps = toSteps(workoutFor(1));
    const row = steps.find((step) => step.item.exercise.code === 'RW1')!;

    expect(renderDone(row, 'done')).toBe('✅ Тяга одной рукой в наклоне · 3×12');
    expect(renderDone(row, 'pain')).toContain('🤕');
  });
});
