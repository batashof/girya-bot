import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadChainSteps, loadExercises } from '../../data/repositories/exercises';
import { cacheBuiltinMedia, loadMedia, saveMedia } from '../../data/repositories/media';
import type { Exercise } from '../../domain/types';
import { resolveDemo } from '../demo';
import { demoLink, renderHowto } from '../ui/howto';
import { buttons, texts } from '../ui/texts';
import { type BotDeps } from '../deps';

/**
 * `/howto <код>` — техника и типичные ошибки, и `/gif <код>` — своя демонстрация.
 *
 * Гифка не хостится нигде: Telegram хранит файл сам, а бот запоминает только `file_id`
 * и переотправляет его сколько угодно раз бесплатно (ADR-014).
 */
export function registerHowto(bot: Bot, deps: BotDeps): void {
  bot.command('howto', async (ctx) => {
    await showHowto(ctx, deps, ctx.match.trim());
  });

  bot.callbackQuery(/^h:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHowto(ctx, deps, ctx.callbackQuery.data.slice(2));
  });

  // Гифка приходит обычным сообщением с подписью «/gif PR3».
  bot.on(['message:animation', 'message:video', 'message:photo'], async (ctx, next) => {
    const caption = ctx.message.caption?.trim() ?? '';
    const match = /^\/gif\s+(\S+)/i.exec(caption);
    if (match === null) {
      await next();
      return;
    }
    await attachMedia(ctx, deps, match[1] ?? '');
  });

  bot.command('gif', async (ctx) => {
    await ctx.reply(texts.howto.gifHelp);
  });
}

async function showHowto(ctx: Context, deps: BotDeps, query: string): Promise<void> {
  const exercises = await loadExercises(deps.db);
  const exercise = findExercise(exercises, query);

  if (exercise === null) {
    await ctx.reply(query === '' ? texts.howto.usage : texts.howto.notFound(query));
    return;
  }

  const [steps, media] = await Promise.all([loadChainSteps(deps.db), loadMedia(deps.db)]);
  const demo = resolveDemo(exercise.code, media);

  const text = renderHowto({ exercise, steps, hasMedia: demo !== null });
  const keyboard = new InlineKeyboard().url(buttons.demo, demoLink(exercise));

  if (demo === null) {
    await ctx.reply(text, { reply_markup: keyboard });
    return;
  }

  // Подпись у медиа ограничена 1024 символами — длинную технику шлём отдельным сообщением.
  const caption = text.length <= 1000 ? { caption: text, reply_markup: keyboard } : {};
  if (demo.kind === 'animation') {
    const message = await ctx.replyWithAnimation(demo.file, caption);
    if (demo.fromBundle) {
      await cacheBuiltinMedia(deps.db, exercise.code, message.animation.file_id);
    }
  } else if (demo.kind === 'photo') {
    await ctx.replyWithPhoto(demo.file, caption);
  } else {
    await ctx.replyWithVideo(demo.file, caption);
  }

  if (text.length > 1000) {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function attachMedia(ctx: Context, deps: BotDeps, code: string): Promise<void> {
  const exercises = await loadExercises(deps.db);
  const exercise = findExercise(exercises, code);
  if (exercise === null) {
    await ctx.reply(texts.howto.notFound(code));
    return;
  }

  const message = ctx.message;
  const fileId =
    message?.animation?.file_id ??
    message?.video?.file_id ??
    message?.photo?.at(-1)?.file_id ??
    null;
  if (fileId === null) {
    await ctx.reply(texts.howto.gifHelp);
    return;
  }

  const kind =
    message?.animation !== undefined
      ? 'animation'
      : message?.video !== undefined
        ? 'video'
        : 'photo';
  await saveMedia(deps.db, { exerciseCode: exercise.code, fileId, kind, source: 'user' });
  await ctx.reply(texts.howto.gifSaved(exercise.name, exercise.code));
}

/** Поиск по коду, а если не вышло — по началу названия: коды помнить необязательно. */
function findExercise(exercises: Map<string, Exercise>, query: string): Exercise | null {
  const trimmed = query.trim();
  if (trimmed === '') {
    return null;
  }

  const byCode = exercises.get(trimmed.toUpperCase());
  if (byCode !== undefined) {
    return byCode;
  }

  const needle = trimmed.toLowerCase();
  for (const exercise of exercises.values()) {
    if (exercise.name.toLowerCase().startsWith(needle)) {
      return exercise;
    }
  }
  for (const exercise of exercises.values()) {
    if (exercise.name.toLowerCase().includes(needle)) {
      return exercise;
    }
  }
  return null;
}
