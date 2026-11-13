import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from './SignUpForm';

it('toggles visibility with mouse and keyboard while preserving value, focus and selection', async () => {
  const onSubmit = vi.fn();
  render(<SignUpForm onSubmit={onSubmit} />);
  const password = screen.getByLabelText(/^password/i) as HTMLInputElement;
  expect(password).toHaveAttribute('type', 'password');
  await userEvent.type(password, 'Password1!');
  password.setSelectionRange(2, 8, 'backward');
  const show = screen.getByRole('button', { name: 'Show password' });
  expect(show).toHaveAttribute('type', 'button');
  await userEvent.click(show);
  expect(password).toHaveAttribute('type', 'text');
  expect(password).toHaveValue('Password1!');
  expect(password).toHaveFocus();
  expect([password.selectionStart, password.selectionEnd, password.selectionDirection]).toEqual([
    2,
    8,
    'backward',
  ]);

  password.setSelectionRange(0, 3, 'forward');
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(password).toHaveAttribute('type', 'password');
  expect(password).toHaveValue('Password1!');
  expect(password).toHaveFocus();
  expect([password.selectionStart, password.selectionEnd, password.selectionDirection]).toEqual([
    0,
    3,
    'forward',
  ]);
  expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Requirements for password' })).not.toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

it('does not accidentally submit a valid form or change its submitted password', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<SignUpForm onSubmit={onSubmit} />);
  await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');
  await userEvent.type(screen.getByLabelText(/^password/i), 'Password1!');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
    email: 'user@example.com',
    password: 'Password1!',
  });
});

it.each([false, true])(
  'disables the visibility toggle during submission (visible: %s)',
  async (visible) => {
    const onSubmit = vi.fn();
    const { rerender } = render(<SignUpForm onSubmit={onSubmit} />);
    const password = screen.getByLabelText(/^password/i);
    await userEvent.type(password, 'Password1!');
    if (visible) await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    rerender(<SignUpForm onSubmit={onSubmit} isSubmitting />);
    const toggle = screen.getByRole('button', {
      name: visible ? 'Hide password' : 'Show password',
    });
    expect(password).toBeDisabled();
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(password).toHaveAttribute('type', visible ? 'text' : 'password');
    expect(password).toHaveValue('Password1!');
    expect(onSubmit).not.toHaveBeenCalled();
  },
);
