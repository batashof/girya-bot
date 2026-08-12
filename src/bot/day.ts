import { loadChainSteps, loadExercises } from '../data/repositories/exercises';
import { loadProgression } from '../data/repositories/progression';
import { loadTemplateForWeekday } from '../data/repositories/templates';
import { loadSwaps } from '../data/repositories/swaps';
import { resolveWorkout, weekInBlock } from '../domain/program';
import type { ChainStep, Exercise, User, Workout } from '../domain/types';
import type { LocalMoment } from '../domain/time';

/**
 * Сборка тренировки дня из базы. Одно место на `/today`, `/go` и финал онбординга:
 * иначе три экрана начинают показывать три немного разные тренировки.
 */
export interface Day {
  moment: LocalMoment;
  workout: Workout;
  exercises: Map<string, Exercise>;
  chainSteps: ChainStep[];
  weekInBlock: number;
}

export async function loadDay(
  db: D1Database,
  user: User,
  moment: LocalMoment,
): Promise<Day | null> {
  const template = await loadTemplateForWeekday(db, moment.weekday);
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
    user,
    exercises,
    chainSteps,
    progression,
    swaps,
  });

  return {
    moment,
    workout,
    exercises,
    chainSteps,
    weekInBlock: weekInBlock(user.blockStart, moment.date),
  };
}
