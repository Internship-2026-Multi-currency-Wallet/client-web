import { Box, CircularProgress, Typography } from '@mui/material';

/** Full-screen spinner with a label; the colours come from the brand theme. */
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
