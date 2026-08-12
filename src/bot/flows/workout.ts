import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadProgression, saveProgression } from '../../data/repositories/progression';
import {
  ensurePlannedSession,
  finishSession,
  loadSets,
  recordSets,
  skipSession,
  startMainSession,
} from '../../data/repositories/sessions';
import { saveSwap } from '../../data/repositories/swaps';
import { logEvent } from '../../data/repositories/stats';
import { unmarkSent } from '../../data/repositories/reminders';
import { getUser, updateUser } from '../../data/repositories/users';
import { clearUiState, getUiState, setUiState } from '../../data/repositories/ui-state';
import { advance } from '../../domain/progression';
import { chainOutcomes, recordsForStep, toSteps, type WorkoutStep } from '../../domain/session';
import { addDays, localMoment, nextWeekday } from '../../domain/time';
import type { Exercise, Feedback, PlannedItem, User } from '../../domain/types';
import { loadDay, type Day } from '../day';
import { currentStreak } from '../streak';
import { buttons, texts } from '../ui/texts';
import { renderCard, renderFinish, weekdayName } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/**
 * Пошаговый режим (docs/04-bot-ux.md): одно сообщение, которое редактируется на месте,
 * одна кнопка на подход. Позиция хранится в `ui_state`, факт — сразу в `session_sets`.
 */

const SCREEN = 'workout';

/** Сколько дней держится ручная замена (docs/06). */
const SWAP_DAYS = 7;

/** «Сокращённая версия» вечернего пинга: шея и одно основное движение (docs/04). */
const SHORT_MINUTES = 7;

/** На сколько откладывает кнопка «Через час». */
const SNOOZE_MINUTES = 60;

interface State {
  sessionId: number;
  /** Индекс шага в разбиении тренировки, 0-based. */
  step: number;
  /** Номер подхода внутри шага, 1-based. */
  set: number;
  messageId: number;
}

export function registerWorkout(bot: Bot, deps: BotDeps): void {
  bot.command('go', async (ctx) => {
    await start(ctx, deps);
  });

  bot.command('swap', async (ctx) => {
    await offerSwap(ctx, deps);
  });

  bot.command('skip', async (ctx) => {
    await skipToday(ctx, deps);
  });

  bot.callbackQuery(/^w:/, async (ctx) => {
    const [, action = '', argument = ''] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();
    await handleAction(ctx, deps, action, argument);
  });
}

async function start(ctx: Context, deps: BotDeps, budgetMinutes?: number): Promise<void> {
  const context = await currentContext(ctx, deps, budgetMinutes);
  if (context === null) {
    return;
  }
  const { user, day } = context;

  const session = await startMainSession(deps.db, user.telegramId, {
    localDate: day.moment.date,
    templateCode: day.workout.templateCode,
    weekInBlock: day.weekInBlock,
  });

  if (session.status === 'done') {
    await ctx.reply(texts.workout.alreadyDone);
    return;
  }

  const steps = toSteps(day.workout);
  // Продолжаем с того места, где остановились: подходы уже в базе.
  const recorded = await loadSets(deps.db, session.id);
  const position = resumePosition(steps, recorded);
  if (position === null) {
    await complete(ctx, deps, user, session.id, day);
    return;
  }

  const message = await ctx.reply(renderCard(steps[position.step]!, steps.length, position.set), {
    reply_markup: cardKeyboard(),
  });

  await setUiState<State>(deps.db, user.telegramId, SCREEN, {
    sessionId: session.id,
    step: position.step,
    set: position.set,
    messageId: message.message_id,
  });
}

