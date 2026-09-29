import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { loadChainSteps, loadExercises } from '../../data/repositories/exercises';
import { loadProgression } from '../../data/repositories/progression';
import {
  finishSession,
  loadSets,
  recordSets,
  startThemeSession,
} from '../../data/repositories/sessions';
import { loadThemes } from '../../data/repositories/templates';
import { getUser, updateUser } from '../../data/repositories/users';
import { clearUiState, getUiState, setUiState } from '../../data/repositories/ui-state';
import type { Adaptation } from '../../domain/adaptation';
import { weekInBlock } from '../../domain/program';
import { recordsForStep, type WorkoutStep } from '../../domain/session';
import { themeDose, themeMenu } from '../../domain/theme';
import { localMoment } from '../../domain/time';
import type { Feedback, PlannedItem, Theme, User } from '../../domain/types';
import { collapseCard, editCard, scaleKeyboard, sendExerciseCard, type CardRef } from '../card';
import { showToday } from '../commands/today';
import { neckToday } from '../day';
import { buttons, texts } from '../ui/texts';
import { escapeHtml, renderCard, renderDone } from '../ui/workout';
import { userIdOf, type BotDeps } from '../deps';

/**
 * `/train` и тренировка по теме (ADR-016, docs/04-bot-ux.md).
 *
 * Меню выбирает формат: программа дня (как было) или тема. Тема — группа упражнений
 * справочника; внутри неё любое упражнение, в любом порядке, сколько угодно. Карточка
 * та же, что у программы дня, и каждый подход так же пишется в базу сразу. Но тема живёт
 * своей сессией (`kind = 'theme'`) и не двигает ни лестницы, ни серию.
 */

const SCREEN = 'theme';

interface Current extends CardRef {
  code: string;
  position: number;
  /** Номер подхода, 1-based. */
  set: number;
}

interface State {
  theme: string;
  /** Сессия заводится при первом выбранном упражнении — пустых сессий в логах нет. */
  sessionId: number | null;
  /** Упражнения, доведённые до конца в этой тренировке. */
  done: string[];
  /** Сколько упражнений уже начиналось — отсюда позиция следующего. */
  started: number;
  current: Current | null;
}

export function registerThemes(bot: Bot, deps: BotDeps): void {
  bot.command('train', async (ctx) => {
    await showMenu(ctx, deps);
  });

  bot.callbackQuery(/^t:/, async (ctx) => {
    const [, action = '', ...rest] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();
    await handle(ctx, deps, action, rest);
  });
}

async function handle(ctx: Context, deps: BotDeps, action: string, args: string[]): Promise<void> {
  switch (action) {
    case 'menu':
      await showMenu(ctx, deps);
      return;
    case 'day':
      await showToday(ctx, deps);
      return;
    case 'mode':
      await toggleMode(ctx, deps);
      return;
    case 'list':
      await showThemes(ctx, deps);
      return;
    case 'open':
      await openTheme(ctx, deps, args[0] ?? '');
      return;
    case 'ex':
      await startExercise(ctx, deps, args[0] ?? '', args[1] ?? '');
      return;
    case 'back':
      await backToList(ctx, deps);
      return;
    case 'finish':
      await finish(ctx, deps);
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

async function requireUser(ctx: Context, deps: BotDeps): Promise<User | null> {
  const user = await getUser(deps.db, userIdOf(ctx));
  if (user === null) {
    await ctx.reply(texts.needOnboarding);
  }
  return user;
}

/** Меню формата тренировки: программа дня, тема и переключатель режима напоминаний. */
async function showMenu(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  await ctx.reply(texts.train.menu(user.trainingMode), { reply_markup: menuKeyboard(user) });
}

function menuKeyboard(user: User): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.trainDay, 't:day')
    .text(buttons.trainTheme, 't:list')
    .row()
    .text(buttons.mode(user.trainingMode), 't:mode');
}

async function toggleMode(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  const mode = user.trainingMode === 'daily' ? 'on_demand' : 'daily';
  await updateUser(deps.db, user.telegramId, { training_mode: mode });
  await ctx.reply(texts.train.modeChanged(mode), {
    reply_markup: menuKeyboard({ ...user, trainingMode: mode }),
  });
}

async function showThemes(ctx: Context, deps: BotDeps): Promise<void> {
  const themes = await loadThemes(deps.db);
  const keyboard = new InlineKeyboard();
  themes.forEach((theme, index) => {
    keyboard.text(theme.title, `t:open:${theme.code}`);
    if (index % 2 === 1) {
      keyboard.row();
    }
  });
  await ctx.reply(texts.themes.menu, { reply_markup: keyboard });
}

/**
 * Открыть тему. Если идёт тренировка по другой теме, она закрывается: две темы разом
 * не ведутся, а сделанное в первой уже лежит в базе.
 */
