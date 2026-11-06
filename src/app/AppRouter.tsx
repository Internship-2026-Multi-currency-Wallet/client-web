import { useMemo } from 'react';
import { createBrowserRouter, type RouteObject, RouterProvider } from 'react-router';
import { useClientSetting } from '../features/settings/useClientSetting';
import { buildAppRoutes } from './routes';

type CreateRouter = (routes: RouteObject[]) => ReturnType<typeof createBrowserRouter>;

/**
 * Creates the router under `SettingsGate`: the routes depend on `products.enabled`, which is
 * known only once the settings have loaded. Tests pass a memory router instead of the browser one.
 */
export function AppRouter({ createRouter = createBrowserRouter }: { createRouter?: CreateRouter }) {
  const products = useClientSetting('products.enabled');
  // Rebuilt only when the product list changes; RTK Query keeps the same array for equal data.
  const router = useMemo(
    () => createRouter(buildAppRoutes(products).routes),
    [createRouter, products],
  );
  return <RouterProvider router={router} />;
}
