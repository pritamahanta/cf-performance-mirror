import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type {
  Category,
  ExtensionSettings,
  Mode,
} from '../../types/settings';

import { CATEGORIES } from '../../types/settings';
import type { Theme } from '../../domain/theme';

import { TimelineSelector } from './TimelineSelector';

interface Props {
  settings: ExtensionSettings;
  theme: Theme;
  onChange: (patch: Partial<ExtensionSettings>) => void;
}

type CustomPanel = 'date' | 'contest' | null;

export function Controls({
  settings,
  theme,
  onChange,
}: Props) {
  const [customPanel, setCustomPanel] =
    useState<CustomPanel>(null);

  const [start, setStart] = useState(
    settings.customStart,
  );

  const [end, setEnd] = useState(
    settings.customEnd,
  );

  const [from, setFrom] = useState(
    settings.customContestFrom,
  );

  const [to, setTo] = useState(
    settings.customContestTo,
  );

  const [dateError, setDateError] =
    useState(false);

  const [contestError, setContestError] =
    useState(false);

  const customPanelRef = useRef<HTMLDivElement>(null);

  const selectStyle: CSSProperties = {
    height: 30,
    padding: '0 8px',
    borderRadius: 5,
    border: `1px solid ${theme.inputBorder}`,
    background: theme.inputBg,
    color: theme.inputText,
    fontSize: 12,
    fontFamily: theme.fontFamily,
    whiteSpace: 'nowrap',
    outline: 'none',
    cursor: 'pointer',
    minWidth: 90,
  };

  const openDatePanel = () => {
    setStart(settings.customStart);
    setEnd(settings.customEnd);
    setDateError(false);
    setContestError(false);
    setCustomPanel('date');
  };

  const openContestPanel = () => {
    setFrom(settings.customContestFrom);
    setTo(settings.customContestTo);
    setContestError(false);
    setDateError(false);
    setCustomPanel('contest');
  };

  useEffect(() => {
    if (!customPanel) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (!customPanelRef.current?.contains(event.target as Node)) {
        setCustomPanel(null);
        setDateError(false);
        setContestError(false);
        setStart(settings.customStart);
        setEnd(settings.customEnd);
        setFrom(settings.customContestFrom);
        setTo(settings.customContestTo);
      }
    };

    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [
    customPanel,
    settings.customStart,
    settings.customEnd,
    settings.customContestFrom,
    settings.customContestTo,
  ]);

  return (
    <>
      <div
        className="cfpm-controls-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          rowGap: 8,
          gap: 10,
          margin: '12px 0',
          minHeight: 36,
        }}
      >
        <div
          className="cfpm-category-tabs"
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {CATEGORIES.map(
            (category: Category) => {
              const active =
                category === settings.category;

              return (
                <button
                  key={category}
                  className={`cfpm-cat-btn ${active ? 'active' : ''
                    }`}
                  style={{
                    background: active
                      ? theme.btnActiveBg
                      : theme.btnBg,
                    color: active
                      ? theme.btnActiveText
                      : theme.btnText,
                    border: `1px solid ${active
                      ? theme.btnActiveBorder
                      : theme.btnBorder
                      }`,
                    cursor: 'pointer',
                  }}
                  onClick={() =>
                    onChange({ category })
                  }
                >
                  {category}
                </button>
              );
            },
          )}
        </div>

        <div
          className="cfpm-control-right"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            rowGap: 8,
            gap: 7,
          }}
        >
          <TimelineSelector
            value={settings.timeline}
            customStart={settings.customStart}
            customEnd={settings.customEnd}
            customContestFrom={
              settings.customContestFrom
            }
            customContestTo={
              settings.customContestTo
            }
            isDark={theme.isDark}
            theme={theme}
            onChange={onChange}
            onOpenCustomDate={
              openDatePanel
            }
            onOpenCustomContest={
              openContestPanel
            }
          />

          <select
            value={settings.mode}
            style={selectStyle}
            onChange={event =>
              onChange({
                mode: event.target
                  .value as Mode,
              })
            }
          >
            <option value="total">
              Total
            </option>

            <option value="rated">
              Rated
            </option>

            <option value="unrated">
              Unrated
            </option>
          </select>
        </div>
      </div>

      {customPanel === 'date' && (
        <div
          ref={customPanelRef}
          className="cfpm-inline-form"
          style={{
            background: theme.dropdownSection,
            border: `1px solid ${theme.dropdownBorder}`,
          }}
        >
          <span style={{ color: theme.muted, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
            From
          </span>
          <input
            type="date"
            value={start}
            onChange={event => setStart(event.target.value)}
            style={{
              height: 30, padding: '0 8px', borderRadius: 5,
              border: `1px solid ${theme.inputBorder}`, background: theme.inputBg,
              color: theme.inputText, fontSize: 12, flex: '1 1 130px',
              minWidth: 130, maxWidth: 170,
              colorScheme: theme.isDark ? 'dark' : 'light', outline: 'none',
            }}
          />
          <span style={{ color: theme.muted, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
            To
          </span>
          <input
            type="date"
            value={end}
            onChange={event => setEnd(event.target.value)}
            style={{
              height: 30, padding: '0 8px', borderRadius: 5,
              border: `1px solid ${theme.inputBorder}`, background: theme.inputBg,
              color: theme.inputText, fontSize: 12, flex: '1 1 130px',
              minWidth: 130, maxWidth: 170,
              colorScheme: theme.isDark ? 'dark' : 'light', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
            {dateError && (
              <span style={{ color: '#e74c3c', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                Select both dates.
              </span>
            )}
            <button
              className="cfpm-pill-btn"
              style={{
                background: theme.btnActiveBg,
                color: theme.btnActiveText,
                border: `1px solid ${theme.btnActiveBorder}`,
              }}
              onClick={() => {
                if (!start || !end) {
                  setDateError(true);
                  return;
                }
                onChange({ timeline: 'custom', customStart: start, customEnd: end });
                setCustomPanel(null);
                setDateError(false);
              }}
            >
              Apply
            </button>
            <button
              className="cfpm-pill-btn"
              style={{
                background: theme.btnBg,
                color: theme.btnText,
                border: `1px solid ${theme.btnBorder}`,
              }}
              onClick={() => {
                setCustomPanel(null);
                setDateError(false);
                setStart(settings.customStart);
                setEnd(settings.customEnd);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {customPanel === 'contest' && (
        <div
          ref={customPanelRef}
          className="cfpm-inline-form"
          style={{
            background: theme.dropdownSection,
            border: `1px solid ${theme.dropdownBorder}`,
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 8,
          }}
        >
          <span style={{ color: theme.muted, fontSize: 11.5, lineHeight: 1.4 }}>
            Enter a range of your most recent contests by rank.
            <br />
            e.g. <b>1 – 10</b> = last 10 · <b>11 – 20</b> = 11th to 20th most recent
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: theme.muted, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              From rank
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={from}
              onChange={event => setFrom(event.target.value)}
              style={{
                height: 30, padding: '0 8px', borderRadius: 5,
                border: `1px solid ${theme.inputBorder}`, background: theme.inputBg,
                color: theme.inputText, fontSize: 12, width: 90, outline: 'none',
              }}
            />

            <span style={{ color: theme.muted, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              to rank
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={to}
              onChange={event => setTo(event.target.value)}
              style={{
                height: 30, padding: '0 8px', borderRadius: 5,
                border: `1px solid ${theme.inputBorder}`, background: theme.inputBg,
                color: theme.inputText, fontSize: 12, width: 90, outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
              {contestError && (
                <span style={{ color: '#e74c3c', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Enter a valid rank range.
                </span>
              )}
              <button
                className="cfpm-pill-btn"
                style={{
                  background: theme.btnActiveBg,
                  color: theme.btnActiveText,
                  border: `1px solid ${theme.btnActiveBorder}`,
                }}
                onClick={() => {
                  const fromNum = Number.parseInt(from, 10);
                  const toNum = Number.parseInt(to, 10);

                  if (
                    !from || !to ||
                    Number.isNaN(fromNum) || Number.isNaN(toNum) ||
                    fromNum < 1 || toNum < 1
                  ) {
                    setContestError(true);
                    return;
                  }

                  onChange({
                    timeline: 'cc',
                    customContestFrom: from,
                    customContestTo: to,
                  });

                  setCustomPanel(null);
                  setContestError(false);
                }}
              >
                Apply
              </button>
              <button
                className="cfpm-pill-btn"
                style={{
                  background: theme.btnBg,
                  color: theme.btnText,
                  border: `1px solid ${theme.btnBorder}`,
                }}
                onClick={() => {
                  setCustomPanel(null);
                  setContestError(false);
                  setFrom(settings.customContestFrom);
                  setTo(settings.customContestTo);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}