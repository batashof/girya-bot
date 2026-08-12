import { minutesOfDay, type LocalMoment, type LocalTime } from './time';

/**
 * Кому и что пора отправить. Чистая функция: cron каждые 5 минут спрашивает её
 * по каждому пользователю, а платформенный код только рассылает результат.
 */

export type ReminderKind =
  'morning' | 'evening' | 'mini_midday' | 'mini_afternoon' | 'weekly_report';

export interface ReminderInput {
  moment: LocalMoment;
  remindAt: LocalTime;
  eveningPingAt: LocalTime | null;
  miniReminders: boolean;
  /** Пауза по болезни или поездке: молчим совсем (docs/04). */
  pausedUntil: string | null;
  /** Момент, до которого утреннее напоминание отложено кнопкой «Через час», UTC ISO. */
  snoozeUntil: string | null;
  /** Что уже отправлено сегодня — из `reminders_log`, чтобы cron не слал дубли. */
  alreadySent: ReadonlySet<ReminderKind>;
  /** Статус основной тренировки дня: вечерний пинг нужен только если она не закрыта. */
  mainStatus: 'none' | 'planned' | 'in_progress' | 'done' | 'skipped';
  /** Текущий момент в UTC — для сравнения с отложенным напоминанием. */
  now: Date;
}

/**
 * Окно, в котором напоминание ещё имеет смысл. Cron может не сработать или воркер
 * может быть недоступен; но присылать «доброе утро» в обед — хуже, чем промолчать.
 */
const WINDOW_MINUTES = 90;

const SUNDAY = 7;

const MINI_TIMES: Record<'mini_midday' | 'mini_afternoon', LocalTime> = {
  mini_midday: '12:00',
  mini_afternoon: '16:00',
};

export function dueReminders(input: ReminderInput): ReminderKind[] {
  if (isPaused(input)) {
    return [];
  }

  const nowMinutes = minutesOfDay(input.moment.time);
  const due: ReminderKind[] = [];

  if (!input.alreadySent.has('morning') && isMorningDue(input, nowMinutes)) {
    due.push('morning');
  }

  if (
    input.eveningPingAt !== null &&
    !input.alreadySent.has('evening') &&
    input.mainStatus !== 'done' &&
    input.mainStatus !== 'skipped' &&
    inWindow(nowMinutes, minutesOfDay(input.eveningPingAt))
  ) {
    due.push('evening');
  }

  // Недельный отчёт — воскресным вечером, вместе с добивочным пингом (docs/04).
  if (
    input.eveningPingAt !== null &&
    input.moment.weekday === SUNDAY &&
    !input.alreadySent.has('weekly_report') &&
    inWindow(nowMinutes, minutesOfDay(input.eveningPingAt))
  ) {
    due.push('weekly_report');
  }

  // Микро-блоки — только в рабочие дни: на выходных человек и так не за столом.
  if (input.miniReminders && input.moment.weekday <= 5) {
    for (const [kind, time] of Object.entries(MINI_TIMES) as [
      'mini_midday' | 'mini_afternoon',
      LocalTime,
    ][]) {
      if (!input.alreadySent.has(kind) && inWindow(nowMinutes, minutesOfDay(time))) {
        due.push(kind);
      }
    }
  }

  return due;
}

function isMorningDue(input: ReminderInput, nowMinutes: number): boolean {
  if (input.snoozeUntil !== null) {
    // Отложенное напоминание живёт по своим часам и окном не ограничено:
    // пользователь сам попросил разбудить его позже.
    return input.now.getTime() >= Date.parse(input.snoozeUntil);
  }
  if (input.mainStatus === 'done' || input.mainStatus === 'skipped') {
    return false;
  }
  return inWindow(nowMinutes, minutesOfDay(input.remindAt));
}

function inWindow(nowMinutes: number, targetMinutes: number): boolean {
  return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + WINDOW_MINUTES;
}

function isPaused(input: ReminderInput): boolean {
  return input.pausedUntil !== null && input.moment.date <= input.pausedUntil;
}
