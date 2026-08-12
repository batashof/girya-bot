import type { Bot } from 'grammy';
import { loadChainSteps, loadExercises } from '../../data/repositories/exercises';
import { loadProgression } from '../../data/repositories/progression';
import { loadTemplateForWeekday } from '../../data/repositories/templates';
import { getUser } from '../../data/repositories/users';
import { resolveWorkout } from '../../domain/program';
import { localMoment } from '../../domain/time';
import { texts } from '../ui/texts';
import { renderWorkout } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/** `/today` — тренировка на сегодня текстом (docs/04-bot-ux.md). */
export function registerToday(bot: Bot, deps: BotDeps): void {
  bot.command('today', async (ctx) => {
    const userId = userIdOf(ctx);
    const user = await getUser(deps.db, userId);
    if (user === null) {
      await ctx.reply(texts.needOnboarding);
      return;
    }

    // День недели считается в поясе пользователя: иначе утро понедельника
    // по Варшаве было бы ещё воскресеньем по UTC.
    const moment = localMoment(new Date(), user.timezone);
    const template = await loadTemplateForWeekday(deps.db, moment.weekday);
    if (template === null) {
      await ctx.reply(texts.noTemplate);
      return;
    }

    const workout = resolveWorkout({
      date: moment.date,
      template,
      user,
      exercises: await loadExercises(deps.db),
      chainSteps: await loadChainSteps(deps.db),
      progression: await loadProgression(deps.db, userId),
    });

    await ctx.reply(renderWorkout(workout, moment.weekday));
  });
}
