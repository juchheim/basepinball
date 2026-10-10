import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'docs/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The physics step must stay deterministic across JS engines (docs/MVP/03-physics.md § 8).
    files: ['src/physics/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['sin', 'cos', 'tan', 'atan2', 'exp', 'pow', 'random'].map((property) => ({
          object: 'Math',
          property,
          message:
            'Use src/core/dmath.ts or the seeded RNG; the physics step must be deterministic.',
        })),
      ],
    },
  },
);
