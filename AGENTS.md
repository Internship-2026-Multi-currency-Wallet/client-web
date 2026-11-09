# AGENTS.md — conventions for AI coding agents

This is `client-web`, a Vite + React 19 + TypeScript 6 app with Redux Toolkit, MUI 9, React Router 8,
graphql-request / graphql-ws, GraphQL Code Generator and MSW. Read `README.md` first.

## Rules

- **Folder per feature.** New UI goes to `src/features/<feature>/`: components, RTK slice and/or
  `api.injectEndpoints(...)`, GraphQL operations, tests. Pages in `src/pages/`. Touch shared files
  (`app/store.ts`, `app/routes.tsx`, layout) only in small, dedicated changes.
- **Contract first.** Never hand-write GraphQL types. Pull contracts (`npm run schema:pull`), write operations in
  `*.wallet-core.ts` / `*.rates-service.ts` files with `graphql()` from `src/gql/<service>`, run `npm run codegen`.
  Do not edit `src/gql/` or `schema/` by hand.
- **Network only through `src/graphql/client.ts`** (`request`, `subscribe`). Never call `fetch`/`WebSocket` directly
  and never build auth headers yourself.
- **Mocks are required.** Every new operation gets an MSW handler in `src/mocks/handlers.ts`; every screen must
  work with `VITE_USE_MOCKS=true`.
- **Config** only via `src/config-env.ts` (`VITE_*` overrides with safe defaults).
- **Client differences.** Never `if (client === 'kvitka')` in shared code; differences come from settings/flags.
  Products come from the `products.enabled` setting: `buildAppRoutes` (`src/app/routes.tsx`) builds the routes and the
  menu items together, so a product that is not enabled has neither. Add a product = one entry in its `PRODUCTS`
  catalog. UI that only one client has lives as code on that client's branch (`client/<client>-uat`), like
  `src/brand/`, and is never merged into `main`.
- **MUI:** use theme values and the `sx` prop (MUI 9 has no system props on layout components).
- **Money:** integers in minor units; format for display only. Never floating point math on amounts.
- **Tests are required:** Vitest + React Testing Library next to the code (`*.test.ts(x)`), using MSW; Playwright
  for flows (`e2e/`). Run before finishing: `npm run lint && npm run typecheck && npm test && npm run test:e2e`.
- **No secrets.** This repository is public and everything in the bundle is public. No tokens or keys in code or `.env.example`.
- English only. Conventional Commits (`feat(balances): ...`). Small PRs using `.github/pull_request_template.md`.
