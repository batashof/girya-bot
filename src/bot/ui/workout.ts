import type { PlannedItem, Workout } from '../../domain/types';
import { estimateSeconds } from '../../domain/program';

/** Отрисовка тренировки текстом (docs/04-bot-ux.md). */

const WEEKDAY_NAMES = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

const TEMPO_LABEL: Record<string, string> = {
  normal: '',
  slow: ', темп 3-1-3',
  pause: ', с паузой',
};

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? '';
}

export function renderWorkout(workout: Workout, weekday: number): string {
  const lines = [
    `🏋️ ${weekdayName(weekday)} — ${workout.title}`,
    `~${workout.estimatedMinutes} мин · неделя ${workout.weekInBlock} из 4${workout.deload ? ' (разгрузочная)' : ''}`,
    '',
  ];

  let position = 1;
  for (const group of groupItems(workout.items)) {
    lines.push(`${position}. ${renderGroup(group)}`);
    position += 1;
  }

  if (workout.optional) {
    lines.push('', 'День по желанию — пропуск не рвёт серию.');
  }
  if (workout.deload) {
    lines.push('', 'Разгрузочная неделя: меньше объёма, уровни не меняются.');
  }

  return lines.join('\n');
}

interface Group {
  kind: 'neck' | 'single';
  items: PlannedItem[];
}

/**
 * Шейный протокол показывается одной строкой: это семь упражнений, но один пункт дня,
 * и разворачивать его в списке — значит утопить в нём остальные три упражнения.
 */
function groupItems(items: PlannedItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (item.block === 'neck') {
      if (last?.kind === 'neck') {
        last.items.push(item);
      } else {
        groups.push({ kind: 'neck', items: [item] });
      }
      continue;
    }
    groups.push({ kind: 'single', items: [item] });
  }
  return groups;
}

function renderGroup(group: Group): string {
  if (group.kind === 'neck') {
    const seconds = group.items.reduce((sum, item) => sum + estimateSeconds(item), 0);
    return `Шейный протокол — ${Math.max(1, Math.round(seconds / 60))} мин`;
  }
  const item = group.items[0];
  return item === undefined ? '' : renderItem(item);
}

export function renderItem(item: PlannedItem): string {
  const name =
    item.variant === null ? item.exercise.name : `${item.exercise.name}, ${item.variant}`;
  const weight = item.weight === null ? '' : ` ${formatWeight(item.weight)} кг`;
  const tempo = TEMPO_LABEL[item.tempo] ?? '';
  const side = item.unilateral ? ' / сторону' : '';
  return `${name}${weight}${tempo} — ${item.sets}×${formatTarget(item)}${side}`;
}

function formatTarget(item: PlannedItem): string {
  switch (item.unit) {
    case 'reps':
      return String(item.target);
    case 'seconds':
      return item.target >= 60 ? `${Math.round(item.target / 60)} мин` : `${item.target} с`;
    case 'steps':
      return `${item.target} шагов`;
  }
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}
