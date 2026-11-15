import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { mockGoogleCode } from '../mocks/google-handlers';

export function MockGooglePage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('demo.google@example.com');
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state');
  const validRedirect =
    state !== null && URL.canParse(redirectUri) && new URL(redirectUri).origin === location.origin;

  const back = (result: Record<string, string>) => {
    const url = new URL(redirectUri);
    url.search = new URLSearchParams({ state: state ?? '', ...result }).toString();
    location.replace(url.toString());
  };

  return (
    <Card sx={{ maxWidth: 420, mx: 'auto', mt: 4 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Mock Google sign-in
          </Typography>
          {validRedirect ? (
            <>
              <Typography variant="body2" color="text.secondary">
                No real Google here. An email starting with "unverified" is an unverified Google
                account.
              </Typography>
              <TextField
                label="Google email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button variant="contained" onClick={() => back({ code: mockGoogleCode(email) })}>
                Continue
              </Button>
              <Button onClick={() => back({ error: 'access_denied' })}>Cancel</Button>
            </>
          ) : (
            <Alert severity="error">Missing state or an unknown redirect_uri.</Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
