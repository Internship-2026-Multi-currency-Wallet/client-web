import { Alert, Box, Button, Stack } from '@mui/material';
import { describeGoogleLoginError } from './authErrors';
import type { GoogleFlow } from './googleApi';

export interface GoogleLoginButtonProps {
  flow: GoogleFlow;
  disabled?: boolean;
}

export function GoogleLoginButton({ flow, disabled = false }: GoogleLoginButtonProps) {
  return (
    <Stack spacing={2}>
      {flow.error && <Alert severity="error">{describeGoogleLoginError(flow.error)}</Alert>}
      <Button
        variant="outlined"
        onClick={flow.start}
        disabled={disabled || flow.isPending}
        startIcon={
          <Box component="img" src="/icons/google.svg" alt="" sx={{ width: 18, height: 18 }} />
        }
      >
        {flow.isPending ? 'Waiting for Google…' : 'Continue with Google'}
      </Button>
      {flow.isPending && (
        <Button size="small" onClick={flow.cancel}>
          Cancel
        </Button>
      )}
    </Stack>
  );
}
