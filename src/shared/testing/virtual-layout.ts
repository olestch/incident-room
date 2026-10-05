import { vi } from 'vitest';
/** jsdom has no layout/ResizeObserver. Browser tests separately verify actual geometry. */
export function installVirtualLayout() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(element: Element) {
        queueMicrotask(() =>
          this.callback(
            [
              {
                target: element,
                borderBoxSize: [
                  {
                    inlineSize: 700,
                    blockSize: element.classList.contains('timeline-viewport') ? 500 : 110,
                  },
                ],
                contentRect: { width: 700, height: 500 },
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          ),
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      width: 700,
      height: this.classList.contains('timeline-viewport') ? 500 : 110,
      top: 0,
      bottom: 110,
      left: 0,
      right: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('timeline-viewport') ? 500 : 110;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(700);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions | number) {
      if (typeof options === 'object') this.scrollTop = options.top ?? 0;
    },
  });
}
