import type { Chain, ChainStep, ProgressionState, UserProfile } from './types';

/**
 * Стартовые ступени лестниц.
 *
 * Правило из docs/05: нормативы из интернета игнорируются, при длинных рычагах старт берётся
 * на ступень ниже. Ошибиться вниз безопасно — лестница поднимается за пару тренировок,
 * а слишком высокий старт означает технику через силу.
 */

/** С этого роста рычаги делают отжимания и приседы объективно тяжелее (docs/05). */
const TALL_CM = 185;

/**
 * Ступень, с которой начинает здоровый взрослый. Ниже — реабилитационные варианты
 * (отжимания от стены), они нужны как запас вниз при откате, а не как старт.
 */
const NOMINAL_START: Record<UserProfile['level'], number> = { base: 3, strong: 4 };

const CHAINS: Chain[] = ['push', 'row', 'squat', 'hinge', 'core'];

export function startingLevels(user: UserProfile, chainSteps: ChainStep[]): ProgressionState[] {
  const nominal = NOMINAL_START[user.level];
  const wanted = user.heightCm !== null && user.heightCm >= TALL_CM ? nominal - 1 : nominal;

  const states: ProgressionState[] = [];
  for (const chain of CHAINS) {
    const steps = chainSteps
      .filter((step) => step.chain === chain)
      .sort((left, right) => left.level - right.level);
    if (steps.length === 0) {
      continue;
    }

    const step = pickStep(steps, wanted, user);
    states.push({
      chain,
      exerciseCode: step.exerciseCode,
      chainLevel: step.level,
      tempo: step.tempo,
      weight: null,
      currentReps: step.targetMin,
    });
  }
  return states;
}

/** Ближайшая доступная ступень не выше желаемой: ступени с недостающим железом пропускаются. */
function pickStep(steps: ChainStep[], wanted: number, user: UserProfile): ChainStep {
  const available = steps.filter(
    (step) => step.level <= Math.max(1, wanted) && hasRequirement(step, user),
  );
  const chosen = available.at(-1) ?? steps.find((step) => hasRequirement(step, user)) ?? steps[0];
  if (chosen === undefined) {
    throw new Error('В лестнице нет ни одной ступени');
  }
  return chosen;
}

function hasRequirement(step: ChainStep, user: UserProfile): boolean {
  switch (step.requires) {
    case null:
      return true;
    case 'bar':
      return user.hasPullupBar;
    case 'band':
      return user.hasBand;
    case 'backpack':
      return user.hasBackpack;
    case 'kettlebell':
      return user.kettlebells.length > 0;
  }
}
