import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../app/AppProviders';
import { routes } from '../app/routes';
import { createStore } from '../app/store';

/** Renders the whole app (store, theme, router) at the given URL. */
export function renderApp(url = '/') {
  const store = createStore();
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  return {
    store,
    router,
    ...render(
      <AppProviders store={store}>
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  };
}
