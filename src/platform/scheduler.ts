import type { Env } from './env';

/**
 * Точка входа cron-триггера (каждые 5 минут).
 *
 * Здесь появится подбор пользователей по локальному времени и отправка напоминаний — M4
 * (docs/01-plan.md). Пока триггер включён и молчит: так лимиты и расписание проверяются
 * до того, как от них начнёт зависеть утренняя тренировка.
 */
export async function handleScheduled(_event: ScheduledController, _env: Env): Promise<void> {
  return;
}
