import {
  getRatedUserClassName,
  isLegendaryRank,
} from '../../domain/utils';

import {
  buildProfileUrl,
} from '../../domain/friends';

/*
 * Renders the friend's handle the same way
 * Codeforces itself does: colored by rating tier,
 * with the two-tone first letter Codeforces uses
 * for Legendary Grandmasters.
 */
export function RatedHandle({
  handle,
  rank,
}: {
  handle: string;
  rank?: string;
}) {
  const className =
    getRatedUserClassName(
      rank,
    );

  if (
    isLegendaryRank(
      rank,
    )
  ) {
    return (
      <a
        href={buildProfileUrl(
          handle,
        )}
        target="_blank"
        rel="noopener"
        title={handle}
        className={
          className
        }
      >
        <span className="legendary-user-first-letter">
          {handle.charAt(
            0,
          )}
        </span>
        {handle.slice(
          1,
        )}
      </a>
    );
  }

  return (
    <a
      href={buildProfileUrl(
        handle,
      )}
      target="_blank"
      rel="noopener"
      title={handle}
      className={
        className ||
        undefined
      }
    >
      {handle}
    </a>
  );
}

/*
 * Small, unobtrusive brand mark - same monospace,
 * muted-gray, letter-spaced treatment used for the
 * "cfpm" label on the main mirror panel. Sits in
 * the footer row next to the refresh button, not
 * meant to draw attention.
 */
export function CfpmMark() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing:
          '0.08em',
        fontFamily:
          'monospace',
        color: '#999999',
        opacity: 0.75,
        userSelect: 'none',
      }}
      title="CF Performance Mirror"
    >
      cfpm
    </span>
  );
}

/* Same chevron as the main cfpm panel's own collapse button. */
export function ChevronIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4.5l4 4 4-4" />
    </svg>
  );
}
