import React, { useEffect, useId, useRef } from 'react';

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
  panelClassName = 'bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5',
  backdropClassName = 'fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4',
  dismissOnBackdrop = true,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const fallbackLabelId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = (panel.querySelector('[data-autofocus]') as HTMLElement | null)
        || (panel.querySelector(FOCUSABLE_SELECTOR) as HTMLElement | null)
        || panel;
      target.focus();
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
      if (event.shiftKey && document.activeElement === first) {
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
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={backdropClassName}
      onMouseDown={event => {
        if (!dismissOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
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
};
