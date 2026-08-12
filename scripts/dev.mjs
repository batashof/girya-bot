/**
 * Локальная разработка: `wrangler dev` поднимает воркер с локальной D1, а этот скрипт
 * играет роль Telegram — long-polling у dev-бота и проброс апдейтов в локальный вебхук.
 *
 * Так в разработке исполняется ровно тот же код, что и в проде (docs/08-deployment.md),
 * и не нужен ни туннель, ни публичный URL.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = `http://127.0.0.1:${PORT}`;

const vars = readDevVars('.dev.vars');
const token = vars.BOT_TOKEN;
const secret = vars.WEBHOOK_SECRET;
const path = vars.WEBHOOK_PATH ?? '/tg/dev';

if (!token || !secret) {
  console.error('Нет .dev.vars с BOT_TOKEN и WEBHOOK_SECRET. Скопируй .dev.vars.example.');
  process.exit(1);
}

const worker = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(PORT)], {
  stdio: 'inherit',
});
worker.on('exit', (code) => process.exit(code ?? 0));

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    worker.kill(signal);
  });
}

await waitForWorker();
await telegram('deleteWebhook', { drop_pending_updates: false });
console.log(`\n[dev] бот в polling, апдейты идут в ${HOST}${path}\n`);

let offset = 0;
while (!stopping) {
  let updates;
  try {
    updates = await telegram('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message', 'callback_query'],
    });
  } catch (failure) {
    console.error('[dev] getUpdates упал, повтор через 3 с:', failure.message);
    await sleep(3000);
    continue;
  }

  for (const update of updates) {
    offset = update.update_id + 1;
    try {
      const response = await fetch(`${HOST}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': secret,
        },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        console.error(`[dev] воркер ответил ${response.status}: ${await response.text()}`);
      }
    } catch (failure) {
      console.error('[dev] не достучался до воркера:', failure.message);
    }
  }
}

function readDevVars(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    result[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return result;
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(HOST, { method: 'GET' });
      return;
    } catch {
      await sleep(500);
    }
  }
  console.error(`[dev] воркер не поднялся на ${HOST}`);
  process.exit(1);
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) {
    throw new Error(`${method}: ${body.description ?? response.status}`);
  }
  return body.result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
