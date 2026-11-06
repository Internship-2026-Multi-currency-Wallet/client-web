import { Card, CardContent, Link, Stack, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router';
import { useAppSelector } from '../app/store';
import { useRegisterMutation } from '../features/auth/authApi';
import { describeRegisterError } from '../features/auth/authErrors';
import { selectUser } from '../features/auth/authSlice';
import { SignUpForm } from '../features/auth/SignUpForm';

export function SignUpPage() {
  const [register, { isLoading, error, reset }] = useRegisterMutation();
  const user = useAppSelector(selectUser);
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // SPA navigation does not move focus: put it on the new page's heading (Tab then reaches the form).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (user) return <Navigate to="/" replace />;

  const view = error ? describeRegisterError(error) : null;

  return (
    <Stack spacing={3} sx={{ maxWidth: 480, mx: 'auto' }}>
      <Typography
        variant="h4"
        component="h1"
        ref={headingRef}
        tabIndex={-1}
        sx={{ outline: 'none' }}
      >
        Create account
      </Typography>
      <Card>
        <CardContent>
          <SignUpForm
            onSubmit={async (input) => {
              // register creates the account only; the user logs in on the next screen.
              if ((await register(input)).data) {
                void navigate('/login', { replace: true, state: { registered: true } });
              }
            }}
            isSubmitting={isLoading}
            serverError={view?.formError}
            fieldErrors={view?.fieldErrors}
            onEdit={reset}
          />
        </CardContent>
      </Card>
      <Typography variant="body2" color="text.secondary">
        Already have an account?{' '}
        <Link component={RouterLink} to="/login">
          Log in
        </Link>
      </Typography>
    </Stack>
  );
}