async function openTheme(ctx: Context, deps: BotDeps, code: string): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  const resumed = await themeState(ctx, deps, user, code);
  if (resumed.current !== null) {
    await dropButtons(ctx, user, resumed.current);
  }
  const state = { ...resumed, current: null };
  await setUiState<State>(deps.db, user.telegramId, SCREEN, state);
  await sendList(ctx, deps, user, state);
}

/**
 * Состояние для темы: продолжаем начатую, иначе закрываем чужую и начинаем с нуля.
 * У карточки чужой темы снимаются кнопки: её шкала иначе оценивала бы упражнение новой.
 */
async function themeState(ctx: Context, deps: BotDeps, user: User, code: string): Promise<State> {
  const stored = await getUiState<State>(deps.db, user.telegramId);
  if (stored?.screen === SCREEN) {
    if (stored.payload.theme === code) {
      return stored.payload;
    }
    if (stored.payload.current !== null) {
      await dropButtons(ctx, user, stored.payload.current);
    }
    if (stored.payload.sessionId !== null) {
      await finishSession(deps.db, stored.payload.sessionId);
    }
  }
  return { theme: code, sessionId: null, done: [], started: 0, current: null };
}

async function findTheme(deps: BotDeps, code: string): Promise<Theme | null> {
  return (await loadThemes(deps.db)).find((theme) => theme.code === code) ?? null;
}

/** Список упражнений темы: кнопка на каждое, сделанные помечены. */
async function sendList(ctx: Context, deps: BotDeps, user: User, state: State): Promise<void> {
  const theme = await findTheme(deps, state.theme);
  if (theme === null) {
    await showThemes(ctx, deps);
    return;
  }
  const moment = localMoment(new Date(), user.timezone);
  const [exercises, neck] = await Promise.all([
    loadExercises(deps.db),
    neckToday(deps.db, user, moment.date),
  ]);
  const menu = themeMenu(theme.groupCode, exercises.values(), user, neck.adaptation);
  if (menu.exercises.length === 0) {
    await ctx.reply(texts.themes.empty, {
      reply_markup: new InlineKeyboard().text(buttons.themeBack, 't:list'),
    });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const exercise of menu.exercises) {
    const mark = state.done.includes(exercise.code) ? '✅ ' : '';
    keyboard.text(`${mark}${exercise.name}`, `t:ex:${theme.code}:${exercise.code}`).row();
  }
  keyboard.text(buttons.themeBack, 't:list');
  if (state.sessionId !== null) {
    keyboard.text(buttons.themeFinish, 't:finish');
  }

  await ctx.reply(
    texts.themes.list(escapeHtml(theme.title), {
      hiddenForNeck: menu.hiddenForNeck,
      anyDone: state.done.length > 0,
    }),
    { parse_mode: 'HTML', reply_markup: keyboard },
  );
}

/**
 * Выбранное упражнение: карточка с дозой из лестницы или шаблона (domain/theme.ts).
 * Тема и код едут в самой кнопке — старый список в чате продолжает работать, даже
 * если состояние уже сменилось.
 */
async function startExercise(
  ctx: Context,
  deps: BotDeps,
  themeCode: string,
  exerciseCode: string,
): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  const theme = await findTheme(deps, themeCode);
  if (theme === null) {
    await showThemes(ctx, deps);
    return;
  }

  const state = await themeState(ctx, deps, user, themeCode);
  const moment = localMoment(new Date(), user.timezone);
  const [exercises, neck] = await Promise.all([
    loadExercises(deps.db),
    neckToday(deps.db, user, moment.date),
  ]);
  // Тот же фильтр, что и у списка: старая кнопка не должна провести мимо инварианта шеи.
  const menu = themeMenu(theme.groupCode, exercises.values(), user, neck.adaptation);
  if (!menu.exercises.some((exercise) => exercise.code === exerciseCode)) {
    await setUiState<State>(deps.db, user.telegramId, SCREEN, state);
    await sendList(ctx, deps, user, state);
    return;
  }

  const sessionId =
    state.sessionId ??
    (await startThemeSession(deps.db, user.telegramId, {
      localDate: moment.date,
      templateCode: theme.code,
      weekInBlock: weekInBlock(user.blockStart, moment.date),
    }));
  // Прежняя карточка, если упражнение бросили на полпути: снимаем с неё кнопки,
  // иначе её шкала оценивала бы уже новое упражнение.
  if (state.current !== null) {
    await dropButtons(ctx, user, state.current);
  }
  const position = state.started + 1;
  const item = await plan(deps, user, exerciseCode, position, neck.adaptation);
  if (item === null) {
    return;
  }

  const card = await sendExerciseCard(
    ctx,
    deps,
    exerciseCode,
    cardText(theme, item, 1),
    cardKeyboard(),
  );
  await setUiState<State>(deps.db, user.telegramId, SCREEN, {
    ...state,
    sessionId,
    started: position,
    current: { code: exerciseCode, position, set: 1, ...card },
  });
}

