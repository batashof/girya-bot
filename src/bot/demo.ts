import { InputFile } from 'grammy';
import type { ExerciseMedia } from '../data/repositories/media';
import { BUILTIN_DEMOS } from './ui/demos.generated';

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
  /** Файл ушёл из бандла — `file_id` из ответа Telegram стоит запомнить. */
  fromBundle: boolean;
}

export function resolveDemo(code: string, media: Map<string, ExerciseMedia>): Demo | null {
  const saved = media.get(code);
  if (saved !== undefined) {
    return { kind: saved.kind, file: saved.fileId, fromBundle: false };
  }

  const builtin = BUILTIN_DEMOS[code];
  if (builtin === undefined) {
    return null;
  }
  return {
    kind: 'animation',
    file: new InputFile(new Uint8Array(builtin), `${code}.gif`),
    fromBundle: true,
  };
}
