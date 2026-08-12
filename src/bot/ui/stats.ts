import type { LevelChange } from '../../data/repositories/stats';
import {
  neckTrend,
  type PainAfterTraining,
  type Trend,
  type WeekSummary,
} from '../../domain/stats';
import type { Chain, ChainStep, Exercise, ProgressionState } from '../../domain/types';
import { plural } from './plural';

/** Отрисовка статистики и недельного отчёта (docs/04-bot-ux.md). */

const TREND_MARK: Record<Trend, string> = { down: '↓', up: '↑', flat: '→', unknown: '' };

const CHAIN_TITLES: Record<Chain, string> = {
  push: 'Отжимания',
  row: 'Тяга',
  squat: 'Присед',
  hinge: 'Тазовый шарнир',
  core: 'Кор',
};

export function renderStats(options: {
  weeks: WeekSummary[];
  progression: Map<Chain, ProgressionState>;
  chainSteps: ChainStep[];
  exercises: Map<string, Exercise>;
  pain: PainAfterTraining;
  weeksOfHistory: number;
}): string {
  const lines = ['📊 Статистика', ''];

  for (const week of options.weeks) {
    const neck = week.neckAverage === null ? '—' : week.neckAverage.toFixed(1);
    lines.push(
      `нед. ${week.isoWeek} · ${week.done}/7 · ${week.minutes} мин · шея ${neck}` +
        (week.miniCount > 0 ? ` · мини ${week.miniCount}` : ''),
    );
  }

  const [current, previous] = options.weeks;
  const trend = neckTrend(current?.neckAverage ?? null, previous?.neckAverage ?? null);
  if (trend !== 'unknown') {
    lines.push(
      '',
      `Шея: ${current?.neckAverage?.toFixed(1)} против ${previous?.neckAverage?.toFixed(1)} ${TREND_MARK[trend]}`,
    );
    if (trend === 'flat' && options.weeksOfHistory >= 6) {
      // docs/07: плоский тренд при регулярных тренировках — сигнал идти к человеку,
      // а не делать ещё один подход Y-T-W.
      lines.push(
        'Тренда нет уже шесть недель. Это повод к физиотерапевту, а не к ещё одному подходу.',
      );
    }
  }

  lines.push('', 'Ступени:');
  for (const [chain, state] of options.progression) {
    const steps = options.chainSteps.filter((step) => step.chain === chain);
    const step = steps.find((candidate) => candidate.level === state.chainLevel);
    const name = options.exercises.get(state.exerciseCode)?.name ?? state.exerciseCode;
    // Вариант ступени важнее названия: «отжимания» на ступени 2 и 6 — разные упражнения.
    const what =
      step?.variant === undefined || step.variant === null ? name : `${name}, ${step.variant}`;
    lines.push(
      `• ${CHAIN_TITLES[chain]}: ${state.chainLevel} из ${steps.length} — ${what}, цель ${state.currentReps}`,
    );
  }

  if (options.pain.painfulDays > 0) {
    lines.push(
      '',
      `Дней с болью ≥2: ${options.pain.painfulDays}, из них после тренировки накануне: ${options.pain.afterTraining}.`,
    );
  }

  return lines.join('\n');
}

export function renderWeeklyReport(options: {
  week: WeekSummary;
  previous: WeekSummary | undefined;
  changes: LevelChange[];
  nextWeekIsDeload: boolean;
}): string {
  const { week } = options;
  const lines = [
    `Неделя ${week.isoWeek} · ${week.done} из 7 ${plural(week.done, 'тренировка', 'тренировки', 'тренировок')} · ` +
      `${week.minutes} ${plural(week.minutes, 'минута', 'минуты', 'минут')}`,
    '',
  ];

  const trend = neckTrend(week.neckAverage, options.previous?.neckAverage ?? null);
  if (week.neckAverage !== null) {
    const was =
      options.previous?.neckAverage === undefined || options.previous.neckAverage === null
        ? ''
        : ` (было ${options.previous.neckAverage.toFixed(1)})`;
    lines.push(`Шея: среднее ${week.neckAverage.toFixed(1)}${was} ${TREND_MARK[trend]}`.trim());
  }

  if (options.changes.length > 0) {
    lines.push('Прогресс:');
    for (const change of options.changes) {
      lines.push(`  ${change.from} → ${change.to}`);
    }
  }

  lines.push(`Микро-блоков за неделю: ${week.miniCount}`);

  if (options.nextWeekIsDeload) {
    lines.push('', 'Следующая неделя — разгрузочная: все дни по 10 минут.');
  }

  return lines.join('\n');
}

export function renderStreak(current: number, record: number): string {
  if (current === 0) {
    return record === 0
      ? 'Серии пока нет. Она начинается с одной тренировки.'
      : `Серия прервалась. Рекорд — ${record}.`;
  }
  return `Серия: ${current} 🔥\nРекорд: ${record}`;
}
