'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './primitives';

/** Content stays mounted while closed; presentation never owns its runtime. */
export function Drawer({
  open,
  close,
  title,
  children,
  side = 'right',
  description,
}: {
  open: boolean;
  close(): void;
  title: string;
  children: ReactNode;
  side?: 'left' | 'right' | 'bottom';
  description?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useId();
  const help = useId();
  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [open]);
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
      {side === 'bottom' && <SwipeHandle close={close} />}
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

/** Only the handle claims a gesture; body scrolling always belongs to the browser. */
function SwipeHandle({ close }: { close(): void }) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  return (
    <div
      className="ui-sheet-handle"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = start.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = Math.abs(event.clientX - gesture.x);
        const dy = event.clientY - gesture.y;
        // Reject upward/horizontal intent, rather than turning it into a later dismissal.
        if (dy < -12 || (dx > 12 && dx > Math.abs(dy))) start.current = null;
      }}
      onPointerUp={(event) => {
        const gesture = start.current;
        start.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (!gesture || gesture.id !== event.pointerId) return;
        const dy = event.clientY - gesture.y;
        if (dy >= 64 && dy > Math.abs(event.clientX - gesture.x) * 2) close();
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onLostPointerCapture={() => {
        start.current = null;
      }}
    >
      <span />
    </div>
  );
}
