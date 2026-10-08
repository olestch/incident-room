/** Presentation only: native dialog keeps modality until the exit animation completes. */
export function createSheetMotion(
  dialog: HTMLDialogElement,
  dismiss: () => void,
  restoreFocus: () => void,
) {
  const handle = dialog.querySelector<HTMLElement>('.ui-sheet-handle')!;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let desiredOpen = false;
  let disposed = false;
  let revision = 0;
  let animations: Animation[] = [];
  let gesture: {
    id: number;
    x: number;
    y: number;
    origin: number;
    samples: { y: number; time: number }[];
  } | null = null;

  const position = () => {
    const transform = getComputedStyle(dialog).transform;
    const matrix = transform.match(/^matrix(?:3d)?\((.+)\)$/)?.[1]?.split(',');
    return matrix
      ? Number(matrix[matrix.length === 16 ? 13 : 5]) || 0
      : Number(transform.match(/translateY\(([-\d.]+)px\)/)?.[1]) || 0;
  };
  const opacity = () =>
    typeof dialog.animate === 'function'
      ? Number(getComputedStyle(dialog, '::backdrop').opacity) || 0
      : Number(dialog.style.getPropertyValue('--sheet-backdrop-opacity') || 1);
  const offscreen = () =>
    dialog.offsetHeight + Math.max(0, parseFloat(getComputedStyle(dialog).bottom) || 0);
  const write = (y: number, alpha: number) => {
    dialog.style.transform = `translateY(${y}px)`;
    dialog.style.setProperty('--sheet-backdrop-opacity', String(alpha));
  };
  const stopAnimation = () => {
    const current = { y: position(), alpha: opacity() };
    revision++;
    animations.forEach((animation) => animation.cancel());
    animations = [];
    write(current.y, current.alpha);
    return current;
  };
  const release = () => {
    const id = gesture?.id;
    gesture = null;
    if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  };
  const finishClose = (restore = true) => {
    dialog.close();
    dialog.dataset.sheetPhase = 'closed';
    write(0, 1);
    if (restore) restoreFocus();
  };
  const animate = (
    y: number,
    alpha: number,
    duration: number,
    phase: string,
    complete: () => void,
  ) => {
    const from = stopAnimation();
    const token = revision;
    dialog.dataset.sheetPhase = phase;
    write(y, alpha);
    if (reduced.matches || !dialog.animate) {
      complete();
      return;
    }
    const timing = { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' as const };
    animations = [
      dialog.animate(
        [{ transform: `translateY(${from.y}px)` }, { transform: `translateY(${y}px)` }],
        timing,
      ),
      dialog.animate([{ opacity: from.alpha }, { opacity: alpha }], {
        ...timing,
        pseudoElement: '::backdrop',
      }),
    ];
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (disposed || token !== revision) return;
        stopAnimation();
        write(y, alpha);
        complete();
      },
      () => {
        /* Cancellation belongs to the newer transition or unmount. */
      },
    );
  };
  const recover = () => {
    release();
    animate(0, 1, 200, 'recovering', () => {
      dialog.dataset.sheetPhase = 'open';
    });
  };
  const sample = (event: PointerEvent) => {
    const active = gesture!;
    active.samples.push({ y: event.clientY, time: event.timeStamp });
    while (active.samples.length > 2 && event.timeStamp - active.samples[0]!.time > 100)
      active.samples.shift();
  };
  const down = (event: PointerEvent) => {
    if (!desiredOpen || !dialog.open || !event.isPrimary || event.button !== 0 || gesture) return;
    event.preventDefault();
    const from = stopAnimation();
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: from.y,
      samples: [{ y: event.clientY, time: event.timeStamp }],
    };
    dialog.dataset.sheetPhase = 'dragging';
    handle.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    event.preventDefault();
    const dy = event.clientY - gesture.y;
    const dx = Math.abs(event.clientX - gesture.x);
    if (dy < -12 || (dx > 12 && dx > Math.abs(dy))) {
      recover();
      return;
    }
    sample(event);
    const y = Math.min(offscreen(), Math.max(0, gesture.origin + dy));
    // Reduced motion suppresses decorative transitions, not direct pointer feedback.
    write(y, Math.max(0.25, 1 - (y / Math.max(1, dialog.offsetHeight)) * 0.75));
  };
  const up = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    sample(event);
    const dy = event.clientY - gesture.y;
    const first = gesture.samples[0]!;
    const elapsed = event.timeStamp - first.time;
    const velocity = elapsed >= 8 && elapsed <= 120 ? (event.clientY - first.y) / elapsed : 0;
    const distance = Math.min(160, Math.max(64, dialog.offsetHeight * 0.2));
    const dismisses =
      dy > Math.abs(event.clientX - gesture.x) * 2 &&
      (dy >= distance || (dy >= 24 && velocity >= 0.65));
    release();
    if (dismisses) dismiss();
    else recover();
  };
  const cancel = () => {
    if (gesture) recover();
  };
  const resize = () => {
    if (!dialog.open) return;
    if (desiredOpen) recover();
    else {
      release();
      animate(offscreen(), 0, 200, 'closing', finishClose);
    }
  };
  const motionChange = () => {
    if (!reduced.matches || !dialog.open) return;
    release();
    stopAnimation();
    if (desiredOpen) {
      write(0, 1);
      dialog.dataset.sheetPhase = 'open';
    } else finishClose();
  };
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel);
  handle.addEventListener('lostpointercapture', cancel);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  reduced.addEventListener('change', motionChange);

  return {
    sync(open: boolean, immediateClose: boolean) {
      desiredOpen = open;
      release();
      if (open) {
        if (!dialog.open) {
          dialog.showModal();
          write(offscreen(), 0);
        }
        animate(0, 1, 260, 'opening', () => {
          dialog.dataset.sheetPhase = 'open';
        });
      } else if (dialog.open) {
        if (immediateClose) {
          stopAnimation();
          finishClose(false);
        } else animate(offscreen(), 0, 220, 'closing', finishClose);
      }
    },
    dispose() {
      disposed = true;
      release();
      stopAnimation();
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      reduced.removeEventListener('change', motionChange);
      dialog.close();
      dialog.style.removeProperty('transform');
      dialog.style.removeProperty('--sheet-backdrop-opacity');
      delete dialog.dataset.sheetPhase;
    },
  };
}
