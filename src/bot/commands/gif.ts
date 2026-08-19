import { type Bot, type Context } from 'grammy';
import { loadExercises } from '../../data/repositories/exercises';
import { saveMedia } from '../../data/repositories/media';
import type { Exercise } from '../../domain/types';
import { texts } from '../ui/texts';
import { type BotDeps } from '../deps';

/**
 * `/gif <код>` — заменить встроенную схему движения своей гифкой.
 *
 * Файл не хостится нигде: Telegram хранит его сам, а бот запоминает только `file_id`
 * и переотправляет его сколько угодно раз бесплатно (ADR-014). Отдельного экрана
 * с техникой нет — она целиком в карточке подхода (ADR-015).
 */
export function registerGif(bot: Bot, deps: BotDeps): void {
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
    await ctx.reply(texts.gif.help);
  });
}

async function attachMedia(ctx: Context, deps: BotDeps, code: string): Promise<void> {
  const exercises = await loadExercises(deps.db);
  const exercise = findExercise(exercises, code);
  if (exercise === null) {
    await ctx.reply(texts.gif.notFound(code));
    return;
  }

  const message = ctx.message;
  const fileId =
    message?.animation?.file_id ??
    message?.video?.file_id ??
    message?.photo?.at(-1)?.file_id ??
    null;
  if (fileId === null) {
    await ctx.reply(texts.gif.help);
    return;
  }

  const kind =
    message?.animation !== undefined
      ? 'animation'
      : message?.video !== undefined
        ? 'video'
        : 'photo';
  await saveMedia(deps.db, { exerciseCode: exercise.code, fileId, kind, source: 'user' });
  await ctx.reply(texts.gif.saved(exercise.name));
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
