import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet } from 'react-router';
import { config } from '../config-env';

/** A link in the app header. */
export interface MenuItem {
  path: string;
  label: string;
}

export function AppLayout({ menuItems }: { menuItems: MenuItem[] }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Wallet
          </Typography>
          {config.useMocks && <Chip label="mocks" color="warning" size="small" sx={{ mr: 1 }} />}
          <Chip label={`client: ${config.client}`} size="small" sx={{ mr: 2, color: 'inherit' }} />
          {menuItems.map(({ path, label }) => (
            <Button key={path} color="inherit" component={RouterLink} to={path}>
              {label}
            </Button>
          ))}
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
