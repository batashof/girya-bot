import { InputFile } from 'grammy';
import type { ExerciseMedia } from '../data/repositories/media';
import { BUILTIN_DEMOS, BUILTIN_DEMO_DIGESTS } from './ui/demos.generated';

/**
 * Демонстрация движения к упражнению.
 *
 * Приоритет: своя присланная гифка → `file_id` уже отправленной встроенной схемы →
 * схема из бандла воркера. Последний вариант стоит одной загрузки, после которой
 * `file_id` кешируется и файл больше не уезжает (ADR-014).
 */
export interface Demo {
  kind: 'animation' | 'photo' | 'video';
  file: string | InputFile;
  /**
   * Отпечаток файла, ушедшего из бандла: его `file_id` из ответа Telegram стоит
   * запомнить вместе с ним. `null` — отправляется уже запомненный `file_id`.
   */
  bundleDigest: string | null;
}

export function resolveDemo(code: string, media: Map<string, ExerciseMedia>): Demo | null {
  const saved = media.get(code);
  const digest = BUILTIN_DEMO_DIGESTS[code];
  // Кеш встроенной схемы годен, только пока схема не перерисована: иначе бот так и
  // слал бы старую анимацию по старому `file_id`.
  if (saved !== undefined && (saved.source === 'user' || saved.digest === digest)) {
    return { kind: saved.kind, file: saved.fileId, bundleDigest: null };
  }

  const builtin = BUILTIN_DEMOS[code];
  if (builtin === undefined || digest === undefined) {
    return saved === undefined
      ? null
      : { kind: saved.kind, file: saved.fileId, bundleDigest: null };
  }
  return {
    kind: 'animation',
    file: new InputFile(new Uint8Array(builtin), `${code}.gif`),
    bundleDigest: digest,
  };
}
