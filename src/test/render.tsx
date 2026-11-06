import { render } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { AppProviders } from '../app/AppProviders';
import { AppRouter } from '../app/AppRouter';
import { createStore } from '../app/store';

/** Renders the whole app (store, theme, settings, router) at the given URL. */
export function renderApp(url = '/') {
  const store = createStore();
  const createRouter = (routes: RouteObject[]) =>
    createMemoryRouter(routes, { initialEntries: [url] });
  return {
    store,
    ...render(
      <AppProviders store={store}>
        <AppRouter createRouter={createRouter} />
      </AppProviders>,
    ),
  };
}
