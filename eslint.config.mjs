import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'tests/**', 'scripts/**', 'infra/**', '**/*.js', '**/*.mjs', '**/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  { files: ['**/*.spec.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  { files: ['**/main.ts'], rules: { 'no-console': 'off' } },
);
