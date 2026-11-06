import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { Link as RouterLink, Navigate, Outlet, useLocation } from 'react-router';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { restoreSession, selectAuthStatus, selectUser } from './authSlice';

/**
 * Layout route: renders the nested routes only for a signed-in user. Stored data is not trusted: while an expired
 * session is being renewed nothing private is shown, and a transient failure offers Retry instead of a logout. A
 * browser without Web Locks cannot renew at all, so it gets an explanation and a login, not a Retry.
 */
export function RequireAuth() {
  const status = useAppSelector(selectAuthStatus);
  const user = useAppSelector(selectUser);
  const dispatch = useAppDispatch();
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
  if (status === 'unavailable') {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Alert severity="warning">
          We could not reach the server to restore your session. You are still signed in on this
          device.
        </Alert>
        <Button variant="contained" onClick={() => void dispatch(restoreSession())}>
          Retry
        </Button>
      </Stack>
    );
  }
  if (status === 'unsupported') {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Alert severity="warning">
          Your session has expired and this browser cannot renew it safely: it does not support the
          Web Locks API (a current browser on https or localhost is required). Log in again to
          continue; without it, you will have to log in again every time the session expires.
        </Alert>
        <Button
          variant="contained"
          component={RouterLink}
          to="/login"
          state={{ from: location.pathname + location.search }}
        >
          Log in
        </Button>
      </Stack>
    );
  }
  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // Keyed by user: another identity (e.g. a login in another tab) remounts the page, so nothing of the
  // previous user stays on screen.
  return <Outlet key={user.id} />;
}
