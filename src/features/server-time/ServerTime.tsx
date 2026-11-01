import { Chip, Stack, Typography } from '@mui/material';
import { useServerTime } from './useServerTime';

/** Live server time from the rates-service `serverTime` subscription (websocket). */
export function ServerTime() {
  const { status, value, error } = useServerTime();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography>Server time (rates-service, live):</Typography>
      {status === 'live' && <Chip color="success" label={value} data-testid="server-time" />}
      {status === 'idle' && <Chip label="connecting…" />}
      {status === 'error' && <Chip color="error" label={error} />}
    </Stack>
  );
}
