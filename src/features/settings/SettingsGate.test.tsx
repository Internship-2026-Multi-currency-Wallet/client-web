import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../../config-env';
import type { PublicSettingsQuery } from '../../gql/wallet-core/graphql';
import { server } from '../../mocks/server';
import { renderApp } from '../../test/render';
import { settingsApi } from './settingsApi';
import { publicSettingsQuery } from './settings.wallet-core';
import { print } from 'graphql';
import { createStore } from '../../app/store';

const walletCore = graphql.link(config.walletCoreUrl);
const settingsOk = [
  { key: 'auth.googleLogin', value: false },
  { key: 'auth.phoneRequiredAt', value: 'signup' },
  { key: 'products.enabled', value: ['wallet', 'cards'] },
  { key: 'something.new', value: 42 },
];
const respondOk = (): HttpResponse<{ data: PublicSettingsQuery }> =>
  HttpResponse.json({ data: { publicSettings: settingsOk } });
const respond503 = (): HttpResponse<null> => HttpResponse.json(null, { status: 503 });

describe('PublicSettings operation', () => {
  it('requests key and value of publicSettings', () => {
    expect(print(publicSettingsQuery)).toMatch(/query PublicSettings/);
    expect(print(publicSettingsQuery).replace(/\s+/g, ' ')).toContain(
      'publicSettings { key value }',
    );
  });

  it('loads and validates settings into the RTK Query cache', async () => {
    server.use(walletCore.query('PublicSettings', respondOk));
    const store = createStore();
    const result = await store.dispatch(settingsApi.endpoints.publicSettings.initiate());
    expect(result.data).toEqual({
      'auth.googleLogin': false,
      'auth.phoneRequiredAt': 'signup',
      'products.enabled': ['wallet', 'cards'],
    });
  });

  it('turns invalid values into an INVALID_SETTINGS error', async () => {
    server.use(
      walletCore.query('PublicSettings', () =>
        HttpResponse.json({ data: { publicSettings: [{ key: 'auth.googleLogin', value: 'x' }] } }),
      ),
    );
    const result = await createStore().dispatch(settingsApi.endpoints.publicSettings.initiate());
    expect(result.error).toMatchObject({ code: 'INVALID_SETTINGS' });
  });
});

describe('SettingsGate', () => {
  it('shows an accessible loading state and no pages until settings arrive', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      walletCore.query('PublicSettings', async () => {
        await gate;
        return respondOk();
      }),
    );
    renderApp('/');
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings');
    expect(screen.queryByRole('heading', { name: 'Welcome' })).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the app after successful initialization with a single request', async () => {
    let requests = 0;
    server.use(
      walletCore.query('PublicSettings', () => {
        requests += 1;
        return respondOk();
      }),
    );
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(requests).toBe(1);
  });

  it('shows the error and recovers with Retry', async () => {
    server.use(walletCore.query('PublicSettings', respond503, { once: true }));
    renderApp('/');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Could not load the app settings.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('treats a GraphQL error as a failure too', async () => {
    server.use(
      walletCore.query('PublicSettings', () =>
        HttpResponse.json({
          data: null,
          errors: [{ message: 'Not implemented', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
        }),
      ),
    );
    renderApp('/');
    expect(await screen.findByText('Could not load the app settings.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Internal error details are not shown to the user.
    expect(screen.queryByText(/Not implemented|INTERNAL_SERVER_ERROR/)).not.toBeInTheDocument();
  });

  it('shows invalid settings as a recoverable error', async () => {
    server.use(
      walletCore.query(
        'PublicSettings',
        () => HttpResponse.json({ data: { publicSettings: [] } }),
        { once: true },
      ),
    );
    renderApp('/');
    expect(await screen.findByText('Could not load the app settings.')).toBeInTheDocument();
    expect(screen.queryByText(/auth\.googleLogin|missing/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('keeps the settings when a background refetch returns invalid data', async () => {
    const { store } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    const before = settingsApi.endpoints.publicSettings.select()(store.getState()).data;

    server.use(
      walletCore.query('PublicSettings', () =>
        HttpResponse.json({ data: { publicSettings: [{ key: 'auth.googleLogin', value: 1 }] } }),
      ),
    );
    await store.dispatch(
      settingsApi.endpoints.publicSettings.initiate(undefined, { forceRefetch: true }),
    );
    const after = settingsApi.endpoints.publicSettings.select()(store.getState());
    expect(after.isError).toBe(true);
    expect(after.data).toEqual(before);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('keeps the app when a background refetch fails after a successful load', async () => {
    const { store } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();

    server.use(walletCore.query('PublicSettings', respond503));
    await store.dispatch(
      settingsApi.endpoints.publicSettings.initiate(undefined, { forceRefetch: true }),
    );
    await waitFor(() =>
      expect(settingsApi.endpoints.publicSettings.select()(store.getState()).isError).toBe(true),
    );
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(settingsApi.endpoints.publicSettings.select()(store.getState()).data).toBeDefined();
  });
});
