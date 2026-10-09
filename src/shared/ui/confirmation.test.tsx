import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationDialog, useConfirmation } from './confirmation';
const content = {
  title: 'Discard incident draft?',
  description: 'This incident has not been created. Closing discards entered fields.',
  confirmLabel: 'Discard changes',
  cancelLabel: 'Keep editing',
  destructive: true,
};
it('names the consequence, focuses the safe action, resolves either decision and restores its opener', async () => {
  const decision = vi.fn();
  function Host() {
    const confirmation = useConfirmation();
    return (
      <>
        <button onClick={() => void confirmation.request(content).then(decision)}>
          Close draft
        </button>
        {confirmation.dialog}
      </>
    );
  }
  render(<Host />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Close draft' }));
  expect(screen.getByRole('dialog')).toHaveAccessibleName(content.title);
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(content.description);
  expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(decision).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('button', { name: 'Close draft' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Close draft' }));
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(decision).toHaveBeenLastCalledWith(true);
});
it('Escape/backdrop cancel safely, and busy operations cannot be dismissed or submitted twice', () => {
  const cancel = vi.fn(),
    confirm = vi.fn();
  const view = render(<ConfirmationDialog {...content} open cancel={cancel} confirm={confirm} />);
  const dialog = screen.getByRole('dialog');
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  fireEvent.click(dialog, { clientX: -1, clientY: -1 });
  expect(cancel).toHaveBeenCalledTimes(2);
  view.rerender(
    <ConfirmationDialog
      {...content}
      open
      busy
      error="Storage unavailable; nothing was reset."
      cancel={cancel}
      confirm={confirm}
    />,
  );
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  fireEvent.click(dialog, { clientX: -1, clientY: -1 });
  fireEvent.click(screen.getByRole('button', { name: 'Working…' }));
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(confirm).not.toHaveBeenCalled();
  expect(dialog).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('nothing was reset');
});
it('unmount cancels an outstanding decision without applying destructive work', async () => {
  const result = vi.fn();
  function Host() {
    const c = useConfirmation();
    return (
      <>
        <button onClick={() => void c.request(content).then(result)}>Open</button>
        {c.dialog}
      </>
    );
  }
  const view = render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await act(async () => view.unmount());
  expect(result).toHaveBeenCalledWith(false);
});
