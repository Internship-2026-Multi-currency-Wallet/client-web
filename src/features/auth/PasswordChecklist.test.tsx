import { render, screen, within } from '@testing-library/react';
import { PasswordChecklist } from './PasswordChecklist';
import { newPasswordSchema } from './validation';

it.each([
  ['Secret123!', '✓', ': Met'],
  ['Secret!!!', '×', ': Not met'],
])(
  'visually hides the digit status while preserving it for assistive technology (%s)',
  (password, symbol, status) => {
    render(<PasswordChecklist id="requirements" password={password} />);
    const digitRow = screen.getByText('At least one digit (0-9)').closest('li')!;
    expect(within(digitRow).getByText(symbol)).toHaveAttribute('aria-hidden', 'true');
    const statusText = within(digitRow).getByText(status);
    expect(statusText).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    });
    expect(statusText.closest('[aria-hidden="true"]')).toBeNull();
  },
);

// Expected verdicts pin the existing policy independently of the shared patterns.
it.each([
  ['', [false, false, false, false]],
  ['Aa1!aaa', [false, true, true, true]],
  ['Aa1!aaaa', [true, true, true, true]],
  ['Aa1!' + 'a'.repeat(124), [true, true, true, true]],
  ['Aa1!' + 'a'.repeat(125), [false, true, true, true]],
  ['Пароль1!', [true, true, true, true]],
  ['𐐀abcde1!', [true, true, true, true]],
  ['ǅabcdef1!', [true, true, false, true]], // Titlecase is not uppercase (Lu).
  ['Secret٣٣!', [true, false, true, true]],
  ['Secret１２!', [true, false, true, true]],
  ['Secret12', [true, true, true, false]],
  ['Secret1 ', [true, true, true, true]], // Whitespace counts as special.
  ['Secret1\u0301', [true, true, true, true]], // So does a combining mark.
  ['A1!😀aaa', [false, true, true, true]], // Zod counts Unicode code points.
  ['A1!😀aaaa', [true, true, true, true]],
  ['Aa1!' + '😀'.repeat(124), [true, true, true, true]],
  ['Aa1!' + '😀'.repeat(125), [false, true, true, true]],
] as const)('matches the existing policy for case %#', (password, expected) => {
  render(<PasswordChecklist id="requirements" password={password} />);
  const items = within(screen.getByRole('list')).getAllByRole('listitem');
  expected.forEach((met, index) => {
    expect(items[index]).toHaveTextContent(met ? /: Met$/ : /: Not met$/);
  });
  expect(newPasswordSchema.safeParse(password).success).toBe(expected.every(Boolean));
});
