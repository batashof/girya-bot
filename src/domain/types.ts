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
 * Роль пункта в дне: шея → основное движение → осанка → поддерживающее → мобилити.
 * Шея и основное движение составляют «сокращённую версию» вечернего пинга (ADR-018).
 */
export type Block = 'neck' | 'main' | 'circuit' | 'posture' | 'support' | 'mobility' | 'walk';

export type Intensity = 'heavy' | 'medium' | 'light' | 'recovery';

/**
 * Доза упражнения «само по себе» — когда его выбирают вне программы дня (ADR-016, ADR-017):
 * подходы, повторы в подходе и отдых между подходами. У удержаний (`unit = 'seconds'`)
 * повтор — одно удержание длиной `repSec`.
 */
export interface Dose {
  sets: number;
  reps: number;
  restSec: number;
}

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
  videoUrl: string | null;
  neckSafe: boolean;
  swapGroup: string;
  dose: Dose;
  /**
   * Сколько секунд занимает один повтор. У удержаний это и есть задание («держи 30 с»),
   * у движений — темп («~4 с»). Карточка показывает ровно это число, а в `cues` цифр
   * времени и количества нет: иначе техника спорит с заданием (ADR-017).
   */
  repSec: number;
  /** Из чего складывается повтор: «1 с вверх, 3 с вниз». Для удержаний не нужен. */
  repNote: string | null;
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
  /** Своё время повтора у ступени с темпом или паузой; `null` — как у упражнения. */
  repSec: number | null;
  repNote: string | null;
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
  /** Удержаний в подходе — только для `unit = 'seconds'`, где цель — секунды удержания. */
  holds: number;
  restSec: number;
  loadHint: LoadHint | null;
  optional: boolean;
}

/**
 * Тема тренировки по запросу: одна группа упражнений справочника (шея, лопатки, ноги…).
 * Живёт в `templates` с `kind = 'theme'` — к ней привязываются сессии (ADR-016).
 */
export interface Theme {
  code: string;
  title: string;
  groupCode: string;
}

/**
 * Комплекс под одну проблему (ADR-018): фиксированный набор упражнений с дозами,
 * проходится по порядку от начала до конца. Пункты — обычные `template_items`.
 * Как и тема, лестницы и серию не двигает: пункты не привязаны к лестницам.
 */
export interface Complex {
  code: string;
  title: string;
  /** Одна-две фразы: для чего комплекс и когда его делать. */
  note: string;
}

export interface DayTemplate {
  code: string;
  title: string;
  /** 1 = понедельник … 7 = воскресенье. */
  weekday: number;
  intensity: Intensity;
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
 * Как пользователь тренируется. `daily` — программа дня с утренним напоминанием;
 * `on_demand` — напоминаний о программе нет, тренировка начинается по запросу:
 * программой дня или темой (ADR-016). Программа дня доступна в обоих режимах.
 */
export type TrainingMode = 'daily' | 'on_demand';

/**
 * Полная запись пользователя. Резолверу дня хватает `UserProfile`; остальное нужно
 * напоминаниям и настройкам.
 */
export interface User extends UserProfile {
  telegramId: number;
  trainingMode: TrainingMode;
  /** HH:MM локального времени. */
  remindAt: string;
  eveningPingAt: string | null;
  weightKg: number | null;
  birthYear: number | null;
  /** Пауза — диапазон дат, а не дедлайн: серия должна знать, какие дни прощать. */
  pausedFrom: string | null;
  pausedUntil: string | null;
  /** Момент в UTC, до которого утреннее напоминание отложено кнопкой «Через час». */
  snoozeUntil: string | null;
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
  /**
   * Прогрессируемое число: повторы в подходе (`reps`), шаги (`steps`) или секунды одного
   * удержания (`seconds`). Сколько это в повторах и секундах — `prescription()` в session.ts.
   */
  target: number;
  /** Удержаний в подходе для `unit = 'seconds'`; для остальных единиц всегда 1. */
  holds: number;
  /** Секунд на повтор у движений (с темпом ступени); у удержаний не используется. */
  repSec: number;
  repNote: string | null;
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
  /** Чего не будет: нет инвентаря или упражнение нельзя при боли в шее — бот об этом говорит. */
  dropped: string[];
}
