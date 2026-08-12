/**
 * Тонкая обёртка над D1. Без ORM: запросы пишутся руками, строки маппятся в доменные типы
 * в репозиториях рядом (docs/02-architecture.md).
 */

export type Param = string | number | null;

export async function all<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results;
}

export async function one<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<T>();
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<void> {
  await db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** Пакет запросов одной транзакцией — D1 выполняет batch атомарно. */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export function bool(value: number | null | undefined): boolean {
  return value === 1;
}

export function flag(value: boolean): number {
  return value ? 1 : 0;
}
