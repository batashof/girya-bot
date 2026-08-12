import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', '.wrangler', 'coverage'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Подчёркивание = «параметр нужен по сигнатуре, но не используется» — как в tsconfig.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      // Правило слоёв из docs/02-architecture.md: domain/ ничего не знает про Telegram,
      // D1 и Workers — иначе его нельзя ни тестировать, ни перенести на другой хостинг.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['grammy', 'grammy/*'], message: 'domain/ не знает про Telegram' },
            { group: ['@cloudflare/*'], message: 'domain/ не знает про Workers' },
            {
              group: ['**/bot/**', '**/data/**', '**/platform/**'],
              message: 'domain/ — нижний слой',
            },
          ],
        },
      ],
    },
  },
);
