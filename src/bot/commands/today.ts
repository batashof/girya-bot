import { InlineKeyboard, type Bot } from 'grammy';
import { getUser } from '../../data/repositories/users';
import { localMoment } from '../../domain/time';
import { loadDay } from '../day';
import { buttons, texts } from '../ui/texts';
import { renderWorkout } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/** `/today` — тренировка на сегодня текстом плюс кнопка «Начать» (docs/04-bot-ux.md). */
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
    const day = await loadDay(deps.db, user, moment);
    if (day === null) {
      await ctx.reply(texts.noTemplate);
      return;
    }

    await ctx.reply(renderWorkout(day.workout, moment.weekday), {
      reply_markup: new InlineKeyboard().text(buttons.start, 'w:start'),
    });
  });
}
