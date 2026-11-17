import type { RouteObject } from 'react-router';
import { config } from '../config-env';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AppLayout, type MenuItem } from '../layout/AppLayout';
import { FullPageLoader } from '../layout/FullPageLoader';

interface Product extends MenuItem {
  lazy: RouteObject['lazy'];
}

const PRODUCTS: Record<string, Product> = {
  wallet: {
    path: '/wallet',
    label: 'Wallet',
    lazy: async () => ({ Component: (await import('../pages/WalletPage')).WalletPage }),
  },
};

const HOME: MenuItem = { path: '/', label: 'Home' };

// The literal `import.meta.env` check lets Vite drop the mock page (and MSW) from builds without mocks.
const MOCK_ROUTES: RouteObject[] =
  import.meta.env.VITE_USE_MOCKS === 'true' && config.useMocks
    ? [
        {
          path: 'auth/google/mock',
          lazy: async () => ({
            Component: (await import('../pages/MockGooglePage')).MockGooglePage,
          }),
          HydrateFallback: () => null,
        },
      ]
    : [];

export interface AppRoutes {
  routes: RouteObject[];
  menuItems: MenuItem[];
}

/** Ignores unknown products, so the backend can add one before this app supports it. */
export function buildAppRoutes(enabledProducts: readonly string[]): AppRoutes {
  const products = Object.entries(PRODUCTS)
    .filter(([name]) => enabledProducts.includes(name))
    .map(([, product]) => product);
  const menuItems = [HOME, ...products.map(({ path, label }) => ({ path, label }))];
  return {
    menuItems,
    routes: [
      {
        element: <AppLayout menuItems={menuItems} />,
        hydrateFallbackElement: <FullPageLoader label="Loading…" />,
        children: [
          {
            element: <RequireAuth />,
            children: [
              {
                index: true,
                lazy: async () => ({ Component: (await import('../pages/HomePage')).HomePage }),
              },
              {
                path: 'account',
                lazy: async () => ({
                  Component: (await import('../pages/AccountPage')).AccountPage,
                }),
              },
              ...products.map(({ path, lazy }) => ({ path, lazy })),
            ],
          },
          {
            path: 'login',
            lazy: async () => ({ Component: (await import('../pages/LoginPage')).LoginPage }),
          },
          {
            path: 'signup',
            lazy: async () => ({ Component: (await import('../pages/SignUpPage')).SignUpPage }),
          },
          {
            path: '*',
            lazy: async () => ({ Component: (await import('../pages/NotFoundPage')).NotFoundPage }),
          },
        ],
      },
      {
        path: 'auth/google/callback',
        lazy: async () => ({
          Component: (await import('../pages/GoogleCallbackPage')).GoogleCallbackPage,
        }),
        HydrateFallback: () => null,
      },
      ...MOCK_ROUTES,
    ],
  };
}
