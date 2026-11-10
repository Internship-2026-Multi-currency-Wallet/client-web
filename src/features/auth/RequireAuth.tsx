import { Box, CircularProgress, Typography } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAppSelector } from '../../app/store';
import { selectAuthStatus, selectUser } from './authSlice';

/** Layout route: the nested routes are only for a signed-in user. */
export function RequireAuth() {
  const status = useAppSelector(selectAuthStatus);
  const user = useAppSelector(selectUser);
  const location = useLocation();

  if (status === 'restoring') {
    return (
      <Box
        role="status"
        aria-live="polite"
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, py: 8 }}
      >
        <CircularProgress size={24} aria-hidden />
        <Typography>Restoring your session…</Typography>
      </Box>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // Keyed by user: another identity (e.g. a login in another tab) remounts the page.
  return <Outlet key={user.id} />;
}
