import { Box, CircularProgress, Typography } from '@mui/material';

export function FullPageLoader({ label }: { label: string }) {
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
      <Typography>{label}</Typography>
    </Box>
  );
}
