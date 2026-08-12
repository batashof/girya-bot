import { loadChainSteps, loadExercises } from '../data/repositories/exercises';
import { loadProgression } from '../data/repositories/progression';
import { loadTemplate, loadTemplateForWeekday } from '../data/repositories/templates';
import { neckScoreFor, recentNeckScores } from '../data/repositories/sessions';
import { loadSwaps } from '../data/repositories/swaps';
import {
  adaptationFor,
  effectiveScore,
  type Adaptation,
  type NeckScore,
} from '../domain/adaptation';
import { resolveWorkout, weekInBlock } from '../domain/program';
import { addDays, type LocalMoment } from '../domain/time';
import type { ChainStep, Exercise, User, Workout } from '../domain/types';

/**
 * Сборка тренировки дня из базы. Одно место на `/today`, `/go`, напоминания и финал
 * онбординга: иначе четыре экрана начинают показывать четыре немного разные тренировки.
 */
export interface Day {
  moment: LocalMoment;
  workout: Workout;
  exercises: Map<string, Exercise>;
  chainSteps: ChainStep[];
  weekInBlock: number;
  /** Оценка шеи, по которой построен день. */
  neckScore: NeckScore;
  adaptation: Adaptation;
}

/** День восстановления — им заменяется любой день при оценке шеи 3 (docs/04). */
const RECOVERY_TEMPLATE = 'W-G';

export interface DayOptions {
  /** Урезанный бюджет для «сокращённой версии» вечернего пинга. */
  budgetMinutes?: number;
}

export async function loadDay(
  db: D1Database,
  user: User,
  moment: LocalMoment,
  options: DayOptions = {},
): Promise<Day | null> {
  const [todayScore, yesterdayScore, previous] = await Promise.all([
    neckScoreFor(db, user.telegramId, moment.date),
    neckScoreFor(db, user.telegramId, addDays(moment.date, -1)),
    recentNeckScores(db, user.telegramId, moment.date, 2),
  ]);

  const score = effectiveScore(todayScore, yesterdayScore);
  const adaptation = adaptationFor(score, previous);

  const template = adaptation.recoveryOnly
    ? await loadTemplate(db, RECOVERY_TEMPLATE)
    : await loadTemplateForWeekday(db, moment.weekday);
  if (template === null) {
    return null;
  }

  const [exercises, chainSteps, progression, swaps] = await Promise.all([
    loadExercises(db),
    loadChainSteps(db),
    loadProgression(db, user.telegramId),
    loadSwaps(db, user.telegramId, moment.date),
  ]);

  const workout = resolveWorkout({
    date: moment.date,
    template,
    user:
      options.budgetMinutes === undefined
        ? user
        : { ...user, sessionMinutes: options.budgetMinutes },
    exercises,
    chainSteps,
    progression,
    swaps,
    adaptation,
  });

  return {
    moment,
    workout,
    exercises,
    chainSteps,
    weekInBlock: weekInBlock(user.blockStart, moment.date),
    neckScore: score,
    adaptation,
  };
}
