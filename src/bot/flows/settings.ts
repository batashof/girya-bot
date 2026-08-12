import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadChainSteps } from '../../data/repositories/exercises';
import { loadProgression, saveProgression } from '../../data/repositories/progression';
import { getUser, setKettlebells, updateUser } from '../../data/repositories/users';
import { clearUiState, getUiState, setUiState } from '../../data/repositories/ui-state';
import { addDays, isValidTimezone, localMoment } from '../../domain/time';
import type { Chain, User } from '../../domain/types';
import { buttons, texts } from '../ui/texts';
import { parseKettlebells, parseProfile, parseTime } from './onboarding';
import { userIdOf, type BotDeps } from '../deps';

/**
 * `/settings` (docs/04-bot-ux.md). Каждый пункт правится отдельно, всё кнопками кроме чисел.
 *
 * Экран «Уровни» существует потому, что без него бот упрямее, чем нужно: после перерыва
 * или ошибки алгоритма ступень должна правиться руками.
 */

const SCREEN = 'settings';

interface State {
  field: 'timezone' | 'remind' | 'profile' | 'bells';
}

const CHAINS: Chain[] = ['push', 'row', 'squat', 'hinge', 'core'];
const CHAIN_TITLES: Record<Chain, string> = {
  push: 'Отжимания',
  row: 'Тяга',
  squat: 'Присед',
  hinge: 'Тазовый шарнир',
  core: 'Кор',
};

export function registerSettings(bot: Bot, deps: BotDeps): void {
  bot.command('settings', async (ctx) => {
    await showMenu(ctx, deps);
  });

  bot.command('pause', async (ctx) => {
    await pause(ctx, deps, ctx.match.trim());
  });

  bot.callbackQuery(/^s:/, async (ctx) => {
    const [, action = '', value = ''] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();
    await handle(ctx, deps, action, value);
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) {
      await next();
      return;
    }
    const stored = await getUiState<State>(deps.db, userIdOf(ctx));
    if (stored === null || stored.screen !== SCREEN) {
      await next();
      return;
    }
    await handleText(ctx, deps, stored.payload, ctx.message.text.trim());
  });
}

async function showMenu(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(`⏰ ${user.remindAt}`, 's:remind:')
    .text(`🌍 ${user.timezone}`, 's:timezone:')
    .row()
    .text(`⏱ ${user.sessionMinutes} мин`, 's:minutes:')
    .text('🏋️ Инвентарь', 's:gear:')
    .row()
    .text(`📏 ${profileLine(user)}`, 's:profile:')
    .text(`🔔 Микро-блоки: ${user.miniReminders ? 'вкл' : 'выкл'}`, 's:mini:')
    .row()
    .text('📶 Уровни', 's:levels:')
    .text('⏸ Пауза', 's:pause:');

  await ctx.reply(texts.settings.menu, { reply_markup: keyboard });
}

async function handle(ctx: Context, deps: BotDeps, action: string, value: string): Promise<void> {
  const userId = userIdOf(ctx);

  switch (action) {
    case 'remind':
      await setUiState<State>(deps.db, userId, SCREEN, { field: 'remind' });
      await ctx.reply(texts.onboarding.remindCustom);
      return;
    case 'timezone':
      await setUiState<State>(deps.db, userId, SCREEN, { field: 'timezone' });
      await ctx.reply(texts.onboarding.timezoneCustom);
      return;
    case 'profile':
      await setUiState<State>(deps.db, userId, SCREEN, { field: 'profile' });
      await ctx.reply(texts.onboarding.profile);
      return;
    case 'bells':
      await setUiState<State>(deps.db, userId, SCREEN, { field: 'bells' });
      await ctx.reply(texts.onboarding.bells);
      return;
    case 'minutes': {
      if (value === '') {
        await ctx.reply(texts.onboarding.minutes, { reply_markup: minutesKeyboard() });
        return;
      }
      await updateUser(deps.db, userId, { session_minutes: Number(value) });
      await done(ctx, deps);
      return;
    }
    case 'mini': {
      const user = await getUser(deps.db, userId);
      if (user === null) {
        return;
      }
      await updateUser(deps.db, userId, { mini_reminders: user.miniReminders ? 0 : 1 });
      await done(ctx, deps);
      return;
    }
    case 'gear': {
      if (value === '') {
        await showGear(ctx, deps);
        return;
      }
      await toggleGear(ctx, deps, value);
      return;
    }
    case 'levels': {
      await showLevels(ctx, deps);
      return;
    }
    case 'level': {
      await shiftLevel(ctx, deps, value);
      return;
    }
    case 'pause': {
      if (value === '') {
        await ctx.reply(texts.settings.pause, { reply_markup: pauseKeyboard() });
        return;
      }
      await pause(ctx, deps, value);
      return;
    }
    default:
      return;
  }
}

