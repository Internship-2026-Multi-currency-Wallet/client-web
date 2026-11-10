import type { RouteObject } from 'react-router';
import { buildAppRoutes } from './routes';

/** Readable names: `index` for `/`, otherwise the path; pathless groups are flattened. */
const names = (routes: RouteObject[]): (string | undefined)[] =>
  routes.flatMap((route) =>
    route.children ? names(route.children) : [route.index ? 'index' : route.path],
  );

/** Routes inside the layout, in order. */
function routeNames(enabledProducts: string[]): (string | undefined)[] {
  const [layout] = buildAppRoutes(enabledProducts).routes;
  return names(layout.children ?? []);
}

/** Routes that need a login (the group rendered by `RequireAuth`). */
function protectedRouteNames(enabledProducts: string[]): (string | undefined)[] {
  const [layout] = buildAppRoutes(enabledProducts).routes;
  return names(layout.children?.find((route) => route.children)?.children ?? []);
}

describe('buildAppRoutes', () => {
  it('adds the route and the menu item of an enabled product', () => {
    expect(routeNames(['wallet'])).toEqual(['index', '/wallet', 'login', 'signup', '*']);
    expect(buildAppRoutes(['wallet']).menuItems).toEqual([
      { path: '/', label: 'Home' },
      { path: '/wallet', label: 'Wallet' },
    ]);
  });

  it('has no route and no menu item for a product that is not enabled', () => {
    expect(routeNames([])).toEqual(['index', 'login', 'signup', '*']);
    expect(buildAppRoutes([]).menuItems).toEqual([{ path: '/', label: 'Home' }]);
  });

  it('ignores products the app does not know yet', () => {
    expect(routeNames(['cards', 'wallet'])).toEqual(routeNames(['wallet']));
    expect(buildAppRoutes(['cards', 'wallet']).menuItems).toEqual(
      buildAppRoutes(['wallet']).menuItems,
    );
  });

  it('puts home and every product behind the login; login, sign-up and not-found stay public', () => {
    expect(protectedRouteNames(['wallet'])).toEqual(['index', '/wallet']);
  });
});
