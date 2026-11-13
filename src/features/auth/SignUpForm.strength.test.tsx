import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from './SignUpForm';
import { loadPasswordEstimator } from './passwordStrength';
import { newPasswordSchema } from './validation';

vi.mock('./passwordStrength', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./passwordStrength')>()),
  loadPasswordEstimator: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(loadPasswordEstimator)
    .mockReset()
    .mockResolvedValue(() => ({
      score: 0,
      feedback: { warning: 'A common pattern.', suggestions: [] },
    }));
});

it('shows strength only after submit, preserves descriptions and hides it for empty input', async () => {
  const onSubmit = vi.fn();
  render(<SignUpForm onSubmit={onSubmit} />);
  const password = screen.getByLabelText(/^password/i);
  fireEvent.change(password, { target: { value: 'password' } });
  expect(screen.queryByText(/strength/i)).not.toBeInTheDocument();
  expect(loadPasswordEstimator).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  const checklist = screen.getByRole('list', { name: 'Requirements for password' });
  const strength = checklist.nextElementSibling!;
  expect(strength).toHaveTextContent('Estimating password strength…');
  expect(password.getAttribute('aria-describedby')?.split(' ')).toEqual([
    `${password.id}-helper-text`,
    checklist.id,
    strength.id,
  ]);
  await screen.findByRole('meter');
  expect(password).toHaveAccessibleDescription(/Password strength: Very weak.*A common pattern/);
  expect(password).toBeInvalid();
  expect(screen.getByLabelText(/^email/i)).toHaveFocus();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(password, { target: { value: '' } });
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(password.getAttribute('aria-describedby')?.split(' ')).not.toContain(strength.id);
});

it.each(['loading', 'failed', 'weak'])('preserves signup while strength is %s', async (state) => {
  if (state === 'loading') vi.mocked(loadPasswordEstimator).mockReturnValue(new Promise(() => {}));
  if (state === 'failed')
    vi.mocked(loadPasswordEstimator).mockRejectedValue(new Error('Chunk unavailable'));
  expect(newPasswordSchema.safeParse('Password1!').success).toBe(true);
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<SignUpForm onSubmit={onSubmit} />);
  await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');
  const password = screen.getByLabelText(/^password/i);
  await userEvent.type(password, 'Password1!');
  const submit = screen.getByRole('button', { name: 'Sign up' });
  await userEvent.click(submit);
  const expected =
    state === 'failed'
      ? 'Password strength unavailable'
      : state === 'weak'
        ? 'Password strength: Very weak'
        : 'Estimating password strength…';
  await screen.findByText(expected);
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      email: 'user@example.com',
      password: 'Password1!',
    }),
  );
  expect(password).toHaveAttribute('aria-invalid', 'false');
  expect(submit).toBeEnabled();
});
