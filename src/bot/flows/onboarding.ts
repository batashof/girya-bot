import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadChainSteps, loadExercises } from '../../data/repositories/exercises';
import { initProgression, loadProgression } from '../../data/repositories/progression';
import { loadTemplateForWeekday } from '../../data/repositories/templates';
import {
  ensureUser,
  getUser,
  setKettlebells,
  updateUser,
  type UserPatch,
} from '../../data/repositories/users';
import { clearUiState, getUiState, setUiState } from '../../data/repositories/ui-state';
import { STARTER_KETTLEBELLS } from '../../data/starter';
import { resolveWorkout } from '../../domain/program';
import { addDays, isValidTimezone, localMoment } from '../../domain/time';
import type { Kettlebell } from '../../domain/types';
import { buttons, texts } from '../ui/texts';
import { renderWorkout } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/**
 * Онбординг из docs/04-bot-ux.md: восемь вопросов, всё кнопками кроме чисел.
 *
 * Состояние шага лежит в `ui_state`, а не в памяти воркера: изолят живёт секунды,
 * а пауза между вопросами — сколько угодно.
 */

const SCREEN = 'onboarding';

type Step = 'timezone' | 'remind' | 'minutes' | 'profile' | 'bells' | 'gear' | 'level' | 'mini';

interface State {
  step: Step;
  /** Ждём ответ текстом, а не кнопкой. */
  awaitingText?: boolean;
  gear?: { bar: boolean; band: boolean; backpack: boolean };
}

const TIMEZONES = ['Europe/Warsaw', 'Europe/Moscow', 'Europe/Berlin', 'Asia/Tbilisi'];
const REMIND_TIMES = ['06:30', '07:00', '07:30', '08:00'];
const MINUTES = [10, 15, 20, 25];

export function registerOnboarding(bot: Bot, deps: BotDeps): void {
  bot.command('start', async (ctx) => {
    const userId = userIdOf(ctx);
    // Пояс ещё не известен — до первого ответа считаем дату по умолчанию из схемы.
    const today = localMoment(new Date(), 'Europe/Warsaw').date;
    await ensureUser(deps.db, userId, today);
    await setUiState<State>(deps.db, userId, SCREEN, { step: 'timezone' });
    await ctx.reply(texts.onboarding.intro, { reply_markup: timezoneKeyboard() });
  });

  bot.callbackQuery(/^ob:/, async (ctx) => {
    const userId = userIdOf(ctx);
    const state = await getUiState<State>(deps.db, userId);
    if (state === null || state.screen !== SCREEN) {
      await ctx.answerCallbackQuery();
      return;
    }

    const [, field = '', value = ''] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();
    await handleChoice(ctx, deps, state.payload, field, value);
  });

  bot.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) {
      await next();
      return;
    }
    const state = await getUiState<State>(deps.db, userIdOf(ctx));
    if (state === null || state.screen !== SCREEN || state.payload.awaitingText !== true) {
      await next();
      return;
    }
    await handleText(ctx, deps, state.payload, ctx.message.text.trim());
  });
}

async function handleChoice(
  ctx: Context,
  deps: BotDeps,
  state: State,
  field: string,
  value: string,
): Promise<void> {
  const userId = userIdOf(ctx);

  switch (field) {
    case 'tz': {
      if (value === 'other') {
        await save(deps, userId, { ...state, awaitingText: true });
        await ctx.reply(texts.onboarding.timezoneCustom);
        return;
      }
      await updateUser(deps.db, userId, { timezone: value });
      await ask(ctx, deps, 'remind');
      return;
    }
    case 'remind': {
      if (value === 'other') {
        await save(deps, userId, { ...state, awaitingText: true });
        await ctx.reply(texts.onboarding.remindCustom);
        return;
      }
      await updateUser(deps.db, userId, { remind_at: value });
      await ask(ctx, deps, 'minutes');
      return;
    }
    case 'minutes': {
      await updateUser(deps.db, userId, { session_minutes: Number(value) });
      await ask(ctx, deps, 'profile');
      return;
    }
    case 'bells': {
      await setKettlebells(deps.db, userId, [...STARTER_KETTLEBELLS]);
      await ask(ctx, deps, 'gear');
      return;
    }
    case 'gear': {
      const gear = state.gear ?? { bar: false, band: false, backpack: true };
      if (value === 'done') {
        await updateUser(deps.db, userId, {
          has_pullup_bar: gear.bar ? 1 : 0,
          has_band: gear.band ? 1 : 0,
          has_backpack: gear.backpack ? 1 : 0,
        });
        await ask(ctx, deps, 'level');
        return;
      }
      const toggled = { ...gear, [value]: !gear[value as keyof typeof gear] };
      await save(deps, userId, { ...state, gear: toggled });
      await ctx.reply(texts.onboarding.gear, { reply_markup: gearKeyboard(toggled) });
      return;
    }
    case 'level': {
      await updateUser(deps.db, userId, { level: value });
      await ask(ctx, deps, 'mini');
      return;
    }
    case 'mini': {
      await updateUser(deps.db, userId, { mini_reminders: value === 'yes' ? 1 : 0 });
      await finish(ctx, deps);
      return;
    }
    default:
      return;
  }
}

