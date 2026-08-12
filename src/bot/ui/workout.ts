import type { PlannedItem, Workout } from '../../domain/types';
import type { WorkoutStep } from '../../domain/session';
import { estimateSeconds } from '../../domain/program';
import { plural } from './plural';

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

/**
 * Темп подписывается только там, где его не назвал вариант ступени: в лестницах
 * «темп 3-1-3» и «пауза 2 с» и так стоят в названии варианта, дважды не нужно.
 */
function tempoSuffix(item: PlannedItem): string {
  return item.variant === null ? (TEMPO_LABEL[item.tempo] ?? '') : '';
}

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

/** Карточка пошагового режима: одно сообщение, которое редактируется на месте (docs/04). */
export function renderCard(step: WorkoutStep, total: number, setIndex: number): string {
  const header = `${step.index + 1}/${total} · ${stepTitle(step)}`;
  const progress = step.sets > 1 ? `подход ${setIndex} из ${step.sets}` : '';
  const lines = [progress === '' ? header : `${header}   ·   ${progress}`, '─'.repeat(28)];

  if (step.kind === 'neck') {
    lines.push('Круг без пауз, усилие 30–50%, без резких движений:');
    for (const item of step.items) {
      lines.push(`• ${renderItem(item)}`);
    }
    return lines.join('\n');
  }

  const item = step.items[0];
  if (item === undefined) {
    return lines.join('\n');
  }
  lines.push(renderSetLine(item));
  lines.push('');
  lines.push(item.exercise.cues);
  if (item.exercise.mistakes !== null) {
    lines.push(`Не надо: ${item.exercise.mistakes.toLowerCase()}`);
  }
  return lines.join('\n');
}

/**
 * Задание на один подход: заголовок карточки уже назвал упражнение и номер подхода,
 * поэтому здесь только «сколько и с чем».
 */
function renderSetLine(item: PlannedItem): string {
  const weight = item.weight === null ? '' : `${formatWeight(item.weight)} кг × `;
  const side = item.unilateral ? ' на сторону' : '';
  return `${weight}${withUnit(item)}${side}${tempoSuffix(item)}`;
}

function withUnit(item: PlannedItem): string {
  switch (item.unit) {
    case 'reps':
      return `${item.target} ${plural(item.target, 'повтор', 'повтора', 'повторов')}`;
    case 'seconds':
      return item.target >= 60 ? `${Math.round(item.target / 60)} мин` : `${item.target} с`;
    case 'steps':
      return `${item.target} ${plural(item.target, 'шаг', 'шага', 'шагов')}`;
  }
}

export function stepTitle(step: WorkoutStep): string {
  if (step.kind === 'neck') {
    return 'Шейный протокол';
  }
  const item = step.items[0];
  if (item === undefined) {
    return '';
  }
  return item.variant === null ? item.exercise.name : `${item.exercise.name}, ${item.variant}`;
}

export function renderFinish(options: {
  minutes: number;
  streak: number;
  tomorrow: string | null;
  levelUps: string[];
}): string {
  const lines = [`✅ Готово за ${Math.max(1, options.minutes)} мин.`];
  if (options.streak > 0) {
    lines.push(`Серия: ${options.streak} ${plural(options.streak, 'день', 'дня', 'дней')} 🔥`);
  }
  for (const message of options.levelUps) {
    lines.push(message);
  }
  if (options.tomorrow !== null) {
    lines.push(`Завтра: ${options.tomorrow}.`);
  }
  return lines.join('\n');
}

export function renderItem(item: PlannedItem): string {
  const name =
    item.variant === null ? item.exercise.name : `${item.exercise.name}, ${item.variant}`;
  const weight = item.weight === null ? '' : ` ${formatWeight(item.weight)} кг`;
  const side = item.unilateral ? ' / сторону' : '';
  return `${name}${weight}${tempoSuffix(item)} — ${item.sets}×${formatTarget(item)}${side}`;
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
