import type { PlannedItem, Workout } from '../../domain/types';
import {
  remainingSeconds,
  secondsPerSet,
  setsBefore,
  totalSets,
  type WorkoutStep,
} from '../../domain/session';
import { estimateSeconds } from '../../domain/program';
import { plural } from './plural';

/** Отрисовка тренировки текстом (docs/04-bot-ux.md). Разметка — HTML. */

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
  slow: 'темп 3-1-3',
  pause: 'с паузой',
};

/** Длина прогресс-бара в символах. Восемь читаются на телефоне одной строкой. */
const BAR_WIDTH = 8;

/**
 * Темп подписывается только там, где его не назвал вариант ступени: в лестницах
 * «темп 3-1-3» и «пауза 2 с» и так стоят в названии варианта, дважды не нужно.
 */
function tempoLabel(item: PlannedItem): string {
  return item.variant === null ? (TEMPO_LABEL[item.tempo] ?? '') : '';
}

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? '';
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderWorkout(workout: Workout, weekday: number): string {
  const lines = [
    `🏋️ <b>${escapeHtml(weekdayName(weekday))} — ${escapeHtml(workout.title)}</b>`,
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
 * В плане дня шейный протокол показывается одной строкой: это семь упражнений, но один
 * пункт дня, и разворачивать его в списке — значит утопить в нём остальные три.
 * В пошаговом режиме, наоборот, каждое идёт своей карточкой.
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
    return `Шейный протокол, ${group.items.length} упр. — ${Math.max(1, Math.round(seconds / 60))} мин`;
  }
  const item = group.items[0];
  return item === undefined ? '' : escapeHtml(renderItem(item));
}

/**
 * Карточка одного упражнения: своё сообщение на каждое, подходы внутри перерисовываются
 * на месте. Порядок блоков всегда один и тот же, чтобы глаз не искал: где я → что за
 * упражнение → сколько делать → сколько это займёт → как делать (docs/04).
 */
export function renderCard(steps: WorkoutStep[], stepIndex: number, setIndex: number): string {
  const step = steps[stepIndex];
  if (step === undefined) {
    return '';
  }
  const { item } = step;

  const done = setsBefore(steps, stepIndex, setIndex);
  const lines = [
    `${progressBar(done, totalSets(steps))} упражнение ${stepIndex + 1} из ${steps.length}`,
    `Осталось ~${minutesLeft(remainingSeconds(steps, stepIndex, setIndex))} мин`,
    '',
    `<b>${escapeHtml(stepTitle(step))}</b>`,
  ];

  if (step.sets > 1) {
    lines.push(`Подход ${setIndex} из ${step.sets}`);
  }
  lines.push('', ...taskLines(step));

  const cues = cueLines(item.exercise.cues);
  if (cues.length > 0) {
    lines.push('', 'Как делать:');
    lines.push(...cues.map((cue, index) => `${index + 1}. ${escapeHtml(cue)}`));
  }
  if (item.exercise.mistakes !== null) {
    lines.push('', `⚠️ Не надо: ${escapeHtml(lowerFirst(item.exercise.mistakes))}`);
  }

  // Расшифровка шкалы: кнопки подписей не имеют, а от ответа зависит, усложнится ли
  // упражнение в следующий раз (docs/05).
  lines.push('', 'Как прошло? 😮‍💨 тяжело · 👌 нормально · 😴 легко');

  return lines.join('\n');
}

/**
 * «Сколько делать» и «сколько это займёт» — две отдельные строки, потому что раньше
 * повторы, подходы и секунды удержания сливались в одну и различить их было нельзя.
 */
function taskLines(step: WorkoutStep): string[] {
  const { item } = step;
  const lines: string[] = [];
  const side = item.unilateral ? ' на каждую сторону' : '';

  // Количество подходов стоит в той же строке, что и объём: «30 секунд» без «сколько раз»
  // не задание, а число. Секунды удержания при этом остаются секундами, а не повторами.
  lines.push(
    step.sets > 1
      ? `🔁 ${step.sets} ${plural(step.sets, 'подход', 'подхода', 'подходов')} по ${amount(item)}${side}`
      : `🔁 Один подход: ${amount(item)}${side}`,
  );
  // Оценка времени нужна там, где её не видно из задания: у удержания она и есть задание.
  if (item.unit !== 'seconds') {
    lines.push(`⏱ Примерно ${seconds(secondsPerSet(step))} на подход`);
  }

  const load = loadLine(item);
  if (load !== '') {
    lines.push(`🏋️ ${escapeHtml(load)}`);
  }
  // У шага в один подход строки про отдых нет: отдыхать не между чем.
  if (step.sets > 1 && item.restSec > 0) {
    lines.push(`⏸ Отдых между подходами ${seconds(item.restSec)}`);
  }
  return lines;
}