async function handleText(ctx: Context, deps: BotDeps, state: State, text: string): Promise<void> {
  const userId = userIdOf(ctx);

  switch (state.step) {
    case 'timezone': {
      if (!isValidTimezone(text)) {
        await ctx.reply(texts.onboarding.timezoneInvalid);
        return;
      }
      await updateUser(deps.db, userId, { timezone: text });
      await ask(ctx, deps, 'remind');
      return;
    }
    case 'remind': {
      const time = parseTime(text);
      if (time === null) {
        await ctx.reply(texts.onboarding.remindInvalid);
        return;
      }
      await updateUser(deps.db, userId, { remind_at: time });
      await ask(ctx, deps, 'minutes');
      return;
    }
    case 'profile': {
      const profile = parseProfile(text);
      if (profile === null) {
        await ctx.reply(texts.onboarding.profileInvalid);
        return;
      }
      await updateUser(deps.db, userId, profile);
      await ask(ctx, deps, 'bells');
      return;
    }
    case 'bells': {
      const bells = parseKettlebells(text);
      if (bells === null) {
        await ctx.reply(texts.onboarding.bellsInvalid);
        return;
      }
      await setKettlebells(deps.db, userId, bells);
      await ask(ctx, deps, 'gear');
      return;
    }
    default:
      return;
  }
}

/** Задать следующий вопрос и запомнить, на каком шаге мы стоим. */
async function ask(ctx: Context, deps: BotDeps, step: Step): Promise<void> {
  const userId = userIdOf(ctx);

  switch (step) {
    case 'remind':
      await save(deps, userId, { step });
      await ctx.reply(texts.onboarding.remind, { reply_markup: remindKeyboard() });
      return;
    case 'minutes':
      await save(deps, userId, { step });
      await ctx.reply(texts.onboarding.minutes, { reply_markup: minutesKeyboard() });
      return;
    case 'profile':
      await save(deps, userId, { step, awaitingText: true });
      await ctx.reply(texts.onboarding.profile);
      return;
    case 'bells':
      await save(deps, userId, { step, awaitingText: true });
      await ctx.reply(texts.onboarding.bells, { reply_markup: bellsKeyboard() });
      return;
    case 'gear': {
      const gear = { bar: false, band: false, backpack: true };
      await save(deps, userId, { step, gear });
      await ctx.reply(texts.onboarding.gear, { reply_markup: gearKeyboard(gear) });
      return;
    }
    case 'level':
      await save(deps, userId, { step });
      await ctx.reply(texts.onboarding.level, { reply_markup: levelKeyboard() });
      return;
    case 'mini':
      await save(deps, userId, { step });
      await ctx.reply(texts.onboarding.mini, { reply_markup: miniKeyboard() });
      return;
    default:
      return;
  }
}

