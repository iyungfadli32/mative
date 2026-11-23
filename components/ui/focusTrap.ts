/**
 * Util focus trap untuk Dialog (H-1): Tab/Shift+Tab berputar di dalam
 * dialog, dan fokus dikembalikan ke elemen pemicu saat dialog ditutup
 * (pemulihan dilakukan di Dialog lewat ref elemen pemicu).
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusableElement {
  readonly disabled?: boolean;
  getAttribute(name: string): string | null;
  focus(options?: { preventScroll?: boolean }): void;
}

export interface FocusableContainer {
  querySelectorAll(selector: string): ArrayLike<FocusableElement>;
}

export function getFocusableElements(container: FocusableContainer): FocusableElement[] {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.disabled && element.getAttribute("aria-hidden") !== "true",
  );
}

export interface TrapKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

export function trapTabKey(
  event: TrapKeyEvent,
  elements: readonly FocusableElement[],
  activeElement: FocusableElement | null,
): void {
  if (event.key !== "Tab" || elements.length === 0) return;
  const currentIndex = activeElement ? elements.indexOf(activeElement) : -1;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && currentIndex <= 0) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && currentIndex === elements.length - 1) {
    event.preventDefault();
    first.focus();
  }
}
