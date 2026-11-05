import { Alert, Card, CardContent, Link, Stack, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';
import { Link as RouterLink, Navigate, useLocation } from 'react-router';
import { useAppSelector } from '../app/store';
import { selectUser } from '../features/auth/authSlice';
import { describeLoginError } from '../features/auth/authErrors';
import { useLoginMutation } from '../features/auth/authApi';
import { LoginForm } from '../features/auth/LoginForm';

interface LoginLocationState {
  /** Where RequireAuth came from: go back there after login. */
  from?: string;
  /** Set by the sign-up page. */
  registered?: boolean;
  /** Set by logout when the server did not confirm that the session was revoked. */
  logout?: 'local-only';
}

/** Only in-app paths; anything else falls back to the wallet home. */
function safeTarget(from: string | undefined): string {
  return from?.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function LoginPage() {
  const [login, { isLoading, error, reset }] = useLoginMutation();
  const user = useAppSelector(selectUser);
  const state = useLocation().state as LoginLocationState | null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // SPA navigation does not move focus: put it on the new page's heading (Tab then reaches the form).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Signed in (just now, or already): leave the login page.
  if (user) return <Navigate to={safeTarget(state?.from)} replace />;

  return (
    <Stack spacing={3} sx={{ maxWidth: 480, mx: 'auto' }}>
      <Typography
        variant="h4"
        component="h1"
        ref={headingRef}
        tabIndex={-1}
        sx={{ outline: 'none' }}
      >
        Log in
      </Typography>
      {state?.logout === 'local-only' && (
        <Alert severity="warning">
          You are logged out on this device, but the server did not confirm that your session was
          ended. On a shared computer, log in and out again once the connection is back.
        </Alert>
      )}
      {state?.registered && <Alert severity="success">Account created. Log in to continue.</Alert>}
      <Card>
        <CardContent>
          <LoginForm
            onSubmit={(input) => void login(input)}
            isSubmitting={isLoading}
            serverError={error ? describeLoginError(error) : null}
            onEdit={reset}
          />
        </CardContent>
      </Card>
      <Typography variant="body2" color="text.secondary">
        Don't have an account?{' '}
        <Link component={RouterLink} to="/signup">
          Sign up
        </Link>
      </Typography>
    </Stack>
  );
}
