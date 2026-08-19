import { Bot, type Context } from 'grammy';
import { registerHelp } from './commands/help';
import { registerPing } from './commands/ping';
import { registerGif } from './commands/gif';
import { registerStats } from './commands/stats';
import { registerToday } from './commands/today';
import { registerOnboarding } from './flows/onboarding';
import { registerWorkout } from './flows/workout';
import { registerNeck } from './flows/neck';
import { registerMini } from './flows/mini';
import { registerSettings } from './flows/settings';
import { texts } from './ui/texts';
import type { BotDeps } from './deps';

export interface BotOptions extends BotDeps {
  token: string;
}

/**
 * Сборка бота. Одна и та же для вебхука в проде и для polling в разработке —
 * различаются только точки входа (docs/02-architecture.md).
 */
export function createBot(options: BotOptions): Bot {
  const bot = new Bot(options.token);
  const deps: BotDeps = { db: options.db, ownerId: options.ownerId };

  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== options.ownerId) {
      await replySafely(ctx, texts.notOwner);
      return;
    }
    await next();
  });

  registerPing(bot);
  registerHelp(bot);
  registerToday(bot, deps);
  registerStats(bot, deps);
  registerGif(bot, deps);
  registerWorkout(bot, deps);
  registerNeck(bot, deps);
  registerMini(bot, deps);
  registerSettings(bot, deps);
  // Онбординг регистрируется последним: он ловит свободный текст и должен пропускать
  // мимо себя всё, что уже разобрали команды.
  registerOnboarding(bot, deps);

  bot.catch(async (failure) => {
    const where = describeUpdate(failure.ctx);
    console.error(`update failed at ${where}`, failure.error);

    await replySafely(failure.ctx, texts.crashed(where));
    // Отдельным сообщением — трейс. Для личного бота это весь алертинг (docs/02-architecture.md).
    try {
      await bot.api.sendMessage(
        options.ownerId,
        texts.crashReport(where, formatError(failure.error)),
      );
    } catch (reportFailure) {
      console.error('не удалось отправить отчёт об ошибке', reportFailure);
    }
  });

  return bot;
}

/** Короткое имя того, что бот пытался сделать: команда, кнопка или тип апдейта. */
function describeUpdate(ctx: Context): string {
  const text = ctx.message?.text ?? ctx.channelPost?.text;
  if (text?.startsWith('/') === true) {
    return text.split(/\s/)[0] ?? text;
  }
  const callbackData = ctx.callbackQuery?.data;
  if (callbackData !== undefined) {
    return callbackData;
  }
  return ctx.update.message !== undefined ? 'сообщение' : 'обновление';
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return (error.stack ?? `${error.name}: ${error.message}`).slice(0, 3500);
  }
  return String(error).slice(0, 3500);
}

/** Ответ, который не должен уронить обработчик ошибок: чат мог быть заблокирован. */
async function replySafely(ctx: Context, message: string): Promise<void> {
  if (ctx.chat === undefined) {
    return;
  }
  try {
    await ctx.reply(message);
  } catch (failure) {
    console.error('не удалось ответить в чат', failure);
  }
}
