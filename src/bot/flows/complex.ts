import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadChainSteps, loadExercises } from '../../data/repositories/exercises';
import {
  finishSession,
  loadSets,
  recordSets,
  startComplexSession,
} from '../../data/repositories/sessions';
import { loadComplexes, loadTemplate } from '../../data/repositories/templates';
import { getUser } from '../../data/repositories/users';
import { clearUiState, getUiState, setUiState } from '../../data/repositories/ui-state';
import { resolveWorkout, weekInBlock } from '../../domain/program';
import { recordsForStep, toSteps, type WorkoutStep } from '../../domain/session';
import { localMoment } from '../../domain/time';
import type { Complex, Feedback, User } from '../../domain/types';
import { collapseCard, editCard, scaleKeyboard, sendExerciseCard, type CardRef } from '../card';
import { neckToday } from '../day';
import { buttons, texts } from '../ui/texts';
import { escapeHtml, progressLine, renderCard, renderDone } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/**
 * Комплекс под одну проблему (ADR-018, docs/04-bot-ux.md): готовый набор упражнений
 * с дозами, проходится по порядку от начала до конца той же карточкой, что и программа
 * дня. Каждый подход пишется в базу сразу. Сессия — `kind = 'complex'`: лестницы
 * и серию комплекс не трогает.
 */

const SCREEN = 'complex';

interface State extends CardRef {
  code: string;
  sessionId: number;
  /** Индекс шага, 0-based. */
  step: number;
  /** Номер подхода, 1-based. */
  set: number;
}

export function registerComplexes(bot: Bot, deps: BotDeps): void {
  bot.callbackQuery(/^c:/, async (ctx) => {
    const [, action = '', argument = ''] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();
    await handle(ctx, deps, action, argument);
  });
}

/** Кнопки комплексов для меню `/train`: по одной на комплекс. */
export async function complexButtons(deps: BotDeps): Promise<{ text: string; data: string }[]> {
  const complexes = await loadComplexes(deps.db);
  return complexes.map((complex) => ({
    text: `🩹 ${complex.title}`,
    data: `c:start:${complex.code}`,
  }));
}

async function handle(
  ctx: Context,
  deps: BotDeps,
  action: string,
  argument: string,
): Promise<void> {
  switch (action) {
    case 'start':
      await start(ctx, deps, argument);
      return;
    case 'stop':
      await stop(ctx, deps);
      return;
    default: {
      const feedback = FEEDBACK_BY_ACTION[action];
      if (feedback !== undefined) {
        await rate(ctx, deps, feedback);
      }
    }
  }
}

const FEEDBACK_BY_ACTION: Record<string, Feedback | undefined> = {
  done: 'ok',
  hard: 'hard',
  easy: 'easy',
  pain: 'pain',
  skip: 'skipped',
};

interface Plan {
  user: User;
  complex: Complex;
  steps: WorkoutStep[];
  /** Сколько упражнений убрано из-за боли в шее или инвентаря. */
  hidden: number;
}

/**
 * Состав комплекса на сегодня. Инвариант шеи тот же, что у программы дня: при боли ≥2
 * упражнения с `neck_safe = 0` уходят (docs/03). Разгрузочная неделя комплекс не режет.
 */
async function plan(ctx: Context, deps: BotDeps, code: string): Promise<Plan | null> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
    return null;
  }
  const complex = (await loadComplexes(deps.db)).find((candidate) => candidate.code === code);
  const template = complex === undefined ? null : await loadTemplate(deps.db, code);
  if (complex === undefined || template === null) {
    await ctx.reply(texts.complex.noSession);
    return null;
  }
  const moment = localMoment(new Date(), user.timezone);
  const [exercises, chainSteps, neck] = await Promise.all([
    loadExercises(deps.db),
    loadChainSteps(deps.db),
    neckToday(deps.db, user, moment.date),
  ]);
  const workout = resolveWorkout({
    date: moment.date,
    template,
    user,
    exercises,
    chainSteps,
    // Пункты комплекса не привязаны к лестницам: ни прогрессия, ни замены на них не влияют.
    progression: new Map(),
    swaps: new Map(),
    adaptation: neck.adaptation,
    outsideBlock: true,
  });
  return { user, complex, steps: toSteps(workout), hidden: workout.dropped.length };
}

/**
 * Начать комплекс или продолжить начатый. Если он уже идёт — присылаем текущую
 * карточку заново, а не заводим вторую сессию.
 */
async function start(ctx: Context, deps: BotDeps, code: string): Promise<void> {
  const current = await plan(ctx, deps, code);
  if (current === null) {
    return;
  }
  const { user, complex, steps } = current;

  const stored = await getUiState<State>(deps.db, user.telegramId);
  const running = stored?.screen === SCREEN ? stored.payload : null;
  if (running !== null && running.code === code && steps[running.step] !== undefined) {
    await dropButtons(ctx, user, running);
    const card = await sendCard(ctx, deps, complex, steps, running.step, running.set);
    await setUiState<State>(deps.db, user.telegramId, SCREEN, { ...running, ...card });
    return;
  }
  if (running !== null) {
    await dropButtons(ctx, user, running);
    await finishSession(deps.db, running.sessionId);
  }

  if (steps.length === 0) {
    await ctx.reply(texts.complex.empty);
    return;
  }

  const moment = localMoment(new Date(), user.timezone);
  const sessionId = await startComplexSession(deps.db, user.telegramId, {
    localDate: moment.date,
    templateCode: code,
    weekInBlock: weekInBlock(user.blockStart, moment.date),
  });

  const intro = [
    texts.complex.intro(escapeHtml(complex.title), escapeHtml(complex.note), steps.length),
  ];
  if (current.hidden > 0) {
    intro.push('', texts.complex.hiddenForNeck(current.hidden));
  }
  await ctx.reply(intro.join('\n'), { parse_mode: 'HTML' });

  const card = await sendCard(ctx, deps, complex, steps, 0, 1);
  await setUiState<State>(deps.db, user.telegramId, SCREEN, {
    code,
    sessionId,
    step: 0,
    set: 1,
    ...card,
  });
}

