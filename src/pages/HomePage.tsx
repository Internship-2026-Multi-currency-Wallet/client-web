import { Alert, Card, CardContent, Stack, Typography } from '@mui/material';
import { usePageTitle } from '../features/branding/usePageTitle';
import { useMeQuery, useWalletCoreHealthQuery } from '../features/system/systemApi';
import { ServerTime } from '../features/server-time/ServerTime';

export function HomePage() {
  usePageTitle('Home');
  const health = useWalletCoreHealthQuery();
  const me = useMeQuery();

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Welcome
      </Typography>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            {health.data && (
              <Typography data-testid="health">
                Connected to wallet-core: {health.data.service} {health.data.version} (client{' '}
                {health.data.client}, db {health.data.db}, redis {health.data.redis})
              </Typography>
            )}
            {health.isLoading && <Typography>Connecting to wallet-core…</Typography>}
            {health.error && (
              <Alert severity="error">wallet-core is not reachable: {health.error.message}</Alert>
            )}

            {me.data && (
              <Typography data-testid="me">
                {me.data.strategy === 'dev' ? 'Dev user' : 'Authenticated user'}: {me.data.id}{' '}
                (permissions: {me.data.permissions.join(', ') || 'none'})
              </Typography>
            )}
            {me.error && (
              <Alert severity="error">Could not load your account: {me.error.message}</Alert>
            )}

            <ServerTime />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
