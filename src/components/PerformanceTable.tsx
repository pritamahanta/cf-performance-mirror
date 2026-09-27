import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { Category } from '../types/settings';
import type { ModeData, DeltaInfo } from '../types/performance';
import type { Theme } from '../domain/theme';
import { buildTableModel } from '../domain/table';
import { SubmissionPopup } from './friction/SubmissionPopup';

interface Props {
  modeData: ModeData;
  category: Category;
  deltaInfo: DeltaInfo | null;
  theme: Theme;
  popupSort: 'time' | 'contest';
  onPopupSortChange: (mode: 'time' | 'contest') => void;
}

type PopupState = {
  anchor: HTMLElement;
  label: string;
  ids: number[];
  contestId: number;
  bg: string;
  fg: string;
};

export function PerformanceTable({
  modeData,
  category,
  deltaInfo,
  theme,
  popupSort,
  onPopupSortChange,
}: Props) {
  const model = buildTableModel(modeData, category);
  const [popup, setPopup] = useState<PopupState | null>(null);

  const openPopup = (
    event: MouseEvent<HTMLElement>,
    label: string,
    ids: number[],
    contestId: number,
    bg: string,
    fg: string,
  ) => {
    if (!ids.length) return;

    const anchor = event.currentTarget;

    setPopup(current =>
      current?.anchor === anchor
        ? null
        : {
            anchor,
            label,
            ids,
            contestId,
            bg,
            fg,
          },
    );
  };

  return (
    <>
      <table
        style={{
          borderCollapse: 'collapse',
          fontSize: 13,
          width: '100%',
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: '5px 12px',
                borderBottom: `2px solid ${theme.borderLight}`,
                verticalAlign: 'middle',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    color: theme.tableHeaderText,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {category}
                </span>

                {deltaInfo && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      marginLeft: 0,
                      padding: '1px 7px 1px 5px',
                      borderRadius: 10,
                      font: '700 11px monospace',
                      background:
                        deltaInfo.delta > 0
                          ? theme.isDark
                            ? '#0d2318'
                            : '#e6f4ea'
                          : deltaInfo.delta < 0
                            ? theme.isDark
                              ? '#2a1212'
                              : '#fdecea'
                            : theme.isDark
                              ? '#222'
                              : '#f5f5f5',
                      color:
                        deltaInfo.delta > 0
                          ? '#27ae60'
                          : deltaInfo.delta < 0
                            ? '#e74c3c'
                            : theme.muted,
                    }}
                    title={
                      deltaInfo.count > 0
                        ? `Rating change in ${deltaInfo.count} rated ${category} contest${deltaInfo.count !== 1 ? 's' : ''} (selected period)`
                        : `No rated ${category} contests in the selected period`
                    }
                  >
                    <span>Δ</span>
                    <span>
                      {deltaInfo.delta > 0 ? '+' : ''}
                      {deltaInfo.delta}
                    </span>
                  </span>
                )}
              </div>
            </th>

            {model.indices.map(index => (
              <th
                key={index}
                style={{
                  textAlign: 'center',
                  padding: '5px 14px',
                  fontWeight: 700,
                  fontSize: 13,
                  color: theme.tableHeaderText,
                  borderBottom: `2px solid ${theme.borderLight}`,
                }}
              >
                {index}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          <tr>
            <td
              style={{
                textAlign: 'left',
                padding: '6px 14px',
                fontSize: 11,
                color: theme.muted,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Avg. time (min)
            </td>

            {model.rows.map(cell => (
              <td
                key={cell.index}
                style={{
                  textAlign: 'center',
                  padding: '6px 14px',
                  fontSize: 13,
                  color: theme.accentBlue,
                  fontWeight: 700,
                  borderTop: `1px solid ${theme.borderLighter}`,
                }}
              >
                {cell.averageTime ?? '—'}
              </td>
            ))}
          </tr>

          <tr>
            <td
              style={{
                textAlign: 'left',
                padding: '6px 14px',
                fontSize: 11,
                color: theme.muted,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Median time (min)
            </td>

            {model.rows.map(cell => (
              <td
                key={cell.index}
                style={{
                  textAlign: 'center',
                  padding: '6px 14px',
                  fontSize: 13,
                  color: '#6b4fa0',
                  fontWeight: 700,
                  borderTop: `1px solid ${theme.borderLighter}`,
                }}
              >
                {cell.medianTime ?? '—'}
              </td>
            ))}
          </tr>

          <tr>
            <td
              style={{
                textAlign: 'left',
                padding: '6px 14px',
                fontSize: 11,
                color: theme.muted,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Solved
            </td>

            {model.rows.map(cell => {
              const display =
                cell.attempts > 0 && cell.solved === 0
                  ? `0 / ${cell.attempts}`
                  : String(cell.solved);

              const clickable = cell.acIds.length > 0;

              return (
                <td
                  key={cell.index}
                  className={
                    cell.attempts > 0 && cell.solved === 0
                      ? 'failure-cell'
                      : clickable
                        ? 'clickable'
                        : undefined
                  }
                  style={{
                    textAlign: 'center',
                    padding: '6px 14px',
                    fontSize: 13,
                    color:
                      cell.attempts > 0 && cell.solved === 0
                        ? '#e74c3c'
                        : theme.tableCellText,
                    fontWeight:
                      cell.attempts > 0 && cell.solved === 0
                        ? 700
                        : undefined,
                    borderTop: `1px solid ${theme.borderLighter}`,
                    cursor: clickable ? 'pointer' : 'default',
                    textDecoration: clickable ? 'underline' : undefined,
                    textDecorationStyle: clickable ? 'dotted' : undefined,
                    textUnderlineOffset: clickable ? 2 : undefined,
                  }}
                  title={
                    cell.acIds.length
                      ? `Click to view ${cell.acIds.length} AC submissions for problem ${cell.index}`
                      : cell.attempts > 0 && cell.solved === 0
                        ? `Never solved — ${cell.attempts} submission${cell.attempts !== 1 ? 's' : ''}`
                        : undefined
                  }
                  onClick={event =>
                    openPopup(
                      event,
                      'AC',
                      cell.acIds,
                      0,
                      theme.solvedBadge,
                      theme.solvedBadgeText,
                    )
                  }
                >
                  {display}
                </td>
              );
            })}
          </tr>

          <tr>
            <td
              style={{
                textAlign: 'left',
                padding: '6px 14px',
                fontSize: 11,
                color: theme.muted,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Attempts
            </td>

            {model.rows.map(cell => {
              const clickable = cell.wrongIds.length > 0;

              return (
                <td
                  key={cell.index}
                  style={{
                    textAlign: 'center',
                    padding: '6px 14px',
                    fontSize: 13,
                    color: theme.tableCellText,
                    borderTop: `1px solid ${theme.borderLighter}`,
                    cursor: clickable ? 'pointer' : 'default',
                    textDecoration: clickable ? 'underline' : undefined,
                    textDecorationStyle: clickable ? 'dotted' : undefined,
                    textUnderlineOffset: clickable ? 2 : undefined,
                  }}
                  title={
                    clickable
                      ? `Click to view ${cell.wrongIds.length} wrong submissions for problem ${cell.index}`
                      : undefined
                  }
                  onClick={event =>
                    openPopup(
                      event,
                      'Errors',
                      cell.wrongIds,
                      0,
                      theme.waBadge,
                      theme.waBadgeText,
                    )
                  }
                >
                  {cell.attempts}
                </td>
              );
            })}
          </tr>

          <tr>
            <td
              style={{
                textAlign: 'left',
                padding: '6px 14px',
                fontSize: 11,
                color: theme.muted,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Failure %
            </td>

            {model.rows.map(cell => {
              const color =
                cell.failurePercent === null
                  ? theme.tableCellText
                  : cell.failurePercent < 40
                    ? '#27ae60'
                    : cell.failurePercent < 70
                      ? '#e67e22'
                      : '#e74c3c';

              return (
                <td
                  key={cell.index}
                  style={{
                    textAlign: 'center',
                    padding: '6px 14px',
                    fontSize: 13,
                    color,
                    borderTop: `1px solid ${theme.borderLighter}`,
                  }}
                >
                  {cell.failurePercent === null
                    ? '—'
                    : `${cell.failurePercent}%`}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>

      {popup && (
        <SubmissionPopup
          label={popup.label}
          ids={popup.ids}
          contestId={popup.contestId}
          badgeBg={popup.bg}
          badgeFg={popup.fg}
          timingMap={modeData.submissionTimingMap}
          contestMap={modeData.submissionContestMap}
          theme={theme}
          crossContest
          crossContestSort={popupSort}
          anchor={popup.anchor}
          onCrossContestSortChange={onPopupSortChange}
          onClose={() => setPopup(null)}
        />
      )}
    </>
  );
}