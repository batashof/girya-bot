import type { Bot } from 'grammy';
import { texts } from '../ui/texts';

/** Проверка живости прода: пишу `/ping` — приходит `pong` (docs/01-plan.md, M1). */
export function registerPing(bot: Bot): void {
  bot.command('ping', async (ctx) => {
    await ctx.reply(texts.pong);
  });
}