async function handleText(ctx: Context, deps: BotDeps, state: State, text: string): Promise<void> {
  const userId = userIdOf(ctx);

  switch (state.field) {
    case 'remind': {
      const time = parseTime(text);
      if (time === null) {
        await ctx.reply(texts.onboarding.remindInvalid);
        return;
      }
      await updateUser(deps.db, userId, { remind_at: time });
      break;
    }
    case 'timezone': {
      if (!isValidTimezone(text)) {
        await ctx.reply(texts.onboarding.timezoneInvalid);
        return;
      }
      await updateUser(deps.db, userId, { timezone: text });
      break;
    }
    case 'profile': {
      const profile = parseProfile(text);
      if (profile === null) {
        await ctx.reply(texts.onboarding.profileInvalid);
        return;
      }
      await updateUser(deps.db, userId, profile);
      break;
    }
    case 'bells': {
      const bells = parseKettlebells(text);
      if (bells === null) {
        await ctx.reply(texts.onboarding.bellsInvalid);
        return;
      }
      await setKettlebells(deps.db, userId, bells);
      break;
    }
  }

  await clearUiState(deps.db, userId);
  await done(ctx, deps);
}

async function showGear(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    return;
  }
  const mark = (on: boolean, label: string): string => `${on ? '✅' : '▫️'} ${label}`;
  const keyboard = new InlineKeyboard()
    .text(mark(user.hasPullupBar, buttons.gearBar), 's:gear:bar')
    .row()
    .text(mark(user.hasBand, buttons.gearBand), 's:gear:band')
    .row()
    .text(mark(user.hasBackpack, buttons.gearBackpack), 's:gear:backpack')
    .row()
    .text(`🏋️ Гири: ${bellsLine(user)}`, 's:bells:');

  await ctx.reply(texts.onboarding.gear, { reply_markup: keyboard });
}

async function toggleGear(ctx: Context, deps: BotDeps, item: string): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    return;
  }
  const patch =
    item === 'bar'
      ? { has_pullup_bar: user.hasPullupBar ? 0 : 1 }
      : item === 'band'
        ? { has_band: user.hasBand ? 0 : 1 }
        : { has_backpack: user.hasBackpack ? 0 : 1 };

  await updateUser(deps.db, user.telegramId, patch);
  await showGear(ctx, deps);
}

async function showLevels(ctx: Context, deps: BotDeps): Promise<void> {
  const userId = userIdOf(ctx);
  const [progression, chainSteps] = await Promise.all([
    loadProgression(deps.db, userId),
    loadChainSteps(deps.db),
  ]);

  const keyboard = new InlineKeyboard();
  for (const chain of CHAINS) {
    const state = progression.get(chain);
    if (state === undefined) {
      continue;
    }
    const top = chainSteps.filter((step) => step.chain === chain).length;
    keyboard
      .text(`${CHAIN_TITLES[chain]}: ${state.chainLevel} из ${top}`, `s:level:${chain}`)
      .text('−', `s:level:${chain}-`)
      .text('+', `s:level:${chain}+`)
      .row();
  }

  await ctx.reply(texts.settings.levels, { reply_markup: keyboard });
}

/** Ручной сдвиг ступени: цель по повторам сбрасывается на нижнюю границу новой ступени. */
async function shiftLevel(ctx: Context, deps: BotDeps, value: string): Promise<void> {
  const direction = value.endsWith('+') ? 1 : value.endsWith('-') ? -1 : 0;
  if (direction === 0) {
    return;
  }
  const chain = value.slice(0, -1) as Chain;
  const userId = userIdOf(ctx);
  const [progression, chainSteps] = await Promise.all([
    loadProgression(deps.db, userId),
    loadChainSteps(deps.db),
  ]);

  const state = progression.get(chain);
  if (state === undefined) {
    return;
  }
  const steps = chainSteps
    .filter((step) => step.chain === chain)
    .sort((left, right) => left.level - right.level);
  const target = steps.find((step) => step.level === state.chainLevel + direction);
  if (target === undefined) {
    await showLevels(ctx, deps);
    return;
  }

  await saveProgression(deps.db, userId, [
    {
      ...state,
      chainLevel: target.level,
      exerciseCode: target.exerciseCode,
      tempo: target.tempo,
      currentReps: target.targetMin,
      hardStreak: 0,
      easyStreak: 0,
    },
  ]);
  await showLevels(ctx, deps);
}

async function pause(ctx: Context, deps: BotDeps, value: string): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
    return;
  }

  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days) || days <= 0) {
    await updateUser(deps.db, user.telegramId, { paused_from: null, paused_until: null });
    await ctx.reply(texts.settings.resumed);
    return;
  }

  const today = localMoment(new Date(), user.timezone).date;
  const until = addDays(today, days - 1);
  await updateUser(deps.db, user.telegramId, { paused_from: today, paused_until: until });
  await ctx.reply(texts.settings.paused(until));
}

async function done(ctx: Context, deps: BotDeps): Promise<void> {
  await ctx.reply(texts.settings.saved);
  await showMenu(ctx, deps);
}

function minutesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const minutes of [10, 15, 20, 25]) {
    keyboard.text(String(minutes), `s:minutes:${minutes}`);
  }
  return keyboard;
}

function pauseKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('1 день', 's:pause:1')
    .text('3 дня', 's:pause:3')
    .text('7 дней', 's:pause:7')
    .row()
    .text('Снять паузу', 's:pause:0');
}

function profileLine(user: User): string {
  if (user.heightCm === null) {
    return 'Профиль';
  }
  const age = user.birthYear === null ? '' : `/${new Date().getUTCFullYear() - user.birthYear}`;
  return `${user.heightCm}/${user.weightKg ?? '—'}${age}`;
}

function bellsLine(user: User): string {
  return user.kettlebells.map((bell) => `${bell.weight}×${bell.count}`).join(', ') || '—';
}
