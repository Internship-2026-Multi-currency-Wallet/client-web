import type { ZxcvbnResult } from '@zxcvbn-ts/core';
import { PASSWORD_MAX_LENGTH } from './validation';

export type PasswordEstimate = Pick<ZxcvbnResult, 'score' | 'feedback'>;
type Estimator = (password: string) => PasswordEstimate;

export function canEstimatePassword(password: string) {
  return (
    password.length <= PASSWORD_MAX_LENGTH * 2 && Array.from(password).length <= PASSWORD_MAX_LENGTH
  );
}

let estimator: Promise<Estimator> | undefined;

export function loadPasswordEstimator(): Promise<Estimator> {
  return (estimator ??= import('./passwordStrengthEstimator').then(
    (module) => module.estimatePassword,
  ));
}
