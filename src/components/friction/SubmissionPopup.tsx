import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { buildSubmissionUrl, submissionSortKey } from '../../domain/friction';
import type { SubmissionTiming } from '../../types/performance';
import type { Theme } from '../../domain/theme';
import { SubmissionSourceOverlay } from '../SubmissionSourceOverlay';

/*
 * This popup only ever opens on a Codeforces profile page (see
 * installApp()/getProfileHandle() in content/main.tsx, which the
 * whole performance panel - this popup included - depends on), so
 * the handle it shows "By" in the source overlay is simply that
 * page's own path segment; no extra prop-threading needed for it.
 */
const PROFILE_PATH_RE = /^\/profile\/([^/]+)\/?$/;

function getViewedProfileHandle(): string | null {
  const match = PROFILE_PATH_RE.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

interface Props {
  label: string;
  ids: number[];
  contestId: number;
  badgeBg: string;
  badgeFg: string;
  timingMap: Map<number, SubmissionTiming>;
  contestMap: Map<number, number>;
  theme: Theme;
  crossContest?: boolean;
  crossContestSort: 'time' | 'contest';
  anchor: HTMLElement;
  /* The one problem every id in `ids` belongs to - for the source overlay's header. */
  problemIndex?: string;
  problemName?: string;
  problemContestName?: string;
  onCrossContestSortChange?: (mode: 'time' | 'contest') => void;
  onClose: () => void;
}

export function SubmissionPopup({
  label, ids, contestId, badgeBg, badgeFg, timingMap, contestMap, theme,
  crossContest = false, crossContestSort, anchor, problemIndex, problemName, problemContestName,
  onCrossContestSortChange, onClose,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });
  const [openedSubmission, setOpenedSubmission] = useState<{ id: number; url: string } | null>(null);

  const reposition = () => {
    const popup = popupRef.current;
    if (!popup || !document.contains(anchor)) {
      onClose();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewW = window.innerWidth || document.documentElement.clientWidth;
    const viewH = window.innerHeight || document.documentElement.clientHeight;
    const pw = popup.offsetWidth || 300;
    const ph = popup.offsetHeight || 180;
    let top = rect.bottom + 6;
    let left = rect.left;
    if (left + pw > viewW - 8) left = Math.max(8, rect.right - pw);
    if (top + ph > viewH - 8) top = Math.max(8, rect.top - ph - 6);
    setPosition({ top, left });
  };

  useEffect(() => {
    const onDocumentClick = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!popupRef.current || (target !== anchor && !popupRef.current.contains(target))) onClose();
    };
    const onScroll = (event: Event) => {
      if (!popupRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('click', onDocumentClick);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const frame = requestAnimationFrame(reposition);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  const sortedIds = useMemo(() => ids.slice().sort((a, b) => {
    if (crossContest && crossContestSort === 'contest') {
      const sa = timingMap.get(a)?.contestStart ?? Number.POSITIVE_INFINITY;
      const sb = timingMap.get(b)?.contestStart ?? Number.POSITIVE_INFINITY;
      return (sa - sb) || (a - b);
    }
    return (submissionSortKey(a, timingMap) - submissionSortKey(b, timingMap)) || (a - b);
  }), [ids, timingMap, crossContest, crossContestSort]);

  const style: CSSProperties = {
    position: 'fixed', zIndex: 999999, borderRadius: 7, overflow: 'hidden',
    boxShadow: '0 10px 36px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)',
    display: 'flex', flexDirection: 'column', minWidth: 220, maxWidth: 320,
    background: theme.dropdownBg, color: theme.text, border: `1px solid ${theme.dropdownBorder}`,
    top: position.top, left: position.left,
  };

  const content = (
    <div ref={popupRef} id="cfpm-sub-popup" style={style}>
      <div style={{
        padding: '8px 12px 7px', fontSize: 11, fontWeight: 700,
        color: theme.mutedStrong, borderBottom: `1px solid ${theme.dropdownBorder}`,
        background: theme.dropdownSection, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{
          background: badgeBg, color: badgeFg, fontSize: 10, fontWeight: 700,
          borderRadius: 3, padding: '1px 6px',
        }}>{label}</span>
        <span>{ids.length} submission{ids.length !== 1 ? 's' : ''}</span>
        {crossContest && (
          <button
            style={{
              background: theme.btnBg, border: `1px solid ${theme.btnBorder}`, cursor: 'pointer',
              padding: '0 6px', display: 'flex', alignItems: 'center', gap: 3,
              color: theme.muted, fontSize: 10, fontWeight: 600, outline: 'none',
              marginLeft: 'auto', flexShrink: 0, borderRadius: 3, height: 20, whiteSpace: 'nowrap',
            }}
            title={crossContestSort === 'contest'
              ? 'Sorted by contest date — click for submission time'
              : 'Sorted by submission time — click for contest order'}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              onCrossContestSortChange?.(crossContestSort === 'contest' ? 'time' : 'contest');
            }}
          >
            {crossContestSort === 'contest' ? '⇅ Contest Order' : '⇅ Time'}
          </button>
        )}
        <span
          style={{
            cursor: 'pointer', opacity: 0.45, fontSize: 11, padding: '2px 4px', borderRadius: 3,
            marginLeft: crossContest ? 0 : 'auto',
          }}
          onClick={(event) => { event.stopPropagation(); onClose(); }}
          onMouseEnter={event => { event.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={event => { event.currentTarget.style.opacity = '0.45'; }}
        >✕</span>
      </div>

      <div id="cfpm-sub-popup-list" style={{ overflowY: 'auto', maxHeight: 220, overscrollBehavior: 'contain' }}>
        {sortedIds.map((id, index) => {
          const url = buildSubmissionUrl(id, contestId, contestMap);
          const meta = timingMap.get(id);
          const hasMeta = !!meta && typeof meta.submittedAt === 'number' && typeof meta.contestStart === 'number';
          const offset = hasMeta ? ((meta as SubmissionTiming).submittedAt - (meta as SubmissionTiming).contestStart) / 60 : null;
          const background = index % 2 === 0
            ? 'transparent'
            : (theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)');

          const itemStyle: CSSProperties = {
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
            textDecoration: 'none',
            color: url ? theme.problemLink : theme.muted,
            fontSize: 12, fontWeight: 600,
            borderTop: index > 0 ? `1px solid ${theme.borderLighter}` : undefined,
            background,
            cursor: url ? 'pointer' : 'default',
            transition: 'opacity 0.1s ease',
          };

          const icon = url
            ? <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.55 }}><path d="M2 10L10 2M4 2h6v6"/></svg>
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.25 }}><circle cx="6" cy="6" r="5"/></svg>;

          const children = (
            <>
              {icon}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                <span>Submission #{id}</span>
                {hasMeta && offset !== null && offset >= 0 ? (
                  <span style={{ fontSize: 10, color: theme.muted, fontWeight: 400 }}>+{Math.round(offset * 10) / 10}m into contest</span>
                ) : hasMeta ? (
                  <span style={{ fontSize: 10, color: theme.muted, fontWeight: 400, fontStyle: 'italic', opacity: 0.7 }}>solved outside contest</span>
                ) : null}
              </div>
              <span style={{ fontSize: 10, color: theme.muted, fontWeight: 400, flexShrink: 0 }}>#{index + 1}</span>
            </>
          );

          return url
            ? (
              <button
                key={id}
                type="button"
                className="cfpm-sub-link"
                style={{ ...itemStyle, width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
                onClick={() => setOpenedSubmission({ id, url })}
              >
                {children}
              </button>
            )
            : <div key={id} className="cfpm-sub-link" style={itemStyle}>{children}</div>;
        })}
      </div>
    </div>
  );

  return (
    <>
      {createPortal(content, document.body)}

      {openedSubmission && (
        <SubmissionSourceOverlay
          url={openedSubmission.url}
          submissionId={openedSubmission.id}
          handle={getViewedProfileHandle() ?? '—'}
          contestName={problemContestName}
          problemIndex={problemIndex}
          problemName={problemName}
          verdictLabel={<span style={{ color: badgeFg }}>{label}</span>}
          theme={theme}
          onClose={() => setOpenedSubmission(null)}
        />
      )}
    </>
  );
}