/** Финал: расставить стартовые ступени лестниц и показать завтрашний день. */
async function finish(ctx: Context, deps: BotDeps): Promise<void> {
  const userId = userIdOf(ctx);
  const user = await getUser(deps.db, userId);
  if (user === null) {
    return;
  }

  const chainSteps = await loadChainSteps(deps.db);
  await initProgression(deps.db, userId, user, chainSteps);
  await clearUiState(deps.db, userId);

  const bells = user.kettlebells.map((bell) => `${bell.weight}×${bell.count}`).join(', ');
  const summary = [
    `Пояс: ${user.timezone}, напоминание в ${user.remindAt}`,
    `Бюджет: ${user.sessionMinutes} мин`,
    user.heightCm === null ? null : `Профиль: ${user.heightCm}/${user.weightKg}`,
    bells === '' ? null : `Гири: ${bells}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  await ctx.reply(texts.onboarding.done(summary));

  const tomorrow = addDays(localMoment(new Date(), user.timezone).date, 1);
  const weekday = (localMoment(new Date(), user.timezone).weekday % 7) + 1;
  const template = await loadTemplateForWeekday(deps.db, weekday);
  if (template === null) {
    return;
  }

  const workout = resolveWorkout({
    date: tomorrow,
    template,
    user,
    exercises: await loadExercises(deps.db),
    chainSteps,
    progression: await loadProgression(deps.db, userId),
  });
  await ctx.reply(`${texts.onboarding.tomorrow}\n\n${renderWorkout(workout, weekday)}`);
}

async function save(deps: BotDeps, userId: number, state: State): Promise<void> {
  await setUiState<State>(deps.db, userId, SCREEN, state);
}

function timezoneKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const zone of TIMEZONES) {
    keyboard.text(zone.split('/')[1] ?? zone, `ob:tz:${zone}`).row();
  }
  return keyboard.text(buttons.timezoneOther, 'ob:tz:other');
}

function remindKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const time of REMIND_TIMES) {
    keyboard.text(time, `ob:remind:${time}`);
  }
  return keyboard.row().text(buttons.remindOther, 'ob:remind:other');
}

function minutesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const minutes of MINUTES) {
    keyboard.text(`${minutes}`, `ob:minutes:${minutes}`);
  }
  return keyboard;
}

function bellsKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.bellsDefault, 'ob:bells:default');
}

function gearKeyboard(gear: { bar: boolean; band: boolean; backpack: boolean }): InlineKeyboard {
  const mark = (on: boolean, label: string): string => `${on ? '✅' : '▫️'} ${label}`;
  return new InlineKeyboard()
    .text(mark(gear.bar, buttons.gearBar), 'ob:gear:bar')
    .row()
    .text(mark(gear.band, buttons.gearBand), 'ob:gear:band')
    .row()
    .text(mark(gear.backpack, buttons.gearBackpack), 'ob:gear:backpack')
    .row()
    .text(buttons.gearDone, 'ob:gear:done');
}

function levelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.levelBase, 'ob:level:base')
    .row()
    .text(buttons.levelStrong, 'ob:level:strong');
}

function miniKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.yes, 'ob:mini:yes').text(buttons.no, 'ob:mini:no');
}

export function parseTime(text: string): string | null {
  const match = /^([01]?\d|2[0-3])[:. ]([0-5]\d)$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

export function parseProfile(text: string): UserPatch | null {
  const numbers = text.match(/\d+(?:[.,]\d+)?/g);
  if (numbers === null || numbers.length < 3) {
    return null;
  }
  const [height, weight, age] = numbers.map((value) => Number(value.replace(',', '.')));
  if (height === undefined || weight === undefined || age === undefined) {
    return null;
  }
  if (height < 120 || height > 230 || weight < 35 || weight > 250 || age < 14 || age > 100) {
    return null;
  }
  return {
    height_cm: Math.round(height),
    weight_kg: weight,
    birth_year: new Date().getUTCFullYear() - Math.round(age),
  };
}

export function parseKettlebells(text: string): Kettlebell[] | null {
  const numbers = text.match(/\d+(?:[.,]\d+)?/g);
  if (numbers === null || numbers.length === 0) {
    return null;
  }
  const counts = new Map<number, number>();
  for (const raw of numbers) {
    const weight = Number(raw.replace(',', '.'));
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
      return null;
    }
    counts.set(weight, (counts.get(weight) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([weight, count]) => ({ weight, count }))
    .sort((left, right) => left.weight - right.weight);
}
