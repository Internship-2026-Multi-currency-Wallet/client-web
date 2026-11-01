# client-web

The end-user web app of the white-label multi-currency wallet: sign-up and login, balances, top-ups,
conversions, transfers, withdrawals and history.

Today this repository is a **skeleton**: a React app with the store, theme, routing, GraphQL clients, generated
types and mocks wired up. The features are your tasks.

## Stack

Vite 8 · React 19 · TypeScript 6 · Redux Toolkit (incl. RTK Query) · MUI 9 · React Router 8 · `graphql-request`
(queries/mutations) · `graphql-ws` (subscriptions) · GraphQL Code Generator · Mock Service Worker 3 · Vitest +
React Testing Library · Playwright · ESLint + Prettier · Node.js 26.

## Run locally

```sh
nvm use                 # Node 26
npm install
npm run dev:mocks       # no backends needed: MSW answers every GraphQL call
# or
npm run dev             # against real backends on localhost:3000 / 3001
```

Open <http://localhost:5173>. The home page shows the wallet-core health, the dev user from `me`, and the live
server time from the rates-service `serverTime` subscription.

Real backends come from the `ops` repository (clone it next to this one, `../ops`). Start them in Docker from here —
`npm run infra` calls `../ops/dev.sh`:

```sh
npm run infra -- up wallet-core rates-service   # MySQL + Redis + these backends in containers
npm run dev
```

or run a backend from source in its own folder (`npm run infra:up` there, then `DEV_AUTH=true npm run start:dev`).
The backends listen on the same ports either way and must run with `DEV_AUTH=true` (containers from `ops` do).
Set the dev user in `.env.local`: `VITE_DEV_USER=1:wallet`.

| Script                             | What it does                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `npm run infra -- up <service...>` | `../ops/dev.sh up …`: MySQL + Redis + these services in containers   |
| `npm run infra:up`                 | Infrastructure only (MySQL + Redis)                                  |
| `npm run infra:ps` / `infra:down`  | Status / stop the stack (data is kept)                               |
| `npm run infra -- <command>`       | Any `dev.sh` command: `logs <service>`, `build <service>`, `info`, … |

`npm run infra -- up client-web` serves the built app on <http://localhost:8080> (`all` = the whole system). Images are
built one at a time; give Docker at least 4 GiB if you run the whole stack. Details: the `ops` README.

## Scripts

| Script                              | What it does                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev` / `npm run dev:mocks` | Dev server on :5173 (real backends / mocks)                                                       |
| `npm run build` / `npm run preview` | Type check + production build to `dist/` / serve it                                               |
| `npm run lint` / `npm run format`   | ESLint / Prettier                                                                                 |
| `npm run typecheck`                 | `tsc -b`                                                                                          |
| `npm test`                          | Unit and component tests (Vitest + RTL, against MSW)                                              |
| `npm run test:e2e`                  | Playwright smoke tests against the app with mocks (first time: `npx playwright install chromium`) |
| `npm run schema:pull`               | Download each backend's `schema.graphql` into `schema/`                                           |
| `npm run codegen`                   | Generate typed operations into `src/gql/`                                                         |

## Configuration — `src/config-env.ts`

One file with per-environment values (`local`, `staging`, `kvitka-uat`, `wisla-uat`), selected by `VITE_APP_ENV`.
Each value can be overridden by its own `VITE_*` variable and has a safe default. See `.env.example`.

| Variable                    | Default (`local`)               | Meaning                                                        |
| --------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `VITE_APP_ENV`              | `local`                         | Environment profile                                            |
| `VITE_CLIENT`               | `demo`                          | Client this build is for                                       |
| `VITE_WALLET_CORE_URL`      | `http://localhost:3000/graphql` | wallet-core GraphQL endpoint                                   |
| `VITE_RATES_SERVICE_URL`    | `http://localhost:3001/graphql` | rates-service GraphQL endpoint                                 |
| `VITE_RATES_SERVICE_WS_URL` | `ws://localhost:3001/graphql`   | rates-service subscriptions (graphql-ws)                       |
| `VITE_USE_MOCKS`            | `false`                         | `true` = MSW mocks instead of backends                         |
| `VITE_DEV_USER`             | —                               | Dev auth user, e.g. `1:wallet` → `Authorization: Dev 1:wallet` |

