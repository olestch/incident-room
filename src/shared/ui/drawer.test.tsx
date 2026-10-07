import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { Drawer } from './drawer';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

it('closing a drawer restores its opener without remounting stateful content', () => {
  const mounted = vi.fn(),
    disposed = vi.fn();
  function Content() {
    useEffect(() => {
      mounted();
      return disposed;
    }, []);
    return <input aria-label="Local draft" defaultValue="Retained input" />;
  }
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const { rerender, unmount } = render(
    <Drawer open close={() => {}} title="Utility">
      <Content />
    </Drawer>,
  );
  rerender(
    <Drawer open={false} close={() => {}} title="Utility">
      <Content />
    </Drawer>,
  );
  expect(opener).toHaveFocus();
  expect(screen.getByLabelText('Local draft')).toHaveValue('Retained input');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(disposed).not.toHaveBeenCalled();
  unmount();
  opener.remove();
});

it('Escape cancellation is controlled and delegates to the owner', () => {
  const close = vi.fn();
  render(
    <Drawer open close={close} title="Utility">
      Tools
    </Drawer>,
  );
  const event = new Event('cancel', { bubbles: true, cancelable: true });
  fireEvent(screen.getByRole('dialog'), event);
  expect(close).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

it('only a backdrop click, not a content click, asks the owner to close', () => {
  const close = vi.fn();
  render(
    <Drawer open close={close} title="Utility">
      <button>Operation</button>
    </Drawer>,
  );
  const dialog = screen.getByRole('dialog');
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 0,
    right: 400,
    bottom: 600,
    x: 100,
    y: 0,
    width: 300,
    height: 600,
    toJSON() {},
  });
  fireEvent.click(screen.getByRole('button', { name: 'Operation' }), {
    clientX: 200,
    clientY: 200,
  });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(dialog, { clientX: 50, clientY: 200 });
  expect(close).toHaveBeenCalledTimes(1);
});