async function handleAction(
  ctx: Context,
  deps: BotDeps,
  action: string,
  argument: string,
): Promise<void> {
  // Кнопки под планом дня приходят до того, как состояние тренировки вообще появилось.
  switch (action) {
    case 'start':
      await start(ctx, deps);
      return;
    case 'short':
      // Вечерний пинг: лучше семь минут, чем ноль — серия сохраняется (docs/04).
      await start(ctx, deps, SHORT_MINUTES);
      return;
    case 'snooze':
      await snooze(ctx, deps);
      return;
    case 'skipday':
      await skipToday(ctx, deps);
      return;
    case 'swapmenu':
      await offerSwap(ctx, deps);
      return;
    default:
      break;
  }

  const userId = userIdOf(ctx);
  const stored = await getUiState<State>(deps.db, userId);
  if (stored === null || stored.screen !== SCREEN) {
    await ctx.reply(texts.workout.noSession);
    return;
  }

  if (action === 'swapto') {
    await applySwap(ctx, deps, argument);
    return;
  }

  const feedback = FEEDBACK_BY_ACTION[action];
  if (feedback === undefined) {
    return;
  }
  await advanceStep(ctx, deps, stored.payload, feedback);
}

const FEEDBACK_BY_ACTION: Record<string, Feedback | undefined> = {
  done: 'ok',
  hard: 'hard',
  easy: 'easy',
  pain: 'pain',
  skip: 'skipped',
};

async function advanceStep(
  ctx: Context,
  deps: BotDeps,
  state: State,
  feedback: Feedback,
): Promise<void> {
  const context = await currentContext(ctx, deps);
  if (context === null) {
    return;
  }
  const { user, day } = context;
  const steps = toSteps(day.workout);
  const step = steps[state.step];
  if (step === undefined) {
    await clearUiState(deps.db, user.telegramId);
    return;
  }

  await recordSets(
    deps.db,
    state.sessionId,
    recordsForStep(step, state.set, feedback),
    step.items[0]?.weight ?? null,
  );

  // «Больно» и «пропустить» снимают всё упражнение, а не один подход:
  // добивать через боль — ровно то, чего программа не делает (docs/10).
  const dropsExercise = feedback === 'pain' || feedback === 'skipped';
  const next =
    !dropsExercise && state.set < step.sets
      ? { step: state.step, set: state.set + 1 }
      : { step: state.step + 1, set: 1 };

  if (feedback === 'pain') {
    await ctx.reply(texts.workout.pain);
  }

  if (next.step >= steps.length) {
    await complete(ctx, deps, user, state.sessionId, day);
    return;
  }

  await showCard(ctx, deps, user, { ...state, ...next }, steps);
}

async function showCard(
  ctx: Context,
  deps: BotDeps,
  user: User,
  state: State,
  steps: WorkoutStep[],
): Promise<void> {
  const step = steps[state.step];
  if (step === undefined) {
    return;
  }
  const text = renderCard(step, steps.length, state.set);

  try {
    await ctx.api.editMessageText(user.telegramId, state.messageId, text, {
      reply_markup: cardKeyboard(),
    });
    await setUiState<State>(deps.db, user.telegramId, SCREEN, state);
    return;
  } catch {
    // Сообщение могло быть удалено руками — тогда просто продолжаем новым.
    const message = await ctx.reply(text, { reply_markup: cardKeyboard() });
    await setUiState<State>(deps.db, user.telegramId, SCREEN, {
      ...state,
      messageId: message.message_id,
    });
  }
}

