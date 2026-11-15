import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { config } from '../config-env';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AppLayout, type MenuItem } from '../layout/AppLayout';
import { AccountPage } from '../pages/AccountPage';
import { GoogleCallbackPage } from '../pages/GoogleCallbackPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SignUpPage } from '../pages/SignUpPage';
import { WalletPage } from '../pages/WalletPage';

interface Product extends MenuItem {
  element: ReactNode;
}

const PRODUCTS: Record<string, Product> = {
  wallet: { path: '/wallet', label: 'Wallet', element: <WalletPage /> },
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
        children: [
          {
            element: <RequireAuth />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'account', element: <AccountPage /> },
              ...products.map(({ path, element }) => ({ path, element })),
            ],
          },
          { path: 'login', element: <LoginPage /> },
          { path: 'signup', element: <SignUpPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      // The Google sign-in popup: no app chrome.
      { path: 'auth/google/callback', element: <GoogleCallbackPage /> },
      ...MOCK_ROUTES,
    ],
  };
}
