/**
 * Build-time configuration of the app.
 *
 * - `VITE_APP_ENV` picks a set of per-environment values (default `local`).
 * - Every value can be overridden by its own `VITE_*` variable.
 * - Everything has a safe default, so `npm run dev` works without any `.env`.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time: changing them needs a rebuild.
 */

export const APP_ENVS = ['local', 'staging', 'kvitka-uat', 'wisla-uat'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface AppConfig {
  appEnv: AppEnv;
  /** Client this build is for: `demo`, `kvitka`, `wisla`. Only for display/branding defaults. */
  client: string;
  walletCoreUrl: string;
  ratesServiceUrl: string;
  ratesServiceWsUrl: string;
  /** `true` → Mock Service Worker answers all GraphQL calls (no backends needed). */
  useMocks: boolean;
  /** Dev auth user, e.g. `1:wallet` → `Authorization: Dev 1:wallet`. Empty = anonymous. */
  devUser: string | null;
  /** Google OAuth Client ID for "Sign in with Google". Public (ends up in the bundle). `null` = not configured. */
  googleClientId: string | null;
}

type EnvValues = Pick<
  AppConfig,
  'client' | 'walletCoreUrl' | 'ratesServiceUrl' | 'ratesServiceWsUrl'
>;

const deployed = (env: string, client: string): EnvValues => ({
  client,
  // Backends of a deployed environment: https://<env>-<service>.wallet.shatori.com
  walletCoreUrl: `https://${env}-wallet-core.wallet.shatori.com/graphql`,
  ratesServiceUrl: `https://${env}-rates.wallet.shatori.com/graphql`,
  ratesServiceWsUrl: `wss://${env}-rates.wallet.shatori.com/graphql`,
});

/** Per-environment values. */
export const ENVIRONMENTS: Record<AppEnv, EnvValues> = {
  local: {
    client: 'demo',
    walletCoreUrl: 'http://localhost:3000/graphql',
    ratesServiceUrl: 'http://localhost:3001/graphql',
    ratesServiceWsUrl: 'ws://localhost:3001/graphql',
  },
  staging: deployed('staging', 'demo'),
  'kvitka-uat': deployed('kvitka-uat', 'kvitka'),
  'wisla-uat': deployed('wisla-uat', 'wisla'),
};

type RawEnv = Record<string, string | boolean | undefined>;

function str(env: RawEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Pure function: raw `import.meta.env` → config. Easy to test with any env. */
export function resolveConfig(env: RawEnv): AppConfig {
  const requested = str(env, 'VITE_APP_ENV');
  const appEnv: AppEnv = APP_ENVS.includes(requested as AppEnv) ? (requested as AppEnv) : 'local';
  const base = ENVIRONMENTS[appEnv];
  return {
    appEnv,
    client: str(env, 'VITE_CLIENT') ?? base.client,
    walletCoreUrl: str(env, 'VITE_WALLET_CORE_URL') ?? base.walletCoreUrl,
    ratesServiceUrl: str(env, 'VITE_RATES_SERVICE_URL') ?? base.ratesServiceUrl,
    ratesServiceWsUrl: str(env, 'VITE_RATES_SERVICE_WS_URL') ?? base.ratesServiceWsUrl,
    useMocks: str(env, 'VITE_USE_MOCKS') === 'true',
    devUser: str(env, 'VITE_DEV_USER') ?? null,
    googleClientId: str(env, 'VITE_GOOGLE_CLIENT_ID') ?? null,
  };
}

export const config: AppConfig = resolveConfig(import.meta.env);
