import { addDays, daysBetween, isoWeek, startOfWeek, type LocalDate } from './time';
import type { NeckScore } from './adaptation';

/**
 * Агрегация логов для `/stats` и недельного отчёта.
 *
 * Главный вопрос, ради которого всё это считается, один: стало ли лучше с шеей
 * (docs/07-neck-and-back.md). Остальное — обратная связь, чтобы режим не бросался.
 */

export interface SessionSummary {
  date: LocalDate;
  kind: 'main' | 'mini';
  status: 'planned' | 'in_progress' | 'done' | 'skipped';
  minutes: number | null;
  neckScore: NeckScore | null;
}

export interface WeekSummary {
  from: LocalDate;
  to: LocalDate;
  isoWeek: number;
  /** Выполненных основных тренировок за неделю. */
  done: number;
  minutes: number;
  /** Средняя оценка шеи за неделю; null, если ни разу не спрашивали. */
  neckAverage: number | null;
  miniCount: number;
}

/** Сколько дней в неделе считается «полным» планом: тренировка каждый день. */
export const DAYS_IN_WEEK = 7;

/** Недели от свежей к старой, начиная с той, в которую попадает `today`. */
export function summarizeWeeks(
  sessions: SessionSummary[],
  today: LocalDate,
  weeks: number,
): WeekSummary[] {
  const result: WeekSummary[] = [];
  let from = startOfWeek(today);

  for (let index = 0; index < weeks; index += 1) {
    result.push(summarizeRange(sessions, from, addDays(from, DAYS_IN_WEEK - 1)));
    from = addDays(from, -DAYS_IN_WEEK);
  }
  return result;
}

export function summarizeRange(
  sessions: SessionSummary[],
  from: LocalDate,
  to: LocalDate,
): WeekSummary {
  const inRange = sessions.filter((session) => session.date >= from && session.date <= to);
  const main = inRange.filter((session) => session.kind === 'main');
  const done = main.filter((session) => session.status === 'done');
  const scores = main
    .map((session) => session.neckScore)
    .filter((score): score is NeckScore => score !== null);

  return {
    from,
    to,
    isoWeek: isoWeek(from),
    done: done.length,
    minutes: done.reduce((sum, session) => sum + (session.minutes ?? 0), 0),
    neckAverage: scores.length === 0 ? null : average(scores),
    // Микро-сессии считаются отдельным счётчиком и в объём тренировок не входят (ADR-013).
    miniCount: inRange.filter((session) => session.kind === 'mini').length,
  };
}

export type Trend = 'down' | 'flat' | 'up' | 'unknown';

/**
 * Куда идёт шея. Тренд вниз — программа работает; плоский при регулярных тренировках
 * шесть недель и больше — сигнал идти к человеку, а не делать ещё подход (docs/07).
 */
export function neckTrend(current: number | null, previous: number | null): Trend {
  if (current === null || previous === null) {
    return 'unknown';
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.25) {
    return 'flat';
  }
  return delta < 0 ? 'down' : 'up';
}

export interface PainAfterTraining {
  /** Дней с оценкой ≥2. */
  painfulDays: number;
  /** Из них тех, где накануне была тренировка. */
  afterTraining: number;
}

/**
 * Связка «болит после тренировки» из docs/07: иногда обнаруживается, что шея реагирует
 * на конкретный день, и тогда его надо разбирать, а не терпеть.
 */
export function painAfterTraining(sessions: SessionSummary[]): PainAfterTraining {
  const trainedOn = new Set(
    sessions
      .filter((session) => session.kind === 'main' && session.status === 'done')
      .map((session) => session.date),
  );

  const painful = sessions.filter(
    (session) => session.kind === 'main' && session.neckScore !== null && session.neckScore >= 2,
  );

  return {
    painfulDays: painful.length,
    afterTraining: painful.filter((session) => trainedOn.has(addDays(session.date, -1))).length,
  };
}

/** Сколько недель подряд идут тренировки — чтобы понять, есть ли о чём судить. */
export function weeksOfHistory(sessions: SessionSummary[], today: LocalDate): number {
  const dates = sessions
    .filter((session) => session.kind === 'main' && session.status === 'done')
    .map((session) => session.date)
    .sort();
  const first = dates[0];
  if (first === undefined) {
    return 0;
  }
  return Math.floor(daysBetween(first, today) / DAYS_IN_WEEK) + 1;
}

function average(values: number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
