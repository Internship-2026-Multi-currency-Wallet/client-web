// @ts-check
// Keep type-aware lint out of builds because constructing the TypeScript program is slow.
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
