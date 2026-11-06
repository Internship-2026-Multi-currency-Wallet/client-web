import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout, type MenuItem } from '../layout/AppLayout';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { WalletPage } from '../pages/WalletPage';

interface Product extends MenuItem {
  element: ReactNode;
}

/**
 * Products this app can show, in menu order. The client setting `products.enabled` picks which
 * of them a client gets, so a product is switched on or off without a code change.
 */
const PRODUCTS: Record<string, Product> = {
  wallet: { path: '/wallet', label: 'Wallet', element: <WalletPage /> },
};

const HOME: MenuItem = { path: '/', label: 'Home' };

export interface AppRoutes {
  routes: RouteObject[];
  menuItems: MenuItem[];
}

/**
 * Routes and header menu for the enabled products, built together so they can never disagree:
 * a product that is not enabled has neither, and its URL falls through to "Page not found".
 * Names the catalog does not know yet are ignored, so the backend can add a product first.
 */
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
          { index: true, element: <HomePage /> },
          ...products.map(({ path, element }) => ({ path, element })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  };
}
