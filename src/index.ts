import { webhookCallback } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { createBot } from './bot/bot';
import { readConfig, type Config, type Env } from './platform/env';
import { handleScheduled } from './platform/scheduler';

/**
 * Два входа в воркер: вебхук Telegram и cron (docs/02-architecture.md).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let config: Config;
    try {
      config = readConfig(env);
    } catch (failure) {
      console.error('некорректная конфигурация воркера', failure);
      return new Response('misconfigured', { status: 500 });
    }

    const url = new URL(request.url);
    // Путь со случайным сегментом — первый барьер.
    if (request.method !== 'POST' || url.pathname !== config.webhookPath) {
      return new Response('not found', { status: 404 });
    }

    // Секрет проверяем сами и до всего остального: чужой запрос не должен приводить
    // ни к обращению к базе, ни к вызову Telegram (docs/02-architecture.md).
    const secret = request.headers.get('x-telegram-bot-api-secret-token');
    if (secret === null || !constantTimeEquals(secret, config.webhookSecret)) {
      return new Response('unauthorized', { status: 401 });
    }

    return handleUpdate(request, config, env);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event, env));
  },
} satisfies ExportedHandler<Env>;

/**
 * Данные о боте кэшируются на изолят: без этого grammY дёргал бы `getMe` на каждое
 * сообщение. Сам бот создаётся заново — он держит биндинги из `env` текущего запроса.
 */
let cachedBotInfo: UserFromGetMe | undefined;

async function handleUpdate(request: Request, config: Config, env: Env): Promise<Response> {
  const bot = createBot({ token: config.botToken, ownerId: config.ownerId, db: env.DB });
  if (cachedBotInfo !== undefined) {
    bot.botInfo = cachedBotInfo;
  }

  const handle = webhookCallback(bot, 'cloudflare-mod', { secretToken: config.webhookSecret });
  const response = await handle(request);

  if (cachedBotInfo === undefined && bot.isInited()) {
    cachedBotInfo = bot.botInfo;
  }
  return response;
}

/** Сравнение без ранних выходов: не даём подбирать секрет по времени ответа. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
