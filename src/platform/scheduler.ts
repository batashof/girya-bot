import { Api, InlineKeyboard } from 'grammy';
import { markSent, sentToday } from '../data/repositories/reminders';
import { levelChangesSince, loadSessionSummaries } from '../data/repositories/stats';
import { getMainSession } from '../data/repositories/sessions';
import { allUsers, updateUser } from '../data/repositories/users';
import { dueReminders, type ReminderKind } from '../domain/reminders';
import { weekInBlock } from '../domain/program';
import { summarizeWeeks } from '../domain/stats';
import { addDays, localMoment } from '../domain/time';
import type { User } from '../domain/types';
import { loadDay } from '../bot/day';
import { neckKeyboard } from '../bot/flows/neck';
import { buttons, texts } from '../bot/ui/texts';
import { renderWorkout } from '../bot/ui/workout';
import { renderWeeklyReport } from '../bot/ui/stats';
import { readConfig, type Env } from './env';

/**
 * Cron каждые 5 минут: кому по его локальному времени пора напомнить (docs/02-architecture.md).
 * Точность ±5 минут для утреннего напоминания более чем достаточна.
 */
export async function handleScheduled(_event: ScheduledController, env: Env): Promise<void> {
  const config = readConfig(env);
  const api = new Api(config.botToken);
  const now = new Date();

  for (const user of await allUsers(env.DB)) {
    try {
      await notifyUser(env.DB, api, user, now);
    } catch (failure) {
      // Один сломавшийся пользователь не должен ронять рассылку остальным.
      console.error(`напоминание для ${user.telegramId} не ушло`, failure);
    }
  }
}

async function notifyUser(db: D1Database, api: Api, user: User, now: Date): Promise<void> {
  const moment = localMoment(now, user.timezone);
  const session = await getMainSession(db, user.telegramId, moment.date);

  const kinds = dueReminders({
    moment,
    remindAt: user.remindAt,
    eveningPingAt: user.eveningPingAt,
    miniReminders: user.miniReminders,
    pausedUntil: user.pausedUntil,
    snoozeUntil: user.snoozeUntil,
    alreadySent: await sentToday(db, user.telegramId, moment.date),
    mainStatus: session?.status ?? 'none',
    now,
  });

  for (const kind of kinds) {
    await send(db, api, user, kind);
    await markSent(db, user.telegramId, moment.date, kind);
  }
}

async function send(db: D1Database, api: Api, user: User, kind: ReminderKind): Promise<void> {
  switch (kind) {
    case 'morning': {
      // Отложенное напоминание отработало — снимаем перенос.
      if (user.snoozeUntil !== null) {
        await updateUser(db, user.telegramId, { snooze_until: null });
      }
      const day = await loadDay(db, user, localMoment(new Date(), user.timezone));
      const header =
        day === null
          ? texts.noTemplate
          : `${renderWorkout(day.workout, day.moment.weekday)}\n\n${texts.neck.question}`;
      await api.sendMessage(user.telegramId, header, {
        parse_mode: 'HTML',
        reply_markup: neckKeyboard(),
      });
      return;
    }
    case 'evening': {
      await api.sendMessage(user.telegramId, texts.reminders.evening, {
        reply_markup: new InlineKeyboard()
          .text(buttons.shortVersion, 'w:short')
          .row()
          .text(buttons.skipToday, 'w:skipday'),
      });
      return;
    }
    case 'weekly_report': {
      await api.sendMessage(user.telegramId, await weeklyReport(db, user));
      return;
    }
    case 'mini_midday':
    case 'mini_afternoon': {
      await api.sendMessage(user.telegramId, texts.reminders.mini, {
        reply_markup: new InlineKeyboard().text(buttons.miniNow, 'm:menu'),
      });
      return;
    }
  }
}

/** Недельный отчёт воскресным вечером (docs/04-bot-ux.md). */
async function weeklyReport(db: D1Database, user: User): Promise<string> {
  const today = localMoment(new Date(), user.timezone).date;
  const sessions = await loadSessionSummaries(db, user.telegramId, addDays(today, -21));
  const weeks = summarizeWeeks(sessions, today, 2);
  const week = weeks[0];
  if (week === undefined) {
    return texts.stats.empty;
  }

  return renderWeeklyReport({
    week,
    previous: weeks[1],
    changes: await levelChangesSince(db, user.telegramId, `${week.from} 00:00:00`),
    // Отчёт приходит в воскресенье вечером, поэтому «следующая неделя» — та, что с завтра.
    nextWeekIsDeload: weekInBlock(user.blockStart, addDays(today, 1)) === 4,
  });
}
