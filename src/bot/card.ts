import { InlineKeyboard, type Context } from 'grammy';
import { cacheBuiltinMedia, loadMedia } from '../data/repositories/media';
import { resolveDemo, type Demo } from './demo';
import { buttons } from './ui/texts';
import type { BotDeps } from './deps';

/**
 * Карточка упражнения — общая для программы дня и тренировки по теме (docs/04-bot-ux.md):
 * схема движения в картинке, задание и техника в подписи, шкала «как прошло» кнопками.
 */

/** Где лежит отправленная карточка. У карточки с картинкой правится подпись, а не текст. */
export interface CardRef {
  messageId: number;
  media: boolean;
}

/** Лимит подписи к медиа в Telegram. Карточка длиннее уедет обычным сообщением. */
const CAPTION_LIMIT = 1024;

/** Новая карточка: схема движения плюс задание в подписи. */
export async function sendExerciseCard(
  ctx: Context,
  deps: BotDeps,
  code: string | undefined,
  text: string,
  keyboard: InlineKeyboard,
): Promise<CardRef> {
  const options = { parse_mode: 'HTML' as const, reply_markup: keyboard };
  const demo = code === undefined ? null : resolveDemo(code, await loadMedia(deps.db));

  // Схема не должна съедать технику: если подпись не влезает, картинку не шлём.
  if (demo !== null && code !== undefined && text.length <= CAPTION_LIMIT) {
    const sent = await sendWithDemo(ctx, deps, demo, code, { caption: text, ...options });
    if (sent !== null) {
      return sent;
    }
  }

  const message = await ctx.reply(text, options);
  return { messageId: message.message_id, media: false };
}

/**
 * Отправка карточки со схемой. Возвращает `null`, если схему отправить не вышло —
 * тогда карточка уйдёт обычным сообщением: задание и техника важнее картинки, и
 * тренировка не должна вставать из-за медиа.
 */
async function sendWithDemo(
  ctx: Context,
  deps: BotDeps,
  demo: Demo,
  code: string,
  caption: object,
): Promise<CardRef | null> {
  let message;
  try {
    message =
      demo.kind === 'photo'
        ? await ctx.replyWithPhoto(demo.file, caption)
        : demo.kind === 'video'
          ? await ctx.replyWithVideo(demo.file, caption)
          : await ctx.replyWithAnimation(demo.file, caption);
  } catch (failure) {
    console.error(`не удалось отправить схему ${code}`, failure);
    return null;
  }

  // Кеш `file_id` — оптимизация, а не часть сценария: он экономит загрузку файла
  // (ADR-014), но упасть на нём и оставить тренировку без следующего шага нельзя.
  // Почти статичную гифку Telegram отдаёт документом, и поля `animation` в ответе нет.
  const fileId = 'animation' in message ? message.animation.file_id : undefined;
  if (demo.bundleDigest !== null && fileId !== undefined) {
    try {
      await cacheBuiltinMedia(deps.db, code, fileId, demo.bundleDigest);
    } catch (failure) {
      console.error(`не удалось запомнить file_id для ${code}`, failure);
    }
  }

  return { messageId: message.message_id, media: true };
}

/** Следующий подход того же упражнения: карточка перерисовывается на месте. */
export function editCard(
  ctx: Context,
  chatId: number,
  card: CardRef,
  text: string,
  keyboard: InlineKeyboard,
): Promise<unknown> {
  if (card.media) {
    return ctx.api.editMessageCaption(chatId, card.messageId, {
      caption: text,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
  return ctx.api.editMessageText(chatId, card.messageId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

/** Пройденное упражнение сжимается в одну строку без кнопок и остаётся в чате историей. */
export async function collapseCard(
  ctx: Context,
  chatId: number,
  card: CardRef,
  summary: string,
): Promise<void> {
  try {
    if (card.media) {
      await ctx.api.editMessageCaption(chatId, card.messageId, {
        caption: summary,
        parse_mode: 'HTML',
      });
      return;
    }
    await ctx.api.editMessageText(chatId, card.messageId, summary, { parse_mode: 'HTML' });
  } catch {
    // Не удалось свернуть — не повод ронять тренировку.
  }
}

/**
 * Кнопки карточки. Первый ряд — шкала «как прошло»: она же переход к следующему подходу
 * (docs/05). Второй ряд — выходы из упражнения, у них подписи остались: мимо шкалы туда
 * попадать не должно. `prefix` — чей это экран: `w` программа дня, `t` тема.
 */
export function scaleKeyboard(prefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.setHard, `${prefix}:hard`)
    .text(buttons.setDone, `${prefix}:done`)
    .text(buttons.setEasy, `${prefix}:easy`)
    .row()
    .text(buttons.setPain, `${prefix}:pain`)
    .text(buttons.setSkip, `${prefix}:skip`);
}
