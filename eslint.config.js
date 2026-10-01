import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'server-dist/**',
      'android/**',
      'artifacts/**',
      'coverage/**',
      'node_modules/**',
      '.jdk21/**',
      '.android-sdk/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Introduced as warnings so the first CI run is green; count them with
      // `npm run lint:eslint` and tighten to errors as they are fixed.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      // Existing code trips these; they are style findings, not bugs.
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Accessibility (T8 R4). Warnings first; icon-only controls must have a name.
    files: ['src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...Object.fromEntries(Object.keys(jsxA11y.flatConfigs.recommended.rules).map(rule => [rule, 'warn'])),
      'jsx-a11y/label-has-for': 'off', // deprecated; label-has-associated-control replaces it
      'jsx-a11y/control-has-associated-label': ['warn', { ignoreElements: ['audio', 'canvas', 'embed', 'input', 'textarea', 'tr', 'video'], depth: 3 }],
    },
  },
  {
    // Server code has no `any`. Test doubles of Firestore keep it.
    files: ['src/server/**/*.ts'],
    ignores: ['src/server/**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
