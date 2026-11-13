import { ENVIRONMENTS, resolveConfig } from './config-env';

describe('resolveConfig', () => {
  it('uses safe local defaults when nothing is set', () => {
    expect(resolveConfig({})).toEqual({
      appEnv: 'local',
      ...ENVIRONMENTS.local,
      useMocks: false,
      devUser: null,
      googleClientId: null,
    });
  });

  it('picks per-environment values with VITE_APP_ENV', () => {
    const config = resolveConfig({ VITE_APP_ENV: 'kvitka-uat' });
    expect(config.client).toBe('kvitka');
    expect(config.walletCoreUrl).toBe(ENVIRONMENTS['kvitka-uat'].walletCoreUrl);
  });

  it('lets VITE_* variables override single values', () => {
    const config = resolveConfig({
      VITE_APP_ENV: 'staging',
      VITE_WALLET_CORE_URL: 'http://wc.test/graphql',
      VITE_CLIENT: 'wisla',
      VITE_USE_MOCKS: 'true',
      VITE_DEV_USER: '1:wallet',
      VITE_GOOGLE_CLIENT_ID: ' 123-abc.apps.googleusercontent.com ',
    });
    expect(config).toMatchObject({
      appEnv: 'staging',
      walletCoreUrl: 'http://wc.test/graphql',
      ratesServiceUrl: ENVIRONMENTS.staging.ratesServiceUrl,
      client: 'wisla',
      useMocks: true,
      devUser: '1:wallet',
      googleClientId: '123-abc.apps.googleusercontent.com',
    });
  });

  it('falls back to local for an unknown environment and ignores empty values', () => {
    const config = resolveConfig({ VITE_APP_ENV: 'prod', VITE_WALLET_CORE_URL: ' ' });
    expect(config.appEnv).toBe('local');
    expect(config.walletCoreUrl).toBe(ENVIRONMENTS.local.walletCoreUrl);
  });
});