Vite inlines these values at **build time**; the Docker image takes them as build args.

### Deployed environments (Cloudflare Pages)

Every push to `main` / `client/<c>-uat` builds the app in GitHub Actions with that environment's values and uploads
it to Cloudflare Pages (`.github/workflows/deploy.yml` → `ops/.github/workflows/deploy-pages.yml`). No manual deploys.

| Environment  | Branch              | URL                                     | Build values                                                         |
| ------------ | ------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `staging`    | `main`              | <https://staging.wallet.shatori.com>    | `VITE_APP_ENV=staging`, `VITE_CLIENT=demo`, `VITE_DEV_USER=1:wallet` |
| `kvitka-uat` | `client/kvitka-uat` | <https://kvitka-uat.wallet.shatori.com> | `VITE_APP_ENV=kvitka-uat`, `VITE_CLIENT=kvitka`, no dev user         |
| `wisla-uat`  | `client/wisla-uat`  | <https://wisla-uat.wallet.shatori.com>  | `VITE_APP_ENV=wisla-uat`, `VITE_CLIENT=wisla`, no dev user           |

`VITE_APP_ENV` selects the backend URLs from `ENVIRONMENTS` in `src/config-env.ts`:
`https://<env>-wallet-core.wallet.shatori.com/graphql`, `https://<env>-rates.wallet.shatori.com/graphql`
(subscriptions `wss://<env>-rates.wallet.shatori.com/graphql`).
The Docker image (nginx) is for the local stack only.

## GraphQL: contract, types and mocks

1. **Contract.** Each backend commits its `schema.graphql`. `npm run schema:pull` downloads them from the `main`
   branch on GitHub into `schema/` (committed). Before a backend contract PR is merged you can pull from its branch
   (`SCHEMA_REF=feat/x npm run schema:pull`) or from sibling folders (`SCHEMA_SOURCE=local npm run schema:pull`).
2. **Operations.** Write operations next to the feature, in a file named after the backend:
   `features/<feature>/<name>.wallet-core.ts` or `<name>.rates-service.ts`, using `graphql()` from
   `src/gql/<service>`. Run `npm run codegen`; generated files in `src/gql/` are committed.
3. **Calls.** `request('walletCore', doc, vars)` for queries/mutations and `subscribe('ratesService', doc, handlers)`
   for subscriptions (`src/graphql/client.ts`). Both add the dev auth header / connection param.
   Wrap queries in RTK Query endpoints (`api.injectEndpoints`, see `features/system/systemApi.ts`).
4. **Mocks.** `src/mocks/handlers.ts` has one `graphql.link()` per backend; handlers are typed with the generated
   types, so a contract change breaks the build where mocks need updating. Subscriptions are mocked too
   (see `ServerTime`). The same handlers serve the browser (`VITE_USE_MOCKS=true`), Vitest and Playwright.

Every screen must work with mocks — that is how you build UI before its backend exists.

## Project layout

```
src/
  app/           store, RTK Query api, theme, routes, providers
  features/      one folder per feature: slice, api endpoints, operations, components, tests
  pages/         route components (Home, 404)
  layout/        app shell
  graphql/       GraphQL clients + dev auth header
  gql/           generated by codegen (do not edit)
  mocks/         MSW handlers (browser + node)
  config-env.ts  build-time configuration
schema/          backend contracts (pulled)
e2e/             Playwright smoke tests
```

Shared files (`app/store.ts`, `app/routes.tsx`, layout/navigation) change only in small, dedicated PRs.

## Docker

```sh
docker build -t client-web --build-arg VITE_WALLET_CORE_URL=http://localhost:3000/graphql .
docker run --rm -p 8080:8080 client-web
```

Two stages: Node builds `dist/`, then `nginx-unprivileged` (non-root, port 8080) serves it with an SPA fallback.
