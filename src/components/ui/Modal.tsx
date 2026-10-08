import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  labelledById?: string;
  ariaLabel?: string;
  /** Tailwind classes applied to the dialog panel. */
  panelClassName?: string;
  /** Tailwind classes applied to the backdrop wrapper. */
  backdropClassName?: string;
  /** Clicking the backdrop closes the dialog unless disabled. */
  dismissOnBackdrop?: boolean;
  children: React.ReactNode;
}

/**
 * Accessible dialog shell: role/aria wiring, ESC to close, focus trap,
 * background scroll lock, and focus restore to the element that opened it.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  labelledById,
  ariaLabel,
  panelClassName = 'eb-panel w-full max-w-md overflow-y-auto rounded-2xl p-5',
  backdropClassName = 'app-modal-backdrop fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-center px-4',
  dismissOnBackdrop = true,
  children,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const fallbackLabelId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    // Android can pan or shrink the visible viewport when zoomed or when the
    // keyboard opens. Layout viewport units alone do not cover those cases.
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const backdrop = backdropRef.current;
      if (!backdrop) return;
      // Some WebViews report an empty visual viewport while the page is still
      // settling; keep the CSS `inset-0` box rather than a zero-sized overlay.
      if (!viewport || !viewport.width || !viewport.height) {
        backdrop.style.removeProperty('--eb-modal-viewport-height');
        return;
      }
      const height = viewport.height;
      Object.assign(backdrop.style, {
        top: `${viewport.offsetTop}px`,
        left: `${viewport.offsetLeft}px`,
        width: `${viewport.width}px`,
        height: `${height}px`,
        right: 'auto',
        bottom: 'auto',
      });
      backdrop.style.setProperty('--eb-modal-viewport-height', `${height}px`);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      // A footer can be the first focusable control (e.g. sync status). Focusing
      // it scrolls away the heading before the user has read the dialog.
      panel.scrollTop = 0;
      const target = (panel.querySelector('[data-autofocus]') as HTMLElement | null) || panel;
      target.focus({ preventScroll: true });
    };
    const focusTimer = window.setTimeout(focusFirst, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = (Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[])
        .filter(element => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === panel || !panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      previouslyFocused.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const dialog = (
    <div
      ref={backdropRef}
      data-eb-modal-backdrop
      className={backdropClassName}
      onMouseDown={event => {
        if (!dismissOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-eb-modal-panel
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById || (ariaLabel ? undefined : fallbackLabelId)}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`${panelClassName} focus:outline-none`}
      >
        {children}
      </div>
    </div>
  );

  // Blur/transform on ancestors can constrain fixed overlays and put them
  // below sibling navigation. Mount at the body so dialogs use the viewport.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};
