import { act, render, screen, waitFor } from '@testing-library/react';
import { PasswordStrength } from './PasswordStrength';
import { loadPasswordEstimator, type PasswordEstimate } from './passwordStrength';

vi.mock('./passwordStrength', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./passwordStrength')>()),
  loadPasswordEstimator: vi.fn(),
}));

const estimate = vi.fn<(password: string) => PasswordEstimate>();
const result = (
  score: PasswordEstimate['score'] = 2,
  warning: string | null = null,
  suggestions: string[] = [],
): PasswordEstimate => ({
  score,
  feedback: { warning, suggestions },
});

beforeEach(() => {
  estimate.mockReset().mockReturnValue(result());
  vi.mocked(loadPasswordEstimator).mockReset().mockResolvedValue(estimate);
});

it.each([
  [0, 'Very weak'],
  [1, 'Weak'],
  [2, 'Moderate'],
  [3, 'Good'],
  [4, 'Strong'],
] as const)('maps score %i to %s and the corresponding segments', async (score, label) => {
  estimate.mockReturnValue(result(score));
  render(<PasswordStrength id="strength" password="Password1!" />);
  const meter = await screen.findByRole('meter', { name: 'Password strength' });
  expect(meter).toHaveAttribute('aria-valuenow', String(score));
  expect(meter).toHaveAttribute('aria-valuetext', label);
  expect(screen.getByText(`Password strength: ${label}`)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Estimator credits' })).not.toBeInTheDocument();
  expect(meter.children).toHaveLength(5);
  const activeColor = getComputedStyle(meter.children[0]).backgroundColor;
  expect(
    Array.from(meter.children).filter(
      (segment) => getComputedStyle(segment).backgroundColor === activeColor,
    ),
  ).toHaveLength(score + 1);
});

it.each([
  ['A common pattern.', ['Try more words.'], 'A common pattern.'],
  [null, ['Try more words.', 'Another suggestion.'], 'Try more words.'],
])('shows a warning or the first useful suggestion', async (warning, suggestions, expected) => {
  estimate.mockReturnValue(result(1, warning, suggestions));
  render(<PasswordStrength id="strength" password="Password1!" />);
  expect(await screen.findByText(expected)).toBeInTheDocument();
  expect(screen.queryByText('Another suggestion.')).not.toBeInTheDocument();
});

it('hides a previous estimate immediately when the input changes', async () => {
  const { rerender } = render(<PasswordStrength id="strength" password="first" />);
  await screen.findByText('Password strength: Moderate');
  estimate.mockReturnValue(result(3));
  rerender(<PasswordStrength id="strength" password="second" />);
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.getByText('Estimating password strength…')).toBeInTheDocument();
  await screen.findByText('Password strength: Good');
  expect(estimate).toHaveBeenLastCalledWith('second');
});

it('ignores an older pending load and estimates only the latest password', async () => {
  let resolveOld!: (value: typeof estimate) => void;
  vi.mocked(loadPasswordEstimator).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const { rerender } = render(<PasswordStrength id="strength" password="old" />);
  await waitFor(() => expect(loadPasswordEstimator).toHaveBeenCalledOnce());
  rerender(<PasswordStrength id="strength" password="new" />);
  await screen.findByText('Password strength: Moderate');
  await act(async () => resolveOld(estimate));
  expect(estimate).toHaveBeenCalledExactlyOnceWith('new');
});

it('hides empty input and skips over-limit estimation without truncating', async () => {
  const { rerender } = render(<PasswordStrength id="strength" password="" />);
  expect(screen.queryByText(/strength/i)).not.toBeInTheDocument();
  expect(loadPasswordEstimator).not.toHaveBeenCalled();
  rerender(<PasswordStrength id="strength" password={'a'.repeat(129)} />);
  expect(screen.getByText(/Password strength unavailable/)).toHaveTextContent(
    'Use at most 128 characters',
  );
  expect(loadPasswordEstimator).not.toHaveBeenCalled();
  rerender(<PasswordStrength id="strength" password="short" />);
  await screen.findByRole('meter');
});

it('cancels estimation while typing and when unmounted', async () => {
  const { rerender, unmount } = render(<PasswordStrength id="strength" password="first" />);
  rerender(<PasswordStrength id="strength" password="second" />);
  await screen.findByRole('meter');
  expect(estimate).toHaveBeenCalledExactlyOnceWith('second');
  rerender(<PasswordStrength id="strength" password="third" />);
  unmount();
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(estimate).toHaveBeenCalledOnce();
});
