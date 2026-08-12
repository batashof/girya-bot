import type { Context } from 'grammy';

/** Всё, что командам нужно снаружи. Передаётся явно, чтобы не тянуть Workers-контекст в bot/. */
export interface BotDeps {
  db: D1Database;
  ownerId: number;
}

/**
 * Guard владельца стоит первым middleware, поэтому до обработчиков доходят только апдейты
 * с известным `from`. Если он всё же пуст — это баг, и падать лучше громко.
 */
export function userIdOf(ctx: Context): number {
  const id = ctx.from?.id;
  if (id === undefined) {
    throw new Error('Апдейт без отправителя дошёл до обработчика');
  }
  return id;
}
