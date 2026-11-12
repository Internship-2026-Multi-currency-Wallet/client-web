import { render, screen } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { Provider } from 'react-redux';
import { AppProviders } from '../../app/AppProviders';
import { createStore } from '../../app/store';
import { config } from '../../config-env';
import { server } from '../../mocks/server';
import { useClientSetting } from './useClientSetting';

function Probe() {
  const googleLogin = useClientSetting('auth.googleLogin');
  const phone = useClientSetting('auth.phoneRequiredAt');
  const products = useClientSetting('products.enabled');
  // Compile-time check of the value types:
  const typed: [boolean, 'signup' | 'firstTransfer' | 'never', string[]] = [
    googleLogin,
    phone,
    products,
  ];
  return <div data-testid="probe">{JSON.stringify(typed)}</div>;
}

describe('useClientSetting', () => {
  it('returns typed values from the cache with a single request', async () => {
    let requests = 0;
    server.use(
      graphql.link(config.walletCoreUrl).query('PublicSettings', () => {
        requests += 1;
        return HttpResponse.json({
          data: {
            publicSettings: [
              { key: 'auth.googleLogin', value: false },
              { key: 'auth.phoneRequiredAt', value: 'firstTransfer' },
              { key: 'products.enabled', value: ['wallet', 'cards'] },
            ],
          },
        });
      }),
    );
    render(
      <AppProviders store={createStore()}>
        <Probe />
        <Probe />
      </AppProviders>,
    );
    const probes = await screen.findAllByTestId('probe');
    expect(probes[0]).toHaveTextContent('[false,"firstTransfer",["wallet","cards"]]');
    expect(requests).toBe(1);
  });

  it('throws a clear error when read before settings are loaded', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        render(
          // No SettingsGate here, so nothing has loaded.
          <Provider store={createStore()}>
            <Probe />
          </Provider>,
        ),
      ).toThrow('Setting "auth.googleLogin" read before settings were loaded');
    } finally {
      consoleError.mockRestore();
    }
  });
});
