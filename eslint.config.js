import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  AbortController: 'readonly',
  Blob: 'readonly',
  Buffer: 'readonly',
  File: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
};

const browserGlobals = {
  Document: 'readonly',
  Element: 'readonly',
  Event: 'readonly',
  HTMLElement: 'readonly',
  MouseEvent: 'readonly',
  Node: 'readonly',
  document: 'readonly',
  getComputedStyle: 'readonly',
  localStorage: 'readonly',
  window: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'data/**', 'tmp/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ['WeChat Mini Program/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals,
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        Behavior: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
        wx: 'readonly',
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
        define: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'error',
    },
  },
  {
    files: ['server/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'server/**/*.{ts,tsx}',
      'shared/**/*.{ts,tsx}',
      'scripts/**/*.{ts,tsx}',
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // 既有源码仍有历史债务；第一阶段先保留告警，后续按规则逐步提升为 error。
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      'no-eval': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-implied-eval': 'error',
      'no-control-regex': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'preserve-caught-error': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier
);
