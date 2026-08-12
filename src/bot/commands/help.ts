import type { Bot } from 'grammy';
import { texts } from '../ui/texts';

export function registerHelp(bot: Bot): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(texts.help);
  });
}
