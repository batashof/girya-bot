/** Биндинги и переменные воркера. Единственное место, где мы знаем про Cloudflare. */
export interface Env {
  /** D1, см. docs/03-data-model.md */
  DB: D1Database;
  /** secret: токен от @BotFather */
  BOT_TOKEN: string;
  /** secret: значение `secret_token` вебхука */
  WEBHOOK_SECRET: string;
  /** var: мой Telegram id — единственный, кого бот обслуживает (ADR-005) */
  OWNER_TELEGRAM_ID: string;
  /** var: путь вебхука со случайным сегментом */
  WEBHOOK_PATH: string;
}

/** Разобранная и проверенная конфигурация. Дальше по коду ходит только она. */
export interface Config {
  botToken: string;
  webhookSecret: string;
  webhookPath: string;
  ownerId: number;
}

export class ConfigError extends Error {}

/**
 * Проверяем конфигурацию на входе, а не в момент использования: пустой `BOT_TOKEN`
 * должен падать понятной ошибкой в логе, а не «401 Unauthorized» из Telegram посреди тренировки.
 */
export function readConfig(env: Env): Config {
  const botToken = required(env.BOT_TOKEN, 'BOT_TOKEN');
  const webhookSecret = required(env.WEBHOOK_SECRET, 'WEBHOOK_SECRET');
  const webhookPath = required(env.WEBHOOK_PATH, 'WEBHOOK_PATH');
  const ownerRaw = required(env.OWNER_TELEGRAM_ID, 'OWNER_TELEGRAM_ID');

  if (!webhookPath.startsWith('/')) {
    throw new ConfigError('WEBHOOK_PATH должен начинаться со «/»');
  }

  const ownerId = Number(ownerRaw);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new ConfigError(`OWNER_TELEGRAM_ID должен быть числом, получено «${ownerRaw}»`);
  }

  return { botToken, webhookSecret, webhookPath, ownerId };
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '' || value.startsWith('REPLACE_WITH')) {
    throw new ConfigError(`Не задана переменная ${name}`);
  }
  return value;
}
