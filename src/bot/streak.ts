import { doneDates } from '../data/repositories/sessions';
import { countStreak } from '../domain/streak';
import { addDays, localWeekday, type LocalDate, type Weekday } from '../domain/time';
import type { User } from '../domain/types';

/** Суббота помечена опциональной: её пропуск серию не рвёт (docs/05). */
const OPTIONAL_WEEKDAYS = new Set<Weekday>([6]);

/** Серия с учётом заморозки, паузы и опциональной субботы. */
export async function currentStreak(db: D1Database, user: User, today: LocalDate): Promise<number> {
  return countStreak({
    done: await doneDates(db, user.telegramId, today),
    paused: pausedDates(user),
    today,
    weekdayOf: (date) => localWeekday(new Date(`${date}T12:00:00Z`), 'UTC'),
    optionalWeekdays: OPTIONAL_WEEKDAYS,
  });
}

/** Дни паузы как множество дат: серия должна знать, какие именно прощать. */
function pausedDates(user: User): Set<LocalDate> {
  const dates = new Set<LocalDate>();
  if (user.pausedFrom === null || user.pausedUntil === null) {
    return dates;
  }
  let cursor = user.pausedFrom;
  for (let step = 0; step < 400 && cursor <= user.pausedUntil; step += 1) {
    dates.add(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}
