/**
 * Собирает миграцию-сид справочников из data/*.seed.json.
 *
 * Источник истины — JSON рядом с документацией; SQL генерируется, чтобы миграция
 * применялась обычным `wrangler d1 migrations apply` и её было видно в ревью.
 * Новое упражнение: строка в docs/06-exercise-library.md → запись в JSON → `pnpm seed:build`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OUTPUT = 'migrations/0002_seed_content.sql';

const exercises = readJson('data/exercises.seed.json');
const chains = readJson('data/chains.seed.json');
const templates = readJson('data/templates.seed.json');

const knownCodes = new Set(exercises.map((exercise) => exercise.code));
const lines = [
  '-- Сгенерировано `pnpm seed:build` из data/*.seed.json. Руками не править.',
  '',
  '-- Справочники пересобираются целиком: это статический контент, а не пользовательские данные.',
  'DELETE FROM template_items;',
  'DELETE FROM templates;',
  'DELETE FROM chain_steps;',
  'DELETE FROM exercises;',
  '',
];

lines.push('-- Упражнения (docs/06-exercise-library.md)');
for (const exercise of exercises) {
  requireFields(
    exercise,
    ['code', 'name', 'group_code', 'pattern', 'equipment', 'unit', 'cues', 'swap_group'],
    exercise.code,
  );
  if ((exercise.chain === null) !== (exercise.chain_level === null)) {
    fail(`${exercise.code}: chain и chain_level задаются вместе`);
  }
  lines.push(
    `INSERT INTO exercises (code, name, group_code, pattern, equipment, chain, chain_level, unit, unilateral, cues, mistakes, video_url, neck_safe, swap_group) VALUES (${[
      sql(exercise.code),
      sql(exercise.name),
      sql(exercise.group_code),
      sql(exercise.pattern),
      sql(exercise.equipment),
      sql(exercise.chain ?? null),
      num(exercise.chain_level ?? null),
      sql(exercise.unit),
      num(exercise.unilateral ?? 0),
      sql(exercise.cues),
      sql(exercise.mistakes ?? null),
      sql(exercise.video_url ?? null),
      num(exercise.neck_safe ?? 1),
      sql(exercise.swap_group),
    ].join(', ')});`,
  );
}

lines.push('', '-- Лестницы прогрессии (docs/06-exercise-library.md, ADR-011)');
for (const [chain, steps] of Object.entries(chains)) {
  if (chain.startsWith('_')) continue;
  steps.forEach((step, index) => {
    if (step.level !== index + 1) {
      fail(
        `${chain}: ступени должны идти подряд с 1, встретилась ${step.level} на месте ${index + 1}`,
      );
    }
    checkExercise(step.exercise, `лестница ${chain}, ступень ${step.level}`);
    lines.push(
      `INSERT INTO chain_steps (chain, level, exercise_code, variant, tempo, load_hint, requires, target_min, target_max) VALUES (${[
        sql(chain),
        num(step.level),
        sql(step.exercise),
        sql(step.variant ?? null),
        sql(step.tempo ?? 'normal'),
        sql(step.load_hint ?? null),
        sql(step.requires ?? null),
        num(step.target_min),
        num(step.target_max),
      ].join(', ')});`,
    );
  });
}

lines.push('', '-- Шаблоны дней (docs/05-training-program.md)');
const weekdays = new Set();
for (const template of templates.templates) {
  if (weekdays.has(template.weekday)) {
    fail(`на день недели ${template.weekday} назначено больше одного шаблона`);
  }
  weekdays.add(template.weekday);

  lines.push(
    `INSERT INTO templates (code, title, weekday, intensity, est_minutes, optional, kind) VALUES (${[
      sql(template.code),
      sql(template.title),
      num(template.weekday),
      sql(template.intensity),
      num(template.est_minutes),
      num(template.optional ?? 0),
      sql('day'),
    ].join(', ')});`,
  );

  const items = expandItems(template.items, templates.protocols, template.code);
  if (items[0]?.block !== 'neck') {
    fail(`${template.code}: шейный протокол должен быть первым пунктом дня (ADR-008)`);
  }
  items.forEach((item, index) => {
    checkExercise(item.exercise, `${template.code}, пункт ${index + 1}`);
    lines.push(
      `INSERT INTO template_items (template_code, position, exercise_code, block, follow_chain, sets, target_min, target_max, rest_sec, load_hint, optional) VALUES (${[
        sql(template.code),
        num(index + 1),
        sql(item.exercise),
        sql(item.block),
        sql(item.follow_chain ?? null),
        num(item.sets),
        num(item.target_min),
        num(item.target_max),
        num(item.rest_sec ?? 60),
        sql(item.load_hint ?? null),
        num(item.optional ?? 0),
      ].join(', ')});`,
    );
  });
}

if (weekdays.size !== 7) {
  fail(`шаблоны покрывают ${weekdays.size} дней недели из 7`);
}

lines.push('', '-- Микро-блоки /mini (docs/05-training-program.md, ADR-013)');
for (const block of templates.mini) {
  lines.push(
    `INSERT INTO templates (code, title, weekday, intensity, est_minutes, optional, kind) VALUES (${[
      sql(block.code),
      sql(block.title),
      num(0),
      sql('light'),
      num(block.est_minutes),
      num(1),
      sql('mini'),
    ].join(', ')});`,
  );
  block.items.forEach((item, index) => {
    checkExercise(item.exercise, `микро-блок ${block.code}, пункт ${index + 1}`);
    lines.push(
      `INSERT INTO template_items (template_code, position, exercise_code, block, follow_chain, sets, target_min, target_max, rest_sec, load_hint, optional) VALUES (${[
        sql(block.code),
        num(index + 1),
        sql(item.exercise),
        sql(item.block),
        'NULL',
        num(item.sets),
        num(item.target_min),
        num(item.target_max),
        num(item.rest_sec ?? 30),
        'NULL',
        num(0),
      ].join(', ')});`,
    );
  });
}

writeFileSync(OUTPUT, `${lines.join('\n')}\n`);
console.log(
  `${OUTPUT}: ${exercises.length} упражнений, ${templates.templates.length} шаблонов дня, ` +
    `${templates.mini.length} микро-блока`,
);

function expandItems(items, protocols, templateCode) {
  return items.flatMap((item) => {
    if (item.protocol === undefined) {
      return [item];
    }
    const protocol = protocols[item.protocol];
    if (protocol === undefined) {
      fail(`${templateCode}: неизвестный протокол «${item.protocol}»`);
    }
    return protocol;
  });
}

function checkExercise(code, where) {
  if (!knownCodes.has(code)) {
    fail(`${where}: упражнения «${code}» нет в exercises.seed.json`);
  }
}

function requireFields(object, fields, where) {
  for (const field of fields) {
    if (object[field] === undefined || object[field] === null || object[field] === '') {
      fail(`${where}: не заполнено поле «${field}»`);
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sql(value) {
  return value === null || value === undefined
    ? 'NULL'
    : `'${String(value).replaceAll("'", "''")}'`;
}

function num(value) {
  if (value === null || value === undefined) return 'NULL';
  if (!Number.isFinite(value)) fail(`ожидалось число, получено «${value}»`);
  return String(value);
}

function fail(message) {
  console.error(`Сид не собран: ${message}`);
  process.exit(1);
}
