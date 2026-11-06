import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout, type MenuItem } from '../layout/AppLayout';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { WalletPage } from '../pages/WalletPage';

interface Product extends MenuItem {
  element: ReactNode;
}

const PRODUCTS: Record<string, Product> = {
  wallet: { path: '/wallet', label: 'Wallet', element: <WalletPage /> },
};

const HOME: MenuItem = { path: '/', label: 'Home' };

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
          { index: true, element: <HomePage /> },
          ...products.map(({ path, element }) => ({ path, element })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  };
}
