/**
 * Как оценка шеи меняет день (docs/04-bot-ux.md, docs/10-safety.md).
 *
 * Боль здесь — вход в систему, а не ошибка: она не игнорируется и не «перетерпливается»,
 * а меняет состав дня.
 */

/** 0 — нет боли … 3 — сильно. */
export type NeckScore = 0 | 1 | 2 | 3;

export interface Adaptation {
  /** Оценка 3: день целиком заменяется восстановительным протоколом (W-G). */
  recoveryOnly: boolean;
  /** Оценка ≥2: из дня уходят упражнения с `neck_safe = 0`. */
  dropNeckUnsafe: boolean;
  /** Множитель объёма: на оценке 2 режем примерно на 30%. */
  volumeFactor: number;
  /** Показать красные флаги: оценка 3 либо три дня подряд с оценкой ≥2 (docs/10). */
  showRedFlags: boolean;
}

export const NO_ADAPTATION: Adaptation = {
  recoveryOnly: false,
  dropNeckUnsafe: false,
  volumeFactor: 1,
  showRedFlags: false,
};

/** Сколько дней подряд с оценкой ≥2 считается сигналом идти к врачу (docs/10). */
const RED_FLAG_DAYS = 3;

const PAINFUL = 2;

export function adaptationFor(score: NeckScore, previousScores: NeckScore[] = []): Adaptation {
  const recentPainful =
    score >= PAINFUL &&
    previousScores.slice(0, RED_FLAG_DAYS - 1).length === RED_FLAG_DAYS - 1 &&
    previousScores.slice(0, RED_FLAG_DAYS - 1).every((value) => value >= PAINFUL);

  if (score === 3) {
    return { recoveryOnly: true, dropNeckUnsafe: true, volumeFactor: 1, showRedFlags: true };
  }
  if (score === 2) {
    return {
      recoveryOnly: false,
      dropNeckUnsafe: true,
      volumeFactor: 0.7,
      showRedFlags: recentPainful,
    };
  }
  return NO_ADAPTATION;
}

/**
 * Оценка, по которой строится день, если сегодня ещё не спрашивали.
 *
 * Вчерашние 2–3 переносятся на сегодня: «оценка 2–3 → завтра автоматически разгрузочный
 * день» (docs/01-plan.md, M4). Как только пользователь ответит на утренний вопрос,
 * его сегодняшний ответ вытесняет вчерашний.
 */
export function effectiveScore(today: NeckScore | null, yesterday: NeckScore | null): NeckScore {
  if (today !== null) {
    return today;
  }
  return yesterday !== null && yesterday >= PAINFUL ? yesterday : 0;
}

export function isNeckScore(value: number): value is NeckScore {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
