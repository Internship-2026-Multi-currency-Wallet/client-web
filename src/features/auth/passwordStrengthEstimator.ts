import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as englishDictionary, translations } from '@zxcvbn-ts/language-en';
import { canEstimatePassword, type PasswordEstimate } from './passwordStrength';
import { PASSWORD_MAX_LENGTH } from './validation';

const estimator = new ZxcvbnFactory({
  dictionary: { ...commonDictionary, ...englishDictionary },
  graphs: adjacencyGraphs,
  translations,
  // Wallet counts code points; zxcvbn's internal limit counts UTF-16 units.
  maxLength: PASSWORD_MAX_LENGTH * 2,
});

export function estimatePassword(password: string): PasswordEstimate {
  if (!canEstimatePassword(password)) throw new Error('Password exceeds estimator limit');
  const { score, feedback } = estimator.check(password);
  return { score, feedback };
}
