/** Типы предметной области. Ничего платформенного: см. правило слоёв в docs/02-architecture.md. */

/** Лестница движения — ключ прогрессии (ADR-011). */
export type Chain = 'push' | 'row' | 'squat' | 'hinge' | 'core';

export type Unit = 'reps' | 'seconds' | 'steps';

export type Tempo = 'normal' | 'slow' | 'pause';

export type Equipment = 'none' | 'kettlebell' | 'band' | 'bar' | 'wall' | 'backpack';

/** Инвентарь, которого может не быть. Стена, пол и стул есть всегда. */
export type OptionalEquipment = 'kettlebell' | 'band' | 'bar' | 'backpack';

export type LoadHint = 'bodyweight' | 'kb_light' | 'kb_main' | 'kb_heavy' | 'backpack';

/**
 * Роль пункта в дне. Задаёт и порядок показа, и очередь на вылет по бюджету минут:
 * шея → основное движение → осанка → поддерживающее → мобилити (ADR-012).
 */
export type Block = 'neck' | 'main' | 'circuit' | 'posture' | 'support' | 'mobility' | 'walk';

export type Intensity = 'heavy' | 'medium' | 'light' | 'recovery';

export interface Exercise {
  code: string;
  name: string;
  groupCode: string;
  pattern: string;
  equipment: Equipment;
  chain: Chain | null;
  chainLevel: number | null;
  unit: Unit;
  unilateral: boolean;
  cues: string;
  mistakes: string | null;
  neckSafe: boolean;
  swapGroup: string;
}

/** Ступень лестницы: упражнение плюс уточнение варианта, темпа и веса. */
export interface ChainStep {
  chain: Chain;
  level: number;
  exerciseCode: string;
  variant: string | null;
  tempo: Tempo;
  loadHint: LoadHint | null;
  requires: OptionalEquipment | null;
  targetMin: number;
  targetMax: number;
}

export interface TemplateItem {
  position: number;
  exerciseCode: string;
  block: Block;
  /** Если задано — упражнение берётся не из шаблона, а из текущей ступени пользователя. */
  followChain: Chain | null;
  sets: number;
  targetMin: number;
  targetMax: number;
  restSec: number;
  loadHint: LoadHint | null;
  optional: boolean;
}

export interface DayTemplate {
  code: string;
  title: string;
  /** 1 = понедельник … 7 = воскресенье. */
  weekday: number;
  intensity: Intensity;
  estMinutes: number;
  optional: boolean;
  items: TemplateItem[];
}

/** Текущее состояние по одной лестнице. */
export interface ProgressionState {
  chain: Chain;
  exerciseCode: string;
  chainLevel: number;
  tempo: Tempo;
  weight: number | null;
  currentReps: number;
  /** Тренировок подряд с фидбэком «тяжело» — на двух подряд лестница идёт вниз. */
  hardStreak: number;
  /** Тренировок подряд, выполненных по цели — на двух подряд лестница идёт вверх. */
  easyStreak: number;
}

export interface Kettlebell {
  weight: number;
  count: number;
}

export interface UserProfile {
  timezone: string;
  sessionMinutes: number;
  heightCm: number | null;
  level: 'base' | 'strong';
  hasPullupBar: boolean;
  hasBand: boolean;
  hasBackpack: boolean;
  kettlebells: Kettlebell[];
  /** Дата начала 4-недельного блока, YYYY-MM-DD. */
  blockStart: string;
}

/**
 * Полная запись пользователя. Резолверу дня хватает `UserProfile`; остальное нужно
 * напоминаниям и настройкам.
 */
export interface User extends UserProfile {
  telegramId: number;
  /** HH:MM локального времени. */
  remindAt: string;
  eveningPingAt: string | null;
  miniReminders: boolean;
  weightKg: number | null;
  birthYear: number | null;
  pausedUntil: string | null;
}

/** Пункт готовой тренировки: уже с подставленным вариантом, весом и целью. */
export interface PlannedItem {
  position: number;
  block: Block;
  exercise: Exercise;
  /** Лестница, из которой взят пункт. Только по таким считается прогрессия. */
  chain: Chain | null;
  /** Уточнение из лестницы: «с колен», «ноги прямые». */
  variant: string | null;
  sets: number;
  target: number;
  unit: Unit;
  tempo: Tempo;
  weight: number | null;
  restSec: number;
  unilateral: boolean;
}

/** Как прошёл подход. Порядок важен: чем дальше, тем «хуже» для прогрессии. */
export type Feedback = 'easy' | 'ok' | 'hard' | 'pain' | 'skipped';

/** Записанный факт по подходу — то, что уходит в `session_sets`. */
export interface SetRecord {
  position: number;
  exerciseCode: string;
  setIndex: number;
  targetValue: number;
  actualValue: number | null;
  feedback: Feedback;
}

export interface Workout {
  templateCode: string;
  title: string;
  weekInBlock: number;
  /** Четвёртая неделя блока: те же уровни, меньше объёма (docs/05). */
  deload: boolean;
  optional: boolean;
  items: PlannedItem[];
  estimatedMinutes: number;
  /** Что не влезло в бюджет минут — чтобы бот мог об этом сказать. */
  dropped: string[];
}
