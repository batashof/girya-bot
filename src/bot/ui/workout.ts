import type { PlannedItem, Workout } from '../../domain/types';
import { remainingSeconds, setsBefore, totalSets, type WorkoutStep } from '../../domain/session';
import { BETWEEN_HOLDS_SEC, estimateSeconds, prescription } from '../../domain/program';
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
export function renderCard(
  steps: WorkoutStep[],
  stepIndex: number,
  setIndex: number,
  /**
   * Своя шапка вместо прогресс-бара дня. У тренировки по теме нет «из скольких»:
   * упражнения выбираются по одному, и сколько их будет, заранее неизвестно.
   */
  header?: string,
): string {
  const step = steps[stepIndex];
  if (step === undefined) {
    return '';
  }
  const { item } = step;

  const done = setsBefore(steps, stepIndex, setIndex);
  const lines =
    header === undefined
      ? [
          `${progressBar(done, totalSets(steps))} упражнение ${stepIndex + 1} из ${steps.length}`,
          `Осталось ~${minutesLeft(remainingSeconds(steps, stepIndex, setIndex))} мин`,
        ]
      : [escapeHtml(header)];
  lines.push('', `<b>${escapeHtml(stepTitle(step))}</b>`);

  lines.push(setLine(step, setIndex), '', ...taskLines(step));

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
 * Где ты в упражнении. Подход назван всегда, даже единственный: без этого непонятно,
 * делать ли задание ещё раз. Отдых — перед подходом, а не «между»: карточка следующего
 * подхода приходит сразу после оценки предыдущего, и отдыхать нужно именно сейчас.
 */
function setLine(step: WorkoutStep, setIndex: number): string {
  if (step.sets <= 1) {
    return 'Один подход';
  }
  const rest =
    setIndex > 1 && step.item.restSec > 0 ? ` · сначала отдых ${seconds(step.item.restSec)}` : '';
  return `Подход ${setIndex} из ${step.sets}${rest}`;
}

/**
 * Задание на подход — ровно две величины: сколько повторов и сколько секунд длится
 * один повтор (ADR-017). Раньше рядом стояли ещё «примерно N с на подход» и секунды
 * в технике, и числа не складывались друг с другом.
 */
function taskLines(step: WorkoutStep): string[] {
  const { item } = step;
  const { reps, repSec, repNote, kind } = prescription(item);
  const side = item.unilateral ? ' на каждую сторону' : '';
  const lines: string[] = [];

  if (kind === 'hold' && reps === 1 && repSec >= 90) {
    // Прогулка или долгое удержание: «1 повтор по 30 минут» звучит как задача по физике.
    lines.push(`⏱ ${seconds(repSec)} без остановки${side}`);
  } else if (kind === 'hold') {
    lines.push(`🔁 ${reps} ${plural(reps, 'повтор', 'повтора', 'повторов')}${side}`);
    lines.push(
      reps > 1
        ? `⏱ Каждый повтор — держи ${seconds(repSec)}, между повторами пауза ${BETWEEN_HOLDS_SEC} с`
        : `⏱ Держи ${seconds(repSec)}`,
    );
  } else {
    const noun =
      kind === 'steps'
        ? plural(reps, 'шаг', 'шага', 'шагов')
        : plural(reps, 'повтор', 'повтора', 'повторов');
    const each = kind === 'steps' ? 'Каждый шаг' : 'Каждый повтор';
    lines.push(`🔁 ${reps} ${noun}${side}`);
    lines.push(`⏱ ${each} ~${repSec} с${repNote === null ? '' : `: ${escapeHtml(repNote)}`}`);
  }

  const load = loadLine(item);
  if (load !== '') {
    lines.push(`🏋️ ${escapeHtml(load)}`);
  }
  return lines;
}

function loadLine(item: PlannedItem): string {
  const parts: string[] = [];
  if (item.weight !== null) {
    parts.push(`Гиря ${formatWeight(item.weight)} кг`);
  }
  // Темп уже расшифрован в строке «Каждый повтор», дважды не нужно.
  const tempo = item.repNote === null ? tempoLabel(item) : '';
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
  return formatVolume(step.item);
}

/** «3×15», «2×3×20 с» (подходы × удержания × секунды), «30 мин». Единица подход не пишется. */
function formatVolume(item: PlannedItem): string {
  const parts: string[] = [];
  if (item.sets > 1) {
    parts.push(String(item.sets));
  }
  if (item.unit === 'seconds' && item.holds > 1) {
    parts.push(String(item.holds));
  }
  parts.push(formatTarget(item));
  return parts.join('×');
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
  return `${name}${weight}${suffix} — ${formatVolume(item)}${side}`;
}

function formatTarget(item: PlannedItem): string {
  switch (item.unit) {
    case 'reps':
      return String(item.target);
    case 'seconds':
      return seconds(item.target);
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
