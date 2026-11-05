import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * One generated module per backend, because every service has its own schema.
 * Operations for a service live in files named `*.<service>.ts`, e.g. `system.wallet-core.ts`,
 * and use the `graphql()` function from `src/gql/<service>`.
 */
const service = (name: string) => ({
  schema: `schema/${name}.graphql`,
  documents: [`src/**/*.${name}.ts`],
  preset: 'client' as const,
  presetConfig: { fragmentMasking: false },
  config: {
    useTypeImports: true,
    enumsAsTypes: true,
    // Never `any`: JSON values must be validated before use (see features/settings).
    scalars: { JSON: 'unknown', DateTime: 'string' },
  },
});

const config: CodegenConfig = {
  ignoreNoDocuments: true,
  generates: {
    'src/gql/wallet-core/': service('wallet-core'),
    'src/gql/rates-service/': service('rates-service'),
  },
};

export default config;
