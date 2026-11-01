import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet } from 'react-router';
import { config } from '../config-env';

export function AppLayout() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Wallet
          </Typography>
          {config.useMocks && <Chip label="mocks" color="warning" size="small" sx={{ mr: 1 }} />}
          <Chip label={`client: ${config.client}`} size="small" sx={{ mr: 2, color: 'inherit' }} />
          <Button color="inherit" component={RouterLink} to="/">
            Home
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