function amount(item: PlannedItem): string {
  switch (item.unit) {
    case 'reps':
      return `${item.target} ${plural(item.target, 'повтор', 'повтора', 'повторов')}`;
    case 'steps':
      return `${item.target} ${plural(item.target, 'шаг', 'шага', 'шагов')}`;
    case 'seconds':
      return `${item.target} ${plural(item.target, 'секунду', 'секунды', 'секунд')} удержания`;
  }
}

function loadLine(item: PlannedItem): string {
  const parts: string[] = [];
  if (item.weight !== null) {
    parts.push(`Гиря ${formatWeight(item.weight)} кг`);
  }
  const tempo = tempoLabel(item);
  if (tempo !== '') {
    parts.push(tempo);
  }
  return parts.join(', ');
}

/** Строка-итог для уже пройденного упражнения: сообщение остаётся в чате, но сжимается. */
export function renderDone(step: WorkoutStep, feedback: 'done' | 'skipped' | 'pain'): string {
  const mark = feedback === 'done' ? '✅' : feedback === 'pain' ? '🤕' : '⏭';
  const tail = feedback === 'done' ? '' : feedback === 'pain' ? ' — снято, больно' : ' — пропущено';
  return `${mark} ${escapeHtml(stepTitle(step))} · ${escapeHtml(volume(step))}${tail}`;
}

function volume(step: WorkoutStep): string {
  const { item } = step;
  const target = item.unit === 'seconds' ? `${item.target} с` : String(item.target);
  return step.sets > 1 ? `${step.sets}×${target}` : target;
}

/**
 * Техника разбивается на шаги: одна слипшаяся строка читается как абзац, а нужен порядок
 * действий — «сначала это, потом это». Разделитель — точка в конце предложения.
 */
function cueLines(cues: string): string[] {
  return cues
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim().replace(/\.$/, ''))
    .filter((line) => line !== '');
}

export function progressBar(done: number, total: number): string {
  if (total <= 0) {
    return '';
  }
  const filled = Math.min(BAR_WIDTH, Math.round((done / total) * BAR_WIDTH));
  return `${'▰'.repeat(filled)}${'▱'.repeat(BAR_WIDTH - filled)}`;
}

function minutesLeft(secondsTotal: number): number {
  return Math.max(1, Math.round(secondsTotal / 60));
}

function seconds(value: number): string {
  return value >= 90 ? `${Math.round(value / 60)} мин` : `${value} с`;
}

export function stepTitle(step: WorkoutStep): string {
  const { item } = step;
  return item.variant === null ? item.exercise.name : `${item.exercise.name}, ${item.variant}`;
}

export function renderFinish(options: {
  minutes: number;
  streak: number;
  tomorrow: string | null;
  levelUps: string[];
}): string {
  const lines = [`✅ <b>Готово за ${Math.max(1, options.minutes)} мин.</b>`];
  if (options.streak > 0) {
    lines.push(`Серия: ${options.streak} ${plural(options.streak, 'день', 'дня', 'дней')} 🔥`);
  }
  for (const message of options.levelUps) {
    lines.push(escapeHtml(message));
  }
  if (options.tomorrow !== null) {
    lines.push(`Завтра: ${escapeHtml(options.tomorrow)}.`);
  }
  return lines.join('\n');
}

export function renderItem(item: PlannedItem): string {
  const name =
    item.variant === null ? item.exercise.name : `${item.exercise.name}, ${item.variant}`;
  const weight = item.weight === null ? '' : ` ${formatWeight(item.weight)} кг`;
  const side = item.unilateral ? ' / сторону' : '';
  const tempo = tempoLabel(item);
  const suffix = tempo === '' ? '' : `, ${tempo}`;
  return `${name}${weight}${suffix} — ${item.sets}×${formatTarget(item)}${side}`;
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

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
