'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, InlineAlert } from './primitives';

export type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** Native modality with the safe action focused first; independent of Drawer. */
export function ConfirmationDialog({
  open,
  cancel,
  confirm,
  busy = false,
  error,
  ...content
}: Confirmation & {
  open: boolean;
  cancel(): void;
  confirm(): void;
  busy?: boolean;
  error?: string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const title = useId(),
    description = useId();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    safeAction.current?.focus();
    return () => {
      element.close();
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        (!document.querySelector('dialog[open]') || opener.closest('dialog[open]'))
      )
        opener.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="ui-confirmation"
      aria-labelledby={title}
      aria-describedby={description}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) cancel();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          cancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id={title} className="type-section">
        {content.title}
      </h2>
      <p id={description}>{content.description}</p>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="ui-confirmation-actions">
        <Button ref={safeAction} disabled={busy} onClick={cancel}>
          {content.cancelLabel ?? 'Cancel'}
        </Button>
        <Button
          variant={content.destructive ? 'danger' : 'primary'}
          disabled={busy}
          onClick={confirm}
        >
          {busy ? 'Working…' : content.confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

/** One outstanding local decision; unmount resolves it as cancelled. */
export function useConfirmation() {
  const [content, setContent] = useState<Confirmation | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      resolve.current?.(false);
      resolve.current = null;
    },
    [],
  );
  const request = useCallback((next: Confirmation) => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>((done) => {
      resolve.current = done;
      setContent(next);
    });
  }, []);
  const finish = (value: boolean) => {
    const done = resolve.current;
    resolve.current = null;
    setContent(null);
    done?.(value);
  };
  return {
    request,
    dialog: content ? (
      <ConfirmationDialog
        {...content}
        open
        cancel={() => finish(false)}
        confirm={() => finish(true)}
      />
    ) : null,
  };
}
