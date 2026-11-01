import { Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

export function NotFoundPage() {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="h4" component="h1">
        Page not found
      </Typography>
      <Typography color="text.secondary">The page you are looking for does not exist.</Typography>
      <Button variant="contained" component={RouterLink} to="/">
        Go home
      </Button>
    </Stack>
  );
}
