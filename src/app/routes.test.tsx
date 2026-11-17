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

/** Routes without children: the pages. */
const pages = (routes: RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => (route.children ? pages(route.children) : [route]));

/** Routes that need a login (the group rendered by `RequireAuth`). */
function protectedRouteNames(enabledProducts: string[]): (string | undefined)[] {
  const [layout] = buildAppRoutes(enabledProducts).routes;
  return names(layout.children?.find((route) => route.children)?.children ?? []);
}

describe('buildAppRoutes', () => {
  it('adds the route and the menu item of an enabled product', () => {
    expect(routeNames(['wallet'])).toEqual(['index', 'account', '/wallet', 'login', 'signup', '*']);
    expect(buildAppRoutes(['wallet']).menuItems).toEqual([
      { path: '/', label: 'Home' },
      { path: '/wallet', label: 'Wallet' },
    ]);
  });

  it('has no route and no menu item for a product that is not enabled', () => {
    expect(routeNames([])).toEqual(['index', 'account', 'login', 'signup', '*']);
    expect(buildAppRoutes([]).menuItems).toEqual([{ path: '/', label: 'Home' }]);
  });

  it('ignores products the app does not know yet', () => {
    expect(routeNames(['cards', 'wallet'])).toEqual(routeNames(['wallet']));
    expect(buildAppRoutes(['cards', 'wallet']).menuItems).toEqual(
      buildAppRoutes(['wallet']).menuItems,
    );
  });

  it('puts home, account and every product behind the login; login, sign-up and not-found stay public', () => {
    expect(protectedRouteNames(['wallet'])).toEqual(['index', 'account', '/wallet']);
  });

  it('serves the Google callback outside the layout and without a login', () => {
    const [, ...outside] = buildAppRoutes(['wallet']).routes;
    expect(names(outside)).toEqual(['auth/google/callback']);
  });

  it('loads every page lazily, so each page is its own chunk', () => {
    for (const page of pages(buildAppRoutes(['wallet']).routes)) {
      expect(page.element).toBeUndefined();
      expect(page.lazy).toEqual(expect.any(Function));
    }
  });

  it('loads the page component of a product', async () => {
    const wallet = pages(buildAppRoutes(['wallet']).routes).find((r) => r.path === '/wallet');
    const { WalletPage } = await import('../pages/WalletPage');
    expect(await (wallet?.lazy as () => Promise<unknown>)()).toEqual({ Component: WalletPage });
  });

  it('shows a loader while the first page loads', () => {
    const [layout] = buildAppRoutes([]).routes;
    expect(layout.hydrateFallbackElement).toBeTruthy();
  });
});
