// Flat config. Recommended rules only - no type-aware linting (the
// transformers are string surgery; types buy nothing there).
import js from '@eslint/js';

export default [
  {
    ignores: ['out/**', 'test/tmp/**', 'example/**', 'docs/**', 'scratch*/**', 'node_modules/**', 'valdi*/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      // guarded fs reads (`try { read } catch {}`) are an established
      // pattern in the survey/discovery walkers
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