/** Оценка подхода: записать сразу, дальше — следующий подход, следующее упражнение или финал. */
async function rate(ctx: Context, deps: BotDeps, feedback: Feedback): Promise<void> {
  const stored = await getUiState<State>(deps.db, userIdOf(ctx));
  const state = stored?.screen === SCREEN ? stored.payload : null;
  if (state === null) {
    await ctx.reply(texts.complex.noSession);
    return;
  }
  const current = await plan(ctx, deps, state.code);
  if (current === null) {
    return;
  }
  const { user, complex, steps } = current;
  const step = steps[state.step];
  if (step === undefined) {
    // Состав поменялся посреди комплекса (например, шея стала на 2): закрываем честно.
    await complete(ctx, deps, user, complex, state.sessionId);
    return;
  }

  await recordSets(
    deps.db,
    state.sessionId,
    recordsForStep(step, state.set, feedback),
    step.item.weight,
  );

  // «Больно» и «пропустить» снимают всё упражнение, а не один подход (docs/10).
  const dropsExercise = feedback === 'pain' || feedback === 'skipped';
  if (!dropsExercise && state.set < step.sets) {
    const next = { ...state, set: state.set + 1 };
    const text = cardText(complex, steps, next.step, next.set);
    try {
      await editCard(ctx, user.telegramId, state, text, cardKeyboard());
      await setUiState<State>(deps.db, user.telegramId, SCREEN, next);
    } catch {
      // Сообщение могло быть удалено руками — продолжаем новым.
      const card = await sendCard(ctx, deps, complex, steps, next.step, next.set);
      await setUiState<State>(deps.db, user.telegramId, SCREEN, { ...next, ...card });
    }
    return;
  }

  const mark = feedback === 'pain' ? 'pain' : feedback === 'skipped' ? 'skipped' : 'done';
  await collapseCard(ctx, user.telegramId, state, renderDone(step, mark));
  if (feedback === 'pain') {
    await ctx.reply(texts.workout.pain);
  }

  const nextStep = state.step + 1;
  if (nextStep >= steps.length) {
    await complete(ctx, deps, user, complex, state.sessionId);
    return;
  }
  const card = await sendCard(ctx, deps, complex, steps, nextStep, 1);
  await setUiState<State>(deps.db, user.telegramId, SCREEN, {
    ...state,
    step: nextStep,
    set: 1,
    ...card,
  });
}

/** «Закончить комплекс» посреди: записанные подходы остаются, сессия закрывается. */
async function stop(ctx: Context, deps: BotDeps): Promise<void> {
  const stored = await getUiState<State>(deps.db, userIdOf(ctx));
  const state = stored?.screen === SCREEN ? stored.payload : null;
  if (state === null) {
    await ctx.reply(texts.complex.noSession);
    return;
  }
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    return;
  }
  await dropButtons(ctx, user, state);
  const complex = (await loadComplexes(deps.db)).find((candidate) => candidate.code === state.code);
  if (complex === undefined) {
    await finishSession(deps.db, state.sessionId);
    await clearUiState(deps.db, user.telegramId);
    await ctx.reply(texts.complex.stopped);
    return;
  }
  await complete(ctx, deps, user, complex, state.sessionId);
}

async function complete(
  ctx: Context,
  deps: BotDeps,
  user: User,
  complex: Complex,
  sessionId: number,
): Promise<void> {
  const minutes = await finishSession(deps.db, sessionId);
  await clearUiState(deps.db, user.telegramId);
  const records = await loadSets(deps.db, sessionId);
  const exercises = new Set(
    records
      .filter((record) => record.feedback !== 'pain' && record.feedback !== 'skipped')
      .map((record) => record.position),
  ).size;
  await ctx.reply(texts.complex.finished(escapeHtml(complex.title), exercises, minutes), {
    parse_mode: 'HTML',
  });
}

function cardText(complex: Complex, steps: WorkoutStep[], step: number, set: number): string {
  const header = `🩹 ${complex.title}\n${progressLine(steps, step, set)}`;
  return renderCard(steps, step, set, header);
}

function sendCard(
  ctx: Context,
  deps: BotDeps,
  complex: Complex,
  steps: WorkoutStep[],
  step: number,
  set: number,
): Promise<CardRef> {
  return sendExerciseCard(
    ctx,
    deps,
    steps[step]?.item.exercise.code,
    cardText(complex, steps, step, set),
    cardKeyboard(),
  );
}

function cardKeyboard(): InlineKeyboard {
  return scaleKeyboard('c').row().text(buttons.complexStop, 'c:stop');
}

async function dropButtons(ctx: Context, user: User, card: CardRef): Promise<void> {
  try {
    await ctx.api.editMessageReplyMarkup(user.telegramId, card.messageId);
  } catch {
    // Кнопки не снялись — не страшно: без идущего комплекса шкала ответит «не идёт».
  }
}
