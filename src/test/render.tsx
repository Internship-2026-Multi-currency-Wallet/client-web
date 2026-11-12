import { render } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { AppProviders } from '../app/AppProviders';
import { AppRouter } from '../app/AppRouter';
import { createStore } from '../app/store';

type Router = ReturnType<typeof createMemoryRouter>;

/** Renders the whole app at `url`. `routers` lists every router AppRouter created (normally one). */
export function renderApp(url = '/') {
  const store = createStore();
  const routers: Router[] = [];
  const createRouter = (routes: RouteObject[]) => {
    const router = createMemoryRouter(routes, { initialEntries: [url] });
    routers.push(router);
    return router;
  };
  // AppRouter creates the router only once the settings are loaded, so this reads the current one lazily.
  const current = () => routers[routers.length - 1];
  const router: Pick<Router, 'state' | 'navigate'> = {
    get state() {
      return current().state;
    },
    navigate: ((...args: Parameters<Router['navigate']>) =>
      current().navigate(...args)) as Router['navigate'],
  };
  return {
    store,
    router,
    routers,
    ...render(
      <AppProviders store={store}>
        <AppRouter createRouter={createRouter} />
      </AppProviders>,
    ),
  };
}
