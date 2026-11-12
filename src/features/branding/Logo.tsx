import { Box } from '@mui/material';
import { brand } from '../../brand/brand';

export function Logo({ height = 32 }: { height?: number }) {
  return (
    <Box
      component="img"
      src={brand.logoUrl}
      alt={brand.siteName}
      sx={{ height, display: 'block' }}
    />
  );
}
