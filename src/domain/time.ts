/**
 * Работа с локальным временем пользователя.
 *
 * Вся программа привязана ко дню недели в часовом поясе пользователя, а не к UTC:
 * тренировка в 07:00 по Варшаве не должна попадать во вчерашний день (docs/03-data-model.md).
 * Модуль чистый: только `Intl`, никакой платформы.
 */

/** Дата вида `YYYY-MM-DD` в локальном поясе пользователя. */
export type LocalDate = string;

/** Время вида `HH:MM` (24 часа) в локальном поясе пользователя. */
export type LocalTime = string;

/** 1 = понедельник … 7 = воскресенье (как в `templates.weekday`). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LocalMoment {
  date: LocalDate;
  time: LocalTime;
  weekday: Weekday;
}

const WEEKDAY_BY_SHORT_NAME: Record<string, Weekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Момент времени в часовом поясе пользователя: дата, время и день недели сразу. */
export function localMoment(instant: Date, timezone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`Intl не вернул часть «${type}» для пояса ${timezone}`);
    }
    return part.value;
  };

  const weekday = WEEKDAY_BY_SHORT_NAME[value('weekday')];
  if (weekday === undefined) {
    throw new Error(`Неизвестный день недели «${value('weekday')}» для пояса ${timezone}`);
  }

  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
    weekday,
  };
}

export function localDate(instant: Date, timezone: string): LocalDate {
  return localMoment(instant, timezone).date;
}

export function localTime(instant: Date, timezone: string): LocalTime {
  return localMoment(instant, timezone).time;
}

export function localWeekday(instant: Date, timezone: string): Weekday {
  return localMoment(instant, timezone).weekday;
}

/** Минуты от полуночи — чтобы сравнивать «пора ли напоминать» без разбора строк по месту. */
export function minutesOfDay(time: LocalTime): number {
  if (!TIME_PATTERN.test(time)) {
    throw new Error(`Время должно быть в формате HH:MM, получено «${time}»`);
  }
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Календарная арифметика по строке даты, без часовых поясов:
 * `YYYY-MM-DD` + N дней — это всегда одна и та же дата в любом поясе.
 */
export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(toUtcMidnight(date) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/** Сколько календарных дней от `from` до `to` (отрицательное, если `to` раньше). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / 86_400_000);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function toUtcMidnight(date: LocalDate): number {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Дата должна быть в формате YYYY-MM-DD, получено «${date}»`);
  }
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Некорректная дата «${date}»`);
  }
  return timestamp;
}
