import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { Theme } from '../domain/theme';

interface Props {
  /* Header line, e.g. "Timings, Div2 · Total · All time". */
  title: ReactNode;
  /* Accessible name of the dialog. */
  label: string;
  theme: Theme;
  /* Widest the box may get (px). */
  maxWidth?: number;
  /* Shortest the box may be (px) - it still grows taller for more content. */
  minHeight?: number;
  onClose: () => void;
  children: ReactNode;
}

/*
 * One in-page box for a panel of the profile card (Timings, Problems),
 * styled like the submission source box: a dimmed backdrop, a centered
 * box with a header line and an x at its top right. It closes on the x,
 * on a click outside the box, and on Escape.
 *
 * Overflow is left visible on purpose: the dropdowns and the topic picker
 * inside it open past the box edge and must not be clipped.
 */
export function Sandbox({
  title,
  label,
  theme,
  maxWidth = 980,
  minHeight,
  onClose,
  children,
}: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      /*
       * Escape inside a text field (the topic search) belongs to that
       * field; it must not also close the whole box.
       */
      const tag = (event.target as HTMLElement | null)?.tagName;

      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }

      onClose();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const backdropStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    /* Below the submission list popups (999999), which open on top of it. */
    zIndex: 999990,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    /* Scrolls (rather than clips) when the viewport is shorter than the box. */
    overflowY: 'auto',
    padding: 16,
    boxSizing: 'border-box',
  };

  const boxStyle: CSSProperties = {
    position: 'relative',
    /* auto margins centre the box and stay safe when it is taller than the screen */
    margin: 'auto',
    width: '100%',
    maxWidth,
    minHeight,
    boxSizing: 'border-box',
    borderRadius: 6,
    boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
    background: theme.dropdownBg,
    border: `1px solid ${theme.dropdownBorder}`,
    color: theme.text,
    fontFamily: theme.fontFamily,
  };

  return createPortal(
    <div
      className="cfpm-sandbox"
      style={backdropStyle}
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={boxStyle}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            background: 'transparent',
            border: 0,
            padding: 4,
            cursor: 'pointer',
            opacity: 0.55,
            fontSize: 18,
            lineHeight: 1,
            color: theme.text,
          }}
        >
          {'✕'}
        </button>

        <div
          style={{
            padding: '14px 42px 12px 16px',
            fontSize: 13,
            lineHeight: 1.5,
            borderBottom: `1px solid ${theme.dropdownBorder}`,
          }}
        >
          {title}
        </div>

        <div style={{ padding: '0 14px 14px' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
