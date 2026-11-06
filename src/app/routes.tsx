import type { RouteObject } from 'react-router';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AppLayout } from '../layout/AppLayout';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { SignUpPage } from '../pages/SignUpPage';

/** Route table. Features add their routes here (shared file — small PRs). */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      // Wallet pages: only for a signed-in user.
      { element: <RequireAuth />, children: [{ index: true, element: <HomePage /> }] },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignUpPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
