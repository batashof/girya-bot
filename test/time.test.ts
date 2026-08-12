import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  isValidTimezone,
  localDate,
  localMoment,
  localWeekday,
  minutesOfDay,
} from '../src/domain/time';

describe('localMoment', () => {
  it('считает дату и время в поясе пользователя, а не в UTC', () => {
    // Утренняя тренировка 07:00 в Варшаве — это тот же календарный день, что и в UTC (05:00).
    expect(localMoment(new Date('2026-08-12T05:00:00Z'), 'Europe/Warsaw')).toEqual({
      date: '2026-08-12',
      time: '07:00',
      weekday: 3,
    });
  });

  it('переносит дату на следующий день там, где локальное время уже за полночь', () => {
    // Ровно ради этого случая local_date хранится в локальном поясе (docs/03-data-model.md).
    const instant = new Date('2026-01-15T23:30:00Z');
    expect(localDate(instant, 'UTC')).toBe('2026-01-15');
    expect(localDate(instant, 'Europe/Warsaw')).toBe('2026-01-16');
    expect(localWeekday(instant, 'Europe/Warsaw')).toBe(5);
  });

  it('учитывает летнее время', () => {
    // Зимой Варшава +1, летом +2 — смещение берётся из Intl, а не из константы.
    expect(localMoment(new Date('2026-01-15T12:00:00Z'), 'Europe/Warsaw').time).toBe('13:00');
    expect(localMoment(new Date('2026-07-15T12:00:00Z'), 'Europe/Warsaw').time).toBe('14:00');
  });

  it('отдаёт воскресенье как 7, а не как 0', () => {
    // Совпадает с нумерацией templates.weekday: 1 = Пн … 7 = Вс.
    expect(localWeekday(new Date('2026-08-16T12:00:00Z'), 'Europe/Warsaw')).toBe(7);
    expect(localWeekday(new Date('2026-08-17T12:00:00Z'), 'Europe/Warsaw')).toBe(1);
  });

  it('падает на несуществующем поясе', () => {
    expect(() => localMoment(new Date(), 'Europe/Atlantis')).toThrow();
  });
});

describe('minutesOfDay', () => {
  it('переводит HH:MM в минуты от полуночи', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('07:30')).toBe(450);
    expect(minutesOfDay('23:59')).toBe(1439);
  });

  it('не принимает мусор', () => {
    expect(() => minutesOfDay('7:30')).toThrow();
    expect(() => minutesOfDay('24:00')).toThrow();
    expect(() => minutesOfDay('утром')).toThrow();
  });
});

describe('addDays и daysBetween', () => {
  it('шагает по календарю через границы месяца и года', () => {
    expect(addDays('2026-08-12', 1)).toBe('2026-08-13');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-08-12', 28)).toBe('2026-09-09');
  });

  it('не сбивается на переходе на летнее время', () => {
    // 29 марта 2026 в Европе часы переводят вперёд: сутки короче, но календарный день целый.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('считает разницу в днях в обе стороны', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(daysBetween('2026-08-12', '2026-08-12')).toBe(0);
    expect(daysBetween('2026-08-12', '2026-08-05')).toBe(-7);
  });

  it('не принимает дату не в формате YYYY-MM-DD', () => {
    expect(() => addDays('12.08.2026', 1)).toThrow();
  });
});

describe('isValidTimezone', () => {
  it('отличает существующий пояс от выдуманного', () => {
    expect(isValidTimezone('Europe/Warsaw')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Atlantis')).toBe(false);
  });
});
