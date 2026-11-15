import { Alert, Box, Button, Stack } from '@mui/material';
import { describeGoogleLoginError } from './authErrors';
import { useGoogleLogin } from './googleApi';

/** Render it only when `useGoogleSignInEnabled()` is true. */
export function GoogleLoginButton() {
  const { start, isPending, error } = useGoogleLogin();

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{describeGoogleLoginError(error)}</Alert>}
      <Button
        variant="outlined"
        onClick={start}
        disabled={isPending}
        // Decorative (alt=""): the accessible name stays "Continue with Google".
        startIcon={
          <Box component="img" src="/icons/google.svg" alt="" sx={{ width: 18, height: 18 }} />
        }
      >
        {isPending ? 'Waiting for Google…' : 'Continue with Google'}
      </Button>
    </Stack>
  );
}
