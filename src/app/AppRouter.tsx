import { useMemo } from 'react';
import { createBrowserRouter, type RouteObject, RouterProvider } from 'react-router';
import { useClientSetting } from '../features/settings/useClientSetting';
import { buildAppRoutes } from './routes';

type CreateRouter = (routes: RouteObject[]) => ReturnType<typeof createBrowserRouter>;

/** Routes depend on `products.enabled`, so the router is created only under `SettingsGate`. */
export function AppRouter({ createRouter = createBrowserRouter }: { createRouter?: CreateRouter }) {
  const products = useClientSetting('products.enabled');
  // RTK Query preserves array identity when the settings data is unchanged.
  const router = useMemo(
    () => createRouter(buildAppRoutes(products).routes),
    [createRouter, products],
  );
  return <RouterProvider router={router} />;
}
