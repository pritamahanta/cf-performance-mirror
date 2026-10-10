import type { CSSProperties, ReactNode } from 'react';

import type { Theme } from '../domain/theme';

interface Props {
  title: string;
  theme: Theme;
  /* Optional width cap (px); without it the box fills the card. */
  maxWidth?: number;
  children: ReactNode;
}

/*
 * A titled, bordered box for one panel of the profile card (Timings,
 * Problems). Overflow is left visible on purpose: the dropdowns and the
 * topic picker inside it open past the box edge and must not be clipped.
 */
export function Sandbox({ title, theme, maxWidth, children }: Props) {
  const style: CSSProperties = {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth,
    marginBottom: 12,
    border: `1px solid ${theme.borderLight}`,
    borderRadius: 5,
    background: theme.bg,
  };

  return (
    <div className="cfpm-sandbox" style={style}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: theme.muted,
          padding: '8px 12px 0',
        }}
      >
        {title}
      </div>

      <div style={{ padding: '0 10px 10px' }}>{children}</div>
    </div>
  );
}