/** Финал: закрыть сессию, пересчитать лестницы, показать итог (docs/04). */
async function complete(
  ctx: Context,
  deps: BotDeps,
  user: User,
  sessionId: number,
  day: Day,
): Promise<void> {
  const minutes = await finishSession(deps.db, sessionId);
  await clearUiState(deps.db, user.telegramId);

  const records = await loadSets(deps.db, sessionId);
  const outcomes = chainOutcomes(day.workout.items, records);
  const progression = await loadProgression(deps.db, user.telegramId);

  const levelUps: string[] = [];
  const updated = [];
  for (const outcome of outcomes) {
    const state = progression.get(outcome.chain);
    if (state === undefined) {
      continue;
    }
    const next = advance(state, outcome, day.chainSteps, user);
    updated.push(next);
    const note = describeChange(state, next, day.exercises);
    if (note !== null) {
      levelUps.push(note);
    }
    if (next.chainLevel !== state.chainLevel) {
      // История прогрессии живёт в журнале: `progression` держит только текущее состояние,
      // а недельному отчёту нужно «что изменилось» (ADR-007).
      await logEvent(deps.db, user.telegramId, 'level_change', {
        chain: state.chain,
        from: day.exercises.get(state.exerciseCode)?.name ?? state.exerciseCode,
        to: day.exercises.get(next.exerciseCode)?.name ?? next.exerciseCode,
      });
    }
  }
  await saveProgression(deps.db, user.telegramId, updated);

  const streak = await currentStreak(deps.db, user, day.moment.date);
  const tomorrow = await describeTomorrow(deps, user, day);

  await ctx.reply(renderFinish({ minutes, streak, tomorrow, levelUps }));
}

function describeChange(
  before: { chainLevel: number; currentReps: number; exerciseCode: string },
  after: { chainLevel: number; currentReps: number; exerciseCode: string },
  exercises: Map<string, Exercise>,
): string | null {
  if (after.chainLevel > before.chainLevel) {
    const name = exercises.get(after.exerciseCode)?.name ?? after.exerciseCode;
    return `Шаг вверх: ${name}.`;
  }
  if (after.chainLevel < before.chainLevel) {
    const name = exercises.get(after.exerciseCode)?.name ?? after.exerciseCode;
    return `Шаг вниз: ${name}. Это регулировка, а не поражение.`;
  }
  if (after.currentReps > before.currentReps) {
    const name = exercises.get(after.exerciseCode)?.name ?? after.exerciseCode;
    return `${name}: цель ${after.currentReps}.`;
  }
  return null;
}

async function describeTomorrow(deps: BotDeps, user: User, day: Day): Promise<string | null> {
  const weekday = nextWeekday(day.moment.weekday);
  const tomorrow = await loadDay(deps.db, user, {
    date: addDays(day.moment.date, 1),
    time: day.moment.time,
    weekday,
  });
  if (tomorrow === null) {
    return null;
  }
  return `${weekdayName(weekday)}, ${tomorrow.workout.title}, ~${tomorrow.workout.estimatedMinutes} мин`;
}

/**
 * «Через час»: отметку об отправке снимаем, чтобы cron прислал напоминание второй раз,
 * и запоминаем момент, до которого молчать.
 */
async function snooze(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    return;
  }
  const moment = localMoment(new Date(), user.timezone);
  const until = new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString();

  await updateUser(deps.db, user.telegramId, { snooze_until: until });
  await unmarkSent(deps.db, user.telegramId, moment.date, 'morning');
  await ctx.reply(texts.workout.snoozed);
}

/** Пропуск дня целиком. Серия переживает один пропуск в неделю. */
async function skipToday(ctx: Context, deps: BotDeps): Promise<void> {
  const context = await currentContext(ctx, deps);
  if (context === null) {
    return;
  }
  const { user, day } = context;
  const session = await ensurePlannedSession(deps.db, user.telegramId, {
    localDate: day.moment.date,
    templateCode: day.workout.templateCode,
    weekInBlock: day.weekInBlock,
  });

  await skipSession(deps.db, session.id);
  await clearUiState(deps.db, user.telegramId);
  await ctx.reply(texts.workout.skipped);
}

