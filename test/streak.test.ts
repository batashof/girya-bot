import { describe, expect, it } from 'vitest';
import { countStreak } from '../src/domain/streak';
import { localWeekday, type LocalDate, type Weekday } from '../src/domain/time';

const weekdayOf = (date: LocalDate): Weekday => localWeekday(new Date(`${date}T12:00:00Z`), 'UTC');

/** Суббота помечена опциональной: её пропуск ничего не ломает (docs/05). */
const OPTIONAL = new Set<Weekday>([6]);

function streak(options: { done: string[]; today: string; paused?: string[] }): number {
  return countStreak({
    done: new Set(options.done),
    paused: new Set(options.paused ?? []),
    today: options.today,
    weekdayOf,
    optionalWeekdays: OPTIONAL,
  });
}

describe('countStreak', () => {
  it('считает подряд идущие дни', () => {
    // 10–12 августа 2026 — понедельник, вторник, среда.
    expect(streak({ done: ['2026-08-10', '2026-08-11', '2026-08-12'], today: '2026-08-12' })).toBe(
      3,
    );
  });

  it('не считает сегодняшний день пропуском, пока он не прожит', () => {
    expect(streak({ done: ['2026-08-10', '2026-08-11'], today: '2026-08-12' })).toBe(2);
  });

  it('прощает один пропуск в неделю', () => {
    // Вторник пропущен, но серия продолжается — иначе первый занятый день обнуляет месяц.
    expect(streak({ done: ['2026-08-10', '2026-08-12', '2026-08-13'], today: '2026-08-13' })).toBe(
      3,
    );
  });

  it('на втором пропуске за неделю серия рвётся', () => {
    expect(streak({ done: ['2026-08-10', '2026-08-13', '2026-08-14'], today: '2026-08-14' })).toBe(
      2,
    );
  });

  it('разрешает второй пропуск, если он в другой неделе', () => {
    // Пропуски 12 августа и 4 августа — между ними больше семи дней.
    const done = [
      '2026-08-13',
      '2026-08-11',
      '2026-08-10',
      '2026-08-09',
      '2026-08-08',
      '2026-08-07',
      '2026-08-06',
      '2026-08-05',
      '2026-08-03',
      '2026-08-02',
    ];
    expect(streak({ done, today: '2026-08-13' })).toBe(10);
  });

  it('не тратит заморозку на пропущенную субботу', () => {
    // 15 августа 2026 — суббота, день по желанию.
    const done = ['2026-08-17', '2026-08-16', '2026-08-14', '2026-08-13'];
    expect(streak({ done, today: '2026-08-17' })).toBe(4);
  });

  it('не рвёт серию на паузе', () => {
    const done = ['2026-08-12', '2026-08-06', '2026-08-05'];
    const paused = ['2026-08-11', '2026-08-10', '2026-08-09', '2026-08-08', '2026-08-07'];
    expect(streak({ done, today: '2026-08-12', paused })).toBe(3);
  });

  it('пустая история — нулевая серия', () => {
    expect(streak({ done: [], today: '2026-08-12' })).toBe(0);
  });
});
