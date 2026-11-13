import { canEstimatePassword, loadPasswordEstimator } from './passwordStrength';

it('initializes the real library once with dictionaries and English feedback', async () => {
  const pending = loadPasswordEstimator();
  expect(loadPasswordEstimator()).toBe(pending);
  const estimate = await pending;
  const result = estimate('Password1!');
  expect(result.score).toBeLessThanOrEqual(2);
  expect(result.feedback.warning).toMatch(/commonly used password/i);
  expect(result.feedback.suggestions).toContain('Add more words that are less common.');
  expect(estimate('professional').score).toBeLessThanOrEqual(2);
  expect(Object.keys(result).sort()).toEqual(['feedback', 'score']);
});

it('bounds computation to 128 code points and never scores a truncated input', async () => {
  const estimate = await loadPasswordEstimator();
  const maximum = '𐐀'.repeat(126) + '1!';
  expect(canEstimatePassword(maximum)).toBe(true);
  expect(() => estimate(maximum)).not.toThrow();
  expect(canEstimatePassword('a'.repeat(129))).toBe(false);
  expect(() => estimate('a'.repeat(1024))).toThrow('Password exceeds estimator limit');
});