/** `/swap` — альтернативы текущему упражнению из той же swap_group (docs/06). */
async function offerSwap(ctx: Context, deps: BotDeps): Promise<void> {
  const context = await currentContext(ctx, deps);
  if (context === null) {
    return;
  }
  const { user, day } = context;
  const stored = await getUiState<State>(deps.db, user.telegramId);
  const current = currentItem(day, stored?.screen === SCREEN ? stored.payload : null);

  if (current === null) {
    await ctx.reply(texts.workout.nothingToSwap);
    return;
  }

  const alternatives = [...day.exercises.values()].filter(
    (candidate) =>
      candidate.swapGroup === current.exercise.swapGroup &&
      candidate.code !== current.exercise.code &&
      isAvailable(candidate, user),
  );

  if (alternatives.length === 0) {
    await ctx.reply(texts.workout.noAlternatives(current.exercise.name));
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const alternative of alternatives) {
    keyboard.text(alternative.name, `w:swapto:${alternative.code}`).row();
  }
  await ctx.reply(texts.workout.chooseSwap(current.exercise.name), { reply_markup: keyboard });
}

async function applySwap(ctx: Context, deps: BotDeps, toCode: string): Promise<void> {
  const context = await currentContext(ctx, deps);
  if (context === null) {
    return;
  }
  const { user, day } = context;
  const stored = await getUiState<State>(deps.db, user.telegramId);
  const current = currentItem(day, stored?.screen === SCREEN ? stored.payload : null);
  const replacement = day.exercises.get(toCode);
  if (current === null || replacement === undefined) {
    return;
  }

  await saveSwap(
    deps.db,
    user.telegramId,
    current.exercise.code,
    toCode,
    addDays(day.moment.date, SWAP_DAYS),
  );
  await ctx.reply(texts.workout.swapped(current.exercise.name, replacement.name));

  if (stored?.screen === SCREEN) {
    const refreshed = await loadDay(deps.db, user, day.moment);
    if (refreshed !== null) {
      const steps = toSteps(refreshed.workout);
      await showCard(ctx, deps, user, stored.payload, steps);
    }
  }
}

/** Упражнение, о котором идёт речь: текущий шаг тренировки либо основное движение дня. */
function currentItem(day: Day, state: State | null): PlannedItem | null {
  const steps = toSteps(day.workout);
  if (state !== null) {
    const step = steps[state.step];
    if (step !== undefined && step.kind === 'exercise') {
      return step.items[0] ?? null;
    }
  }
  return day.workout.items.find((item) => item.block === 'main') ?? null;
}

function isAvailable(exercise: Exercise, user: User): boolean {
  switch (exercise.equipment) {
    case 'none':
    case 'wall':
      return true;
    case 'kettlebell':
      return user.kettlebells.length > 0;
    case 'band':
      return user.hasBand;
    case 'bar':
      return user.hasPullupBar;
    case 'backpack':
      return user.hasBackpack;
  }
}

/**
 * С какого шага продолжать: первый, по которому ещё не записано нужное число подходов.
 * Так `/go` после падения или закрытого чата не начинает утро заново.
 */
function resumePosition(
  steps: WorkoutStep[],
  records: { position: number; setIndex: number; feedback: Feedback }[],
): { step: number; set: number } | null {
  for (const step of steps) {
    const position = step.items[0]?.position;
    if (position === undefined) {
      continue;
    }
    const own = records.filter((record) => record.position === position);
    if (own.some((record) => record.feedback === 'pain' || record.feedback === 'skipped')) {
      continue;
    }
    if (own.length < step.sets) {
      return { step: step.index, set: own.length + 1 };
    }
  }
  return null;
}

async function currentContext(
  ctx: Context,
  deps: BotDeps,
  budgetMinutes?: number,
): Promise<{ user: User; day: Day } | null> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
    return null;
  }
  const day = await loadDay(
    deps.db,
    user,
    localMoment(new Date(), user.timezone),
    budgetMinutes === undefined ? {} : { budgetMinutes },
  );
  if (day === null) {
    await ctx.reply(texts.noTemplate);
    return null;
  }
  return { user, day };
}

function cardKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.setDone, 'w:done')
    .text(buttons.setHard, 'w:hard')
    .text(buttons.setEasy, 'w:easy')
    .row()
    .text(buttons.setPain, 'w:pain')
    .text(buttons.setSkip, 'w:skip');
}
