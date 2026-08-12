import { addDays, type LocalDate, type Weekday } from './time';

/**
 * Серия тренировок.
 *
 * Считается назад от сегодня. Один пропуск в неделю прощается — «заморозка» из
 * docs/01-plan.md: цель режима в том, чтобы пропуск ничего не ломал (ADR-006),
 * иначе первый же занятый вторник обнуляет мотивацию за месяц.
 */

export interface StreakInput {
  /** Даты, когда основная тренировка закрыта как выполненная. */
  done: ReadonlySet<LocalDate>;
  /** Дни паузы по болезни или поездке: серию не рвут и заморозку не тратят. */
  paused: ReadonlySet<LocalDate>;
  today: LocalDate;
  weekdayOf: (date: LocalDate) => Weekday;
  /** Дни недели, пропуск которых ничего не ломает: суббота помечена опциональной. */
  optionalWeekdays: ReadonlySet<Weekday>;
}

/** На сколько дней назад распространяется одна заморозка. */
const FREEZE_WINDOW = 7;

/** Дальше этого назад не считаем: серия в годы всё равно упирается в здравый смысл. */
const MAX_LOOKBACK = 400;

/**
 * Рекордная серия за всю историю. Считается тем же правилом, что и текущая,
 * поэтому рекорд и текущая величина сравнимы между собой.
 */
export function longestStreak(input: StreakInput): number {
  const dates = [...input.done].sort();
  let record = 0;
  for (const date of dates) {
    record = Math.max(record, countStreak({ ...input, today: date }));
  }
  return record;
}

export function countStreak(input: StreakInput): number {
  let streak = 0;
  let cursor = input.today;
  const freezes: number[] = [];

  for (let step = 0; step < MAX_LOOKBACK; step += 1) {
    if (input.done.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
      continue;
    }

    // Сегодняшний день ещё не прожит: его отсутствие не пропуск.
    const isToday = step === 0;
    const forgiven =
      isToday || input.paused.has(cursor) || input.optionalWeekdays.has(input.weekdayOf(cursor));

    if (forgiven) {
      cursor = addDays(cursor, -1);
      continue;
    }

    const recentFreezes = freezes.filter((position) => step - position < FREEZE_WINDOW).length;
    if (recentFreezes > 0) {
      return streak;
    }

    freezes.push(step);
    cursor = addDays(cursor, -1);
  }

  return streak;
}
