/** Гифки-схемы попадают в бандл воркера как бинарные модули (см. `rules` в wrangler.toml). */
declare module '*.gif' {
  const content: ArrayBuffer;
  export default content;
}
