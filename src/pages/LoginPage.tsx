import { Alert, Card, CardContent, Link, Stack, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';
import { Link as RouterLink, Navigate, useLocation } from 'react-router';
import { useAppSelector } from '../app/store';
import { selectAuthStatus, selectUser } from '../features/auth/authSlice';
import { describeLoginError } from '../features/auth/authErrors';
import { useLoginMutation } from '../features/auth/authApi';
import { LoginForm } from '../features/auth/LoginForm';

interface LoginLocationState {
  /** Where RequireAuth came from: go back there after login. */
  from?: string;
  /** Set by the sign-up page. */
  registered?: boolean;
}

/** Only in-app paths; anything else falls back to the wallet home. */
function safeTarget(from: string | undefined): string {
  return from?.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function LoginPage() {
  const [login, { isLoading, error, reset }] = useLoginMutation();
  const user = useAppSelector(selectUser);
  const restoring = useAppSelector(selectAuthStatus) === 'restoring';
  const state = useLocation().state as LoginLocationState | null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // SPA navigation does not move focus: put it on the new page's heading (Tab then reaches the form).
  useEffect(() => {
    headingRef.current?.focus();
  }, [restoring]);

  // A stored session is being renewed: the form must not flash before the redirect.
  if (restoring) return null;
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
        <Link component={RouterLink} to="/signup" state={{ from: state?.from }}>
          Sign up
        </Link>
      </Typography>
    </Stack>
  );
}
