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

  it('называет упражнение, повторы и время на повтор', () => {
    const steps = toSteps(workoutFor(1));
    const row = steps.find((step) => step.item.exercise.code === 'RW1')!;
    const card = renderCard(steps, row.index, 2);

    expect(card).toContain('<b>Тяга одной рукой в наклоне</b>');
    expect(card).toContain(`Подход 2 из ${row.sets} · сначала отдых ${row.item.restSec} с`);
    expect(card).toContain(`🔁 ${row.item.target} повторов на каждую сторону`);
    expect(card).toContain('⏱ Каждый повтор ~3 с: 1 с вверх, 2 с вниз');
    expect(card).toContain('Гиря 5 кг');
    // Время тренировки не планируется (ADR-018): ни «осталось», ни «примерно».
    expect(card).not.toMatch(/Осталось|мин/);
  });

  it('у первого подхода отдыха нет', () => {
    const steps = toSteps(workoutFor(1));
    const row = steps.find((step) => step.item.exercise.code === 'RW1')!;
    expect(renderCard(steps, row.index, 1)).not.toContain('отдых');
  });

  it('у удержания повтор — это сколько секунд держать', () => {
    // «Шею назад держи 30 с», а не «10 повторов, ~20 с на подход» (ADR-017).
    const steps = toSteps(workoutFor(1));
    const hold = steps.find((step) => step.item.exercise.code === 'NK1')!;
    const card = renderCard(steps, hold.index, 1);

    expect(card).toContain(`⏱ Держи ${hold.item.target} с`);
    expect(card).toMatch(/🔁 \d+ повтор/);
  });

  it('несколько удержаний подряд разделены короткой паузой', () => {
    const steps = toSteps(workoutFor(3));
    const hold = steps.find((step) => step.item.unit === 'seconds' && step.item.holds > 1)!;
    const card = renderCard(steps, hold.index, 1);

    expect(card).toContain(`🔁 ${hold.item.holds} повтор`);
    expect(card).toContain(`Каждый повтор — держи ${hold.item.target} с`);
  });

  it('каждая карточка называет подход и повторы или время', () => {
    for (const card of allCards()) {
      expect(card.text, card.code).toMatch(/Подход \d+ из \d+|Один подход/);
      expect(card.text, card.code).toMatch(/🔁 \d+ (повтор|шаг)|⏱ .+ без остановки/);
      expect(card.text, card.code).not.toContain('на подход');
    }
  });

  it('в технике нет чисел, спорящих с заданием', () => {
    for (const card of allCards()) {
      const technique = card.text.split('Как делать:')[1] ?? '';
      expect(technique, card.code).not.toMatch(/\d+\s*(секунд|сек|с\b|раз\b|повтор)/);
    }
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

    expect(renderDone(row, 'done')).toBe(
      `✅ Тяга одной рукой в наклоне · ${row.sets}×${row.item.target}`,
    );
    expect(renderDone(row, 'pain')).toContain('🤕');
  });
});
