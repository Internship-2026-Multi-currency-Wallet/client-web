import { Box, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import {
  canEstimatePassword,
  loadPasswordEstimator,
  type PasswordEstimate,
} from './passwordStrength';
import { PASSWORD_MAX_LENGTH } from './validation';

const LEVELS = [
  { label: 'Very weak', color: 'error.main' },
  { label: 'Weak', color: 'error.main' },
  { label: 'Moderate', color: 'warning.main' },
  { label: 'Good', color: 'info.main' },
  { label: 'Strong', color: 'success.main' },
] as const;

export function PasswordStrength({ password, id }: { password: string; id: string }) {
  const [result, setResult] = useState<{ password: string; estimate?: PasswordEstimate }>();
  const withinLimit = canEstimatePassword(password);

  useEffect(() => {
    if (!password || !withinLimit) return;
    let active = true;
    // Wait for a pause in typing before loading or doing synchronous estimation.
    const timer = setTimeout(() => {
      void loadPasswordEstimator()
        .then((estimate) => {
          if (active) setResult({ password, estimate: estimate(password) });
        })
        .catch(() => {
          if (active) setResult({ password });
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [password, withinLimit]);

  if (!password) return null;
  // Hide a previous result in the very render where the input changes.
  const current = result?.password === password ? result : undefined;
  const estimate = current?.estimate;
  const level = estimate && LEVELS[estimate.score];
  const feedback = estimate?.feedback.warning || estimate?.feedback.suggestions[0];

  return (
    <Stack id={id} spacing={0.5} aria-live="polite" sx={{ minWidth: 0 }}>
      {level && estimate ? (
        <>
          <Box
            role="meter"
            aria-label="Password strength"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={estimate.score}
            aria-valuetext={level.label}
            sx={{ display: 'flex', gap: 0.5 }}
          >
            {LEVELS.map((segment, index) => (
              <Box
                key={segment.label}
                aria-hidden="true"
                sx={{
                  flex: 1,
                  height: 6,
                  borderRadius: 1,
                  bgcolor: index <= estimate.score ? level.color : 'action.disabledBackground',
                }}
              />
            ))}
          </Box>
          <Typography variant="body2">Password strength: {level.label}</Typography>
          {feedback && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {feedback}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {!withinLimit || current
            ? 'Password strength unavailable'
            : 'Estimating password strength…'}
          {!withinLimit && ` Use at most ${PASSWORD_MAX_LENGTH} characters to see an estimate.`}
        </Typography>
      )}
    </Stack>
  );
}
