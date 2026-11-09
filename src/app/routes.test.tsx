import { buildAppRoutes } from './routes';

/** Child routes of the layout as readable names: `index` for `/`, otherwise the path. */
function routeNames(enabledProducts: string[]): (string | undefined)[] {
  const [layout] = buildAppRoutes(enabledProducts).routes;
  return (layout.children ?? []).map((route) => (route.index ? 'index' : route.path));
}

describe('buildAppRoutes', () => {
  it('adds the route and the menu item of an enabled product', () => {
    expect(routeNames(['wallet'])).toEqual(['index', '/wallet', '*']);
    expect(buildAppRoutes(['wallet']).menuItems).toEqual([
      { path: '/', label: 'Home' },
      { path: '/wallet', label: 'Wallet' },
    ]);
  });

  it('has no route and no menu item for a product that is not enabled', () => {
    expect(routeNames([])).toEqual(['index', '*']);
    expect(buildAppRoutes([]).menuItems).toEqual([{ path: '/', label: 'Home' }]);
  });

  it('ignores products the app does not know yet', () => {
    expect(routeNames(['cards', 'wallet'])).toEqual(routeNames(['wallet']));
    expect(buildAppRoutes(['cards', 'wallet']).menuItems).toEqual(
      buildAppRoutes(['wallet']).menuItems,
    );
  });
});
