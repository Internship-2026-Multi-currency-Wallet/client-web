import { Box, Typography } from '@mui/material';
import visuallyHidden from '@mui/utils/visuallyHidden';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_DIGIT_PATTERN,
  PASSWORD_UPPERCASE_PATTERN,
  PASSWORD_SPECIAL_PATTERN,
} from './validation';

export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  const length = Array.from(password).length;
  const checks = [
    {
      label: `${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
      met: length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH,
    },
    { label: 'At least one digit (0-9)', met: PASSWORD_DIGIT_PATTERN.test(password) },
    { label: 'At least one uppercase letter', met: PASSWORD_UPPERCASE_PATTERN.test(password) },
    { label: 'At least one special character', met: PASSWORD_SPECIAL_PATTERN.test(password) },
  ];

  return (
    <Box
      component="ul"
      id={id}
      aria-label="Requirements for password"
      sx={{ m: 0, pl: 0, listStyle: 'none' }}
    >
      {checks.map(({ label, met }) => (
        <Typography
          component="li"
          variant="body2"
          key={label}
          sx={{ display: 'flex', gap: 1, color: met ? 'success.main' : 'text.secondary' }}
        >
          <Box component="span" aria-hidden="true" sx={{ flexShrink: 0 }}>
            {met ? '✓' : '×'}
          </Box>
          <span>
            {label}
            <Box component="span" sx={visuallyHidden}>
              : {met ? 'Met' : 'Not met'}
            </Box>
          </span>
        </Typography>
      ))}
    </Box>
  );
}
