// @ts-check
// Type-aware rules. Run by `npm run lint:types` only: slow, so kept out of `npm run lint` and `npm run build`.
import tseslint from 'typescript-eslint';
import noStyleColour from './eslint-rules/no-style-colour.js';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'src/gql',
      'src/brand',
      'public',
      'playwright-report',
      'test-results',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: ['./tsconfig.app.json'], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { local: { rules: { 'no-style-colour': noStyleColour } } },
    rules: { 'local/no-style-colour': 'error' },
  },
);