async function plan(
  deps: BotDeps,
  user: User,
  code: string,
  position: number,
  adaptation: Adaptation,
): Promise<PlannedItem | null> {
  const [exercises, chainSteps, progression] = await Promise.all([
    loadExercises(deps.db),
    loadChainSteps(deps.db),
    loadProgression(deps.db, user.telegramId),
  ]);
  const exercise = exercises.get(code);
  if (exercise === undefined) {
    return null;
  }
  return themeDose({ exercise, position, user, chainSteps, progression, adaptation });
}

function stepOf(item: PlannedItem): WorkoutStep {
  return { index: 0, item, sets: item.sets };
}

function cardText(theme: Theme, item: PlannedItem, set: number): string {
  return renderCard([stepOf(item)], 0, set, texts.themes.cardHeader(theme.title, item.position));
}

function cardKeyboard(): InlineKeyboard {
  return scaleKeyboard('t').row().text(buttons.themeToList, 't:back');
}

/** Оценка подхода: записать сразу, дальше — следующий подход или назад к списку. */
async function rate(ctx: Context, deps: BotDeps, feedback: Feedback): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  const stored = await getUiState<State>(deps.db, user.telegramId);
  const state = stored?.screen === SCREEN ? stored.payload : null;
  const current = state?.current ?? null;
  if (state === null || current === null || state.sessionId === null) {
    await ctx.reply(texts.themes.noSession);
    return;
  }
  const theme = await findTheme(deps, state.theme);
  const moment = localMoment(new Date(), user.timezone);
  const neck = await neckToday(deps.db, user, moment.date);
  const item = await plan(deps, user, current.code, current.position, neck.adaptation);
  if (theme === null || item === null) {
    await clearUiState(deps.db, user.telegramId);
    return;
  }
  const step = stepOf(item);

  await recordSets(
    deps.db,
    state.sessionId,
    recordsForStep(step, current.set, feedback),
    item.weight,
  );

  // «Больно» и «пропустить» снимают всё упражнение, а не один подход (docs/10).
  const dropsExercise = feedback === 'pain' || feedback === 'skipped';
  if (!dropsExercise && current.set < step.sets) {
    const next = { ...current, set: current.set + 1 };
    const text = cardText(theme, item, next.set);
    try {
      await editCard(ctx, user.telegramId, current, text, cardKeyboard());
      await setUiState<State>(deps.db, user.telegramId, SCREEN, { ...state, current: next });
    } catch {
      // Сообщение могло быть удалено руками — продолжаем новым.
      const card = await sendExerciseCard(ctx, deps, current.code, text, cardKeyboard());
      await setUiState<State>(deps.db, user.telegramId, SCREEN, {
        ...state,
        current: { ...next, ...card },
      });
    }
    return;
  }

  const mark = feedback === 'pain' ? 'pain' : feedback === 'skipped' ? 'skipped' : 'done';
  await collapseCard(ctx, user.telegramId, current, renderDone(step, mark));
  if (feedback === 'pain') {
    await ctx.reply(texts.workout.pain);
  }

  const done =
    mark === 'done' && !state.done.includes(current.code)
      ? [...state.done, current.code]
      : state.done;
  const next: State = { ...state, done, current: null };
  await setUiState<State>(deps.db, user.telegramId, SCREEN, next);
  await sendList(ctx, deps, user, next);
}

/** «К списку» посреди упражнения: записанные подходы остаются, карточка сворачивается. */
async function backToList(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  const stored = await getUiState<State>(deps.db, user.telegramId);
  if (stored?.screen !== SCREEN) {
    await showThemes(ctx, deps);
    return;
  }
  const state = stored.payload;
  if (state.current !== null) {
    await dropButtons(ctx, user, state.current);
  }
  const next = { ...state, current: null };
  await setUiState<State>(deps.db, user.telegramId, SCREEN, next);
  await sendList(ctx, deps, user, next);
}

async function dropButtons(ctx: Context, user: User, card: CardRef): Promise<void> {
  try {
    await ctx.api.editMessageReplyMarkup(user.telegramId, card.messageId);
  } catch {
    // Кнопки не снялись — не страшно: без текущего упражнения шкала ответит «не идёт».
  }
}

async function finish(ctx: Context, deps: BotDeps): Promise<void> {
  const user = await requireUser(ctx, deps);
  if (user === null) {
    return;
  }
  const stored = await getUiState<State>(deps.db, user.telegramId);
  const state = stored?.screen === SCREEN ? stored.payload : null;
  if (state === null || state.sessionId === null) {
    await ctx.reply(texts.themes.noSession);
    return;
  }

  const minutes = await finishSession(deps.db, state.sessionId);
  await clearUiState(deps.db, user.telegramId);
  const records = await loadSets(deps.db, state.sessionId);
  const exercises = new Set(
    records
      .filter((record) => record.feedback !== 'pain' && record.feedback !== 'skipped')
      .map((record) => record.position),
  ).size;
  const theme = await findTheme(deps, state.theme);

  await ctx.reply(texts.themes.finished(escapeHtml(theme?.title ?? ''), exercises, minutes), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text(buttons.themeMore, 't:list'),
  });
}
