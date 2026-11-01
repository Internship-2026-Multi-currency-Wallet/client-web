/**
 * Downloads the GraphQL contract (`schema.graphql`) of each backend into `schema/`.
 *
 *   npm run schema:pull                         # from the `main` branch on GitHub
 *   SCHEMA_REF=feat/ledger npm run schema:pull  # from another branch (e.g. an open contract PR)
 *   SCHEMA_SOURCE=local npm run schema:pull     # from sibling folders (../wallet-core/schema.graphql)
 *
 * Then run `npm run codegen` to regenerate the typed operations in `src/gql/`.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ORG = 'Internship-2026-Multi-currency-Wallet';
const SERVICES = ['wallet-core', 'rates-service'];

const root = join(import.meta.dirname, '..');
const ref = process.env.SCHEMA_REF || 'main';
const source = process.env.SCHEMA_SOURCE === 'local' ? 'local' : 'github';

await mkdir(join(root, 'schema'), { recursive: true });

for (const service of SERVICES) {
  let sdl: string;
  if (source === 'local') {
    sdl = await readFile(join(root, '..', service, 'schema.graphql'), 'utf8');
  } else {
    const url = `https://raw.githubusercontent.com/${ORG}/${service}/${ref}/schema.graphql`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
      process.exit(1);
    }
    sdl = await response.text();
  }
  await writeFile(join(root, 'schema', `${service}.graphql`), sdl);
  console.log(
    `schema/${service}.graphql <- ${source === 'local' ? `../${service}` : `${service}@${ref}`}`,
  );
}
