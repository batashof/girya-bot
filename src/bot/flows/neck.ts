import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { ensurePlannedSession, setNeckScore } from '../../data/repositories/sessions';
import { getUser } from '../../data/repositories/users';
import { isNeckScore } from '../../domain/adaptation';
import { localMoment } from '../../domain/time';
import { loadDay } from '../day';
import { buttons, texts } from '../ui/texts';
import { renderWorkout } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/**
 * Ежедневный вопрос про шею и реакция на боль (docs/04-bot-ux.md, docs/10-safety.md).
 *
 * Боль — вход в систему, а не ошибка: ответ 2 убирает из дня то, что грузит шею,
 * и режет объём; ответ 3 заменяет день восстановительным протоколом.
 */
export function registerNeck(bot: Bot, deps: BotDeps): void {
  bot.command('pain', async (ctx) => {
    await ctx.reply(texts.neck.question, { reply_markup: neckKeyboard() });
  });

  bot.callbackQuery(/^n:[0-3]$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const score = Number(ctx.callbackQuery.data.split(':')[1]);
    if (!isNeckScore(score)) {
      return;
    }
    await recordScore(ctx, deps, score);
  });
}

async function recordScore(ctx: Context, deps: BotDeps, score: 0 | 1 | 2 | 3): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
    return;
  }

  const moment = localMoment(new Date(), user.timezone);
  // Оценку нужно куда-то записать до начала тренировки — заводим заготовку дня.
  const beforeScore = await loadDay(deps.db, user, moment);
  if (beforeScore === null) {
    await ctx.reply(texts.noTemplate);
    return;
  }
  const session = await ensurePlannedSession(deps.db, user.telegramId, {
    localDate: moment.date,
    templateCode: beforeScore.workout.templateCode,
    weekInBlock: beforeScore.weekInBlock,
  });
  await setNeckScore(deps.db, session.id, score);

  // День пересобирается уже с новой оценкой.
  const day = await loadDay(deps.db, user, moment);
  if (day === null) {
    await ctx.reply(texts.noTemplate);
    return;
  }

  const parts = [texts.neck.saved(score), '', renderWorkout(day.workout, moment.weekday)];
  if (day.adaptation.showRedFlags) {
    parts.push(texts.neck.redFlags);
  }

  await ctx.reply(parts.join('\n'), { reply_markup: dayKeyboard() });
}

/** Кнопки под планом дня из утреннего сценария (docs/04). */
export function dayKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.start, 'w:start')
    .text(buttons.snooze, 'w:snooze')
    .row()
    .text(buttons.swapMenu, 'w:swapmenu')
    .text(buttons.skipToday, 'w:skipday');
}

export function neckKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.neck0, 'n:0')
    .text(buttons.neck1, 'n:1')
    .text(buttons.neck2, 'n:2')
    .text(buttons.neck3, 'n:3');
}
