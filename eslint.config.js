// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const HEX = String.raw`/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i`;
const NAMES = String.raw`/demo\s+wallet|kvitka\s+bank|wis[lł]a\s+transfer/i`;
const restrict = (regex, message) => [
  { selector: `Literal[value=${regex}]`, message },
  { selector: `TemplateElement[value.raw=${regex}]`, message },
  { selector: `JSXText[value=${regex}]`, message },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'src/gql', 'public', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        ...restrict(HEX, 'Hex colours live only in src/brand/brand.ts; use the theme'),
        ...restrict(NAMES, 'Product names live only in src/brand/brand.ts; use brand.siteName'),
      ],
    },
  },
  { files: ['src/brand/**'], rules: { 'no-restricted-syntax': 'off' } },
  prettier,
);
