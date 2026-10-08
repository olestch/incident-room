'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './primitives';
import { createSheetMotion } from './sheet-motion';

/** Content stays mounted while closed; presentation never owns its runtime. */
export function Drawer({
  open,
  close,
  title,
  children,
  side = 'right',
  description,
  immediateClose = false,
}: {
  open: boolean;
  close(): void;
  title: string;
  children: ReactNode;
  side?: 'left' | 'right' | 'bottom';
  description?: string;
  /** Route/modal handoff must not wait for a decorative exit. */
  immediateClose?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useId();
  const help = useId();
  const motion = useRef<ReturnType<typeof createSheetMotion> | null>(null);
  const dismiss = useRef(close);
  useEffect(() => {
    dismiss.current = close;
  }, [close]);
  useEffect(() => {
    if (side !== 'bottom') return;
    const controller = createSheetMotion(
      dialog.current!,
      () => dismiss.current(),
      () => {
        // A newer Thread/modal owns focus during an immediate handoff.
        if (
          !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') &&
          opener.current?.isConnected
        )
          opener.current.focus({ preventScroll: true });
      },
    );
    motion.current = controller;
    return () => {
      controller.dispose();
      motion.current = null;
    };
  }, [side]);
  useEffect(() => {
    const element = dialog.current!;
    if (side === 'bottom') {
      if (open && !element.open)
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      motion.current?.sync(open, immediateClose);
      return;
    }
    if (open && !element.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [open, side, immediateClose]);
  useEffect(() => {
    const element = dialog.current;
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      {...(description ? { 'aria-describedby': help } : {})}
      className={`ui-drawer ui-drawer-${side}`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // Native modality makes the app inert; wrap the ends explicitly so Tab
        // stays on drawer controls rather than advancing to browser chrome.
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href],button,input,select,textarea,[tabindex]',
          ),
        ).filter(
          (node) =>
            node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      {side === 'bottom' && (
        <div className="ui-sheet-handle" aria-hidden="true">
          <span />
        </div>
      )}
      <header className="ui-drawer-header">
        <h2 id={heading} className="type-section">
          {title}
        </h2>
        <IconButton label={`Close ${title}`} onClick={close}>
          <X size={20} aria-hidden="true" />
        </IconButton>
      </header>
      <div
        className="ui-drawer-body"
        {...(side === 'bottom'
          ? { tabIndex: 0, role: 'region', 'aria-label': `${title} details` }
          : {})}
      >
        {description && (
          <p id={help} className="type-meta ui-drawer-description">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
