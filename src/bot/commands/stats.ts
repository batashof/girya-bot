import { InputFile, type Bot } from 'grammy';
import { loadChainSteps, loadExercises } from '../../data/repositories/exercises';
import { loadProgression } from '../../data/repositories/progression';
import { doneDates } from '../../data/repositories/sessions';
import { exportRows, loadSessionSummaries } from '../../data/repositories/stats';
import { getUser } from '../../data/repositories/users';
import { painAfterTraining, summarizeWeeks, weeksOfHistory } from '../../domain/stats';
import { longestStreak } from '../../domain/streak';
import {
  addDays,
  localMoment,
  localWeekday,
  type LocalDate,
  type Weekday,
} from '../../domain/time';
import { texts } from '../ui/texts';
import { renderStats, renderStreak } from '../ui/stats';
import { currentStreak } from '../streak';
import { userIdOf, type BotDeps } from '../deps';

/** `/stats`, `/streak`, `/export` (docs/04-bot-ux.md). */

/** Сколько недель показывать в сводке. */
const WEEKS = 4;

const OPTIONAL_WEEKDAYS = new Set<Weekday>([6]);

export function registerStats(bot: Bot, deps: BotDeps): void {
  bot.command('stats', async (ctx) => {
    const user = await getUser(deps.db, userIdOf(ctx));
    if (user === null) {
      await ctx.reply(texts.needOnboarding);
      return;
    }

    const today = localMoment(new Date(), user.timezone).date;
    const [sessions, progression, chainSteps, exercises] = await Promise.all([
      loadSessionSummaries(deps.db, user.telegramId, addDays(today, -WEEKS * 7 - 7)),
      loadProgression(deps.db, user.telegramId),
      loadChainSteps(deps.db),
      loadExercises(deps.db),
    ]);

    if (sessions.length === 0) {
      await ctx.reply(texts.stats.empty);
      return;
    }

    await ctx.reply(
      renderStats({
        weeks: summarizeWeeks(sessions, today, WEEKS),
        progression,
        chainSteps,
        exercises,
        pain: painAfterTraining(sessions),
        weeksOfHistory: weeksOfHistory(sessions, today),
      }),
    );
  });

  bot.command('streak', async (ctx) => {
    const user = await getUser(deps.db, userIdOf(ctx));
    if (user === null) {
      await ctx.reply(texts.needOnboarding);
      return;
    }

    const today = localMoment(new Date(), user.timezone).date;
    const done = await doneDates(deps.db, user.telegramId, today);
    const record = longestStreak({
      done,
      paused: new Set<LocalDate>(),
      today,
      weekdayOf: (date) => localWeekday(new Date(`${date}T12:00:00Z`), 'UTC'),
      optionalWeekdays: OPTIONAL_WEEKDAYS,
    });

    await ctx.reply(renderStreak(await currentStreak(deps.db, user, today), record));
  });

  bot.command('export', async (ctx) => {
    const user = await getUser(deps.db, userIdOf(ctx));
    if (user === null) {
      await ctx.reply(texts.needOnboarding);
      return;
    }

    const rows = await exportRows(deps.db, user.telegramId);
    if (rows.length === 0) {
      await ctx.reply(texts.stats.empty);
      return;
    }

    const csv = toCsv(rows);
    await ctx.replyWithDocument(
      new InputFile(
        new TextEncoder().encode(csv),
        `girya-${localMoment(new Date(), user.timezone).date}.csv`,
      ),
      { caption: texts.stats.exported(rows.length) },
    );
  });
}

/** CSV без зависимостей: экранируем кавычки и оборачиваем всё в них. */
function toCsv(rows: Record<string, string | number | null>[]): string {
  const first = rows[0];
  if (first === undefined) {
    return '';
  }
  const columns = Object.keys(first);
  const lines = [columns.join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column])).join(','));
  }
  return lines.join('\n');
}

function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
