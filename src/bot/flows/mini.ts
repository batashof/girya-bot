import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadExercises } from '../../data/repositories/exercises';
import { countMiniToday, recordMiniSession } from '../../data/repositories/sessions';
import { loadMiniBlocks, loadTemplate } from '../../data/repositories/templates';
import { getUser } from '../../data/repositories/users';
import { weekInBlock } from '../../domain/program';
import { localMoment } from '../../domain/time';
import type { SetRecord } from '../../domain/types';
import { texts } from '../ui/texts';
import { userIdOf, type BotDeps } from '../deps';

/**
 * Микро-блоки `/mini` (ADR-013): три минуты между делами, без переодевания.
 *
 * Пишутся отдельной сессией и не влияют ни на прогрессию, ни на серию: иначе три
 * разминки шеи за день дали бы ложное «выполнено» и подделали статистику.
 */
export function registerMini(bot: Bot, deps: BotDeps): void {
  bot.command('mini', async (ctx) => {
    await showMenu(ctx, deps);
  });

  bot.callbackQuery(/^m:/, async (ctx) => {
    const [, action = '', code = ''] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();

    if (action === 'menu') {
      await showMenu(ctx, deps);
      return;
    }
    if (action === 'block') {
      await showBlock(ctx, deps, code);
      return;
    }
    if (action === 'done') {
      await finishBlock(ctx, deps, code);
    }
  });
}

async function showMenu(ctx: Context, deps: BotDeps): Promise<void> {
  const blocks = await loadMiniBlocks(deps.db);
  const keyboard = new InlineKeyboard();
  for (const block of blocks) {
    keyboard.text(block.title, `m:block:${block.code}`);
  }
  await ctx.reply(texts.mini.menu, { reply_markup: keyboard });
}

async function showBlock(ctx: Context, deps: BotDeps, code: string): Promise<void> {
  const [template, exercises] = await Promise.all([
    loadTemplate(deps.db, code),
    loadExercises(deps.db),
  ]);
  if (template === null) {
    return;
  }

  const lines = [`${template.title} — ${template.estMinutes} мин`, ''];
  for (const item of template.items) {
    const exercise = exercises.get(item.exerciseCode);
    if (exercise === undefined) {
      continue;
    }
    const side = exercise.unilateral ? ' / сторону' : '';
    const unit = exercise.unit === 'seconds' ? ' с' : '';
    lines.push(`• ${exercise.name} — ${item.targetMin}${unit}${side}`);
    lines.push(`  ${exercise.cues}`);
  }

  await ctx.reply(lines.join('\n'), {
    reply_markup: new InlineKeyboard().text(texts.mini.doneButton, `m:done:${code}`),
  });
}

async function finishBlock(ctx: Context, deps: BotDeps, code: string): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
    return;
  }
  const template = await loadTemplate(deps.db, code);
  if (template === null) {
    return;
  }

  const moment = localMoment(new Date(), user.timezone);
  const records: SetRecord[] = template.items.map((item) => ({
    position: item.position,
    exerciseCode: item.exerciseCode,
    setIndex: 1,
    targetValue: item.targetMin,
    actualValue: item.targetMin,
    feedback: 'ok',
  }));

  await recordMiniSession(deps.db, user.telegramId, {
    localDate: moment.date,
    templateCode: template.code,
    weekInBlock: weekInBlock(user.blockStart, moment.date),
    records,
  });

  const count = await countMiniToday(deps.db, user.telegramId, moment.date);
  await ctx.reply(texts.mini.done(template.title, count));
}
