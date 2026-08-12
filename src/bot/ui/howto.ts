import type { ChainStep, Exercise } from '../../domain/types';

/** Карточка техники для `/howto` (docs/01-plan.md, M6). */

const EQUIPMENT_LABELS: Record<string, string> = {
  none: 'вес тела',
  kettlebell: 'гиря',
  band: 'резина',
  bar: 'турник',
  wall: 'стена, пол или стул',
  backpack: 'рюкзак',
};

const UNIT_LABELS: Record<string, string> = {
  reps: 'повторы',
  seconds: 'секунды удержания',
  steps: 'шаги',
};

export function renderHowto(options: {
  exercise: Exercise;
  steps: ChainStep[];
  hasMedia: boolean;
}): string {
  const { exercise } = options;
  const lines = [`${exercise.name} · ${exercise.code}`, ''];

  lines.push(exercise.cues);

  if (exercise.mistakes !== null) {
    lines.push('', `⚠️ Частая ошибка: ${lowerFirst(exercise.mistakes)}`);
  }

  lines.push(
    '',
    `Инвентарь: ${EQUIPMENT_LABELS[exercise.equipment] ?? exercise.equipment}. ` +
      `Считаем ${UNIT_LABELS[exercise.unit] ?? exercise.unit}` +
      (exercise.unilateral ? ', на каждую сторону.' : '.'),
  );

  const own = options.steps.filter((step) => step.exerciseCode === exercise.code);
  if (own.length > 0) {
    const chain = own[0]?.chain;
    const total = options.steps.filter((step) => step.chain === chain).length;
    lines.push('', 'Место в лестнице:');
    for (const step of own) {
      const variant = step.variant === null ? '' : ` — ${step.variant}`;
      lines.push(`  ${step.level} из ${total}${variant}`);
    }
  }

  if (!exercise.neckSafe) {
    // Инвариант из docs/03: в день боли ≥2 такие упражнения не предлагаются вовсе.
    lines.push('', '🚫 В день боли в шее это упражнение бот не даёт.');
  }

  lines.push('', 'Каждый подход заканчивается за 3–4 повтора до отказа.');

  if (!options.hasMedia) {
    lines.push(`Показать, как это выглядит: пришли гифку с подписью /gif ${exercise.code}`);
  }

  return lines.join('\n');
}

/** Ссылка на демо: свой URL, если задан, иначе поиск по названию. */
export function demoLink(exercise: Exercise): string {
  if (exercise.videoUrl !== null) {
    return exercise.videoUrl;
  }
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name)}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
