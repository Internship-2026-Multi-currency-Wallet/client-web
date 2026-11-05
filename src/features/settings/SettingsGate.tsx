import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { usePublicSettingsQuery } from './settingsApi';

/**
 * Renders `children` only once the public settings are loaded and valid.
 * Before that: a loading state, or an error with Retry. Once loaded, a failed background
 * refetch keeps the app (RTK Query keeps the last good data).
 */
export function SettingsGate({ children }: { children: ReactNode }) {
  const { data, isError, refetch } = usePublicSettingsQuery();

  if (data) return children;

  if (isError) {
    return (
      <Stack
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'center', minHeight: '100vh', p: 3 }}
      >
        <Alert severity="error">
          <Typography>Could not load the app settings.</Typography>
          <Typography variant="body2">Please check your connection and try again.</Typography>
        </Alert>
        <Button variant="contained" onClick={() => void refetch()}>
          Retry
        </Button>
      </Stack>
    );
  }

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: '100vh',
      }}
    >
      <CircularProgress size={24} aria-hidden />
      <Typography>Loading settings…</Typography>
    </Box>
  );
}
