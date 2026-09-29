import type { Api } from 'grammy';
import { lastEventPayload, logEvent } from '../data/repositories/stats';
import { menuCommands } from '../bot/ui/texts';

const EVENT = 'commands_synced';

/**
 * Меню команд Telegram — из кода, а не из @BotFather. Раньше его заполняли руками,
 * и новые команды (например, `/train`) в меню не попадали.
 *
 * Выставляется на cron, но только когда список изменился: последний отправленный
 * список лежит в журнале `events`, так что лишних запросов в Telegram нет.
 */
export async function syncCommands(db: D1Database, api: Api, ownerId: number): Promise<void> {
  const current = JSON.stringify(menuCommands);
  if ((await lastEventPayload(db, EVENT)) === current) {
    return;
  }
  await api.setMyCommands(menuCommands);
  await logEvent(db, ownerId, EVENT, menuCommands);
  console.log(`меню команд обновлено: ${menuCommands.length} команд`);
}
