import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, CSSProperties, ReactNode } from 'react';
import type { Category, ExtensionSettings } from '../../types/settings';
import type { ModeData, ProblemEntry } from '../../types/performance';
import type { Theme } from '../../domain/theme';
import { totalErrors } from '../../domain/utils';
import {
  ALL_CF_TAGS,
  filterFrictionProblems,
  getAvailableTags,
  getFrictionProblems,
  getProblemSubmissions,
  sortFrictionProblems,
  type FrictionFilters,
  type FrictionSource,
  type SubmissionVerdictKey,
} from '../../domain/friction';
import { useProblemSolvedCounts } from '../../hooks/useProblemSolvedCounts';
import { SubmissionPopup, type SubmissionVerdicts as PopupVerdicts } from './SubmissionPopup';

interface Props {
  modeData: ModeData;
  category: Category;
  settings: ExtensionSettings;
  theme: Theme;
  onSettingsChange: (patch: Partial<ExtensionSettings>) => void;
  popupSort: 'time' | 'contest';
  onPopupSortChange: (mode: 'time' | 'contest') => void;
}

/* Height of the problem list: taller on a tall screen, never more than about two thirds of the window. */
const LIST_HEIGHT = 'min(560px, 64vh)';

export function FrictionPanel({ modeData, category, settings, theme, onSettingsChange, popupSort, onPopupSortChange }: Props) {
  const [source, setSource] = useState<FrictionSource>('category');
  const [sort, setSort] = useState<'errors' | 'rating'>(settings.sortMode);
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | 'view' | null>(null);
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [popup, setPopup] = useState<{
    anchor: HTMLElement; ids: number[]; verdicts: PopupVerdicts; contestId: number;
    problemIndex: string; problemName: string; problemContestName?: string;
  } | null>(null);
  const solvedCounts = useProblemSolvedCounts();
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSort(settings.sortMode), [settings.sortMode]);

  useEffect(() => {
    const handler = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node;

      if (openMenu === 'filter' || topicPickerOpen) {
        if (filterRef.current?.contains(target)) return;
      } else if (openMenu === 'sort') {
        if (sortRef.current?.contains(target)) return;
      } else if (openMenu === 'view') {
        if (viewRef.current?.contains(target)) return;
      } else {
        return;
      }

      setOpenMenu(null);
      setTopicPickerOpen(false);
      setSearch('');
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [openMenu, topicPickerOpen]);

  /*
   * The view menu and the topic picker are taller than the room left
   * inside the card, so while either is open the clipping on the card
   * and its body is lifted; otherwise their bottom edge (the picker's
   * Done button, in particular) gets cut off.
   */
  const overflowOpen = openMenu === 'view' || topicPickerOpen;

  useEffect(() => {
    const body = document.getElementById('cfpm-body');
    if (body) body.style.overflow = overflowOpen ? 'visible' : 'hidden';
    return () => {
      if (body) body.style.overflow = 'hidden';
    };
  }, [overflowOpen]);

  const getProblems = (which: FrictionSource) => getFrictionProblems(modeData, category, which);
  const filters: FrictionFilters = {
    hideAC: settings.hideAC,
    solvedOnly: settings.solvedOnly,
    hideTags: settings.hideTags,
    hideRatings: settings.hideRatings,
    minAttempts: settings.minAttempts,
    ratingMin: settings.ratingMin,
    ratingMax: settings.ratingMax,
    tagFilters: settings.tagFilters,
  };

  const problems = useMemo(() => getProblems(source), [modeData, category, source]);
  const filtered = useMemo(() => filterFrictionProblems(problems, filters), [problems, settings.hideAC, settings.solvedOnly, settings.hideTags, settings.hideRatings, settings.minAttempts, settings.ratingMin, settings.ratingMax, settings.tagFilters]);
  const sorted = useMemo(() => sortFrictionProblems(filtered, sort), [filtered, sort]);
  const availableTags = useMemo(() => getAvailableTags(problems), [problems]);
  const sourceCounts = useMemo(() => ({
    category: filterFrictionProblems(getProblems('category'), filters).length,
    practice: filterFrictionProblems(getProblems('practice'), filters).length,
  }), [modeData, category, settings.hideAC, settings.solvedOnly, settings.hideTags, settings.hideRatings, settings.minAttempts, settings.ratingMin, settings.ratingMax, settings.tagFilters]);

  const visibleTags = useMemo(() => {
    const combined = Array.from(new Set([...ALL_CF_TAGS, ...availableTags, ...settings.tagFilters])).sort();
    const needle = search.toLowerCase().trim();
    return needle ? combined.filter(tag => tag.toLowerCase().includes(needle)) : combined;
  }, [availableTags, settings.tagFilters, search]);

  const setPatch = (patch: Partial<ExtensionSettings>) => onSettingsChange(patch);
  const toggleTag = (tag: string) => {
    const next = settings.tagFilters.includes(tag)
      ? settings.tagFilters.filter(item => item !== tag)
      : [...settings.tagFilters, tag];
    setPatch({ tagFilters: next });
  };

  const openSubmissions = (event: MouseEvent<HTMLElement>, ids: number[], verdicts: PopupVerdicts, problem: ProblemEntry) => {
    event.stopPropagation();
    const anchor = event.currentTarget;
    setPopup(current => current?.anchor === anchor
      ? null
      : {
        anchor, ids, verdicts, contestId: problem.contestId,
        problemIndex: problem.index, problemName: problem.name, problemContestName: problem.contestName,
      });
  };

  const activeFilter = settings.tagFilters.length > 0 || settings.minAttempts !== 1 || settings.ratingMin !== '' || settings.ratingMax !== '';
  const activeView = settings.hideAC || settings.solvedOnly || settings.hideTags || settings.hideRatings;

  return (
    <div
      className="cfpm-friction-section"
      style={{ marginTop: 0, paddingTop: 0 }}
    >
      <div
        className="cfpm-friction-scrollbox"
        style={{
          overflow: overflowOpen ? 'visible' : 'hidden',
          border: `1px solid ${theme.borderLight}`,
          borderRadius: 5,
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${theme.borderLight}`, minHeight: 42,
            padding: '0 10px 0 12px', flexShrink: 0, gap: 8,
            background: theme.bg, borderRadius: '5px 5px 0 0',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', background: theme.borderLighter,
            borderRadius: 5, padding: 3, gap: 2, flexShrink: 0,
          }}>
            {(['category', 'practice'] as const).map(key => {
              const active = source === key;
              return (
                <button
                  key={key}
                  style={{
                    background: active ? theme.btnActiveBg : 'transparent',
                    color: active ? theme.btnActiveText : theme.muted,
                    border: 'none', outline: 'none', cursor: 'pointer',
                    height: 26, padding: '0 11px', borderRadius: 3,
                    fontSize: 11, fontWeight: 600, display: 'inline-flex',
                    alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  }}
                  onClick={() => { setSource(key); setPopup(null); }}
                >
                  {key === 'category' ? 'In-contest' : 'Practice'}
                  <span style={{
                    fontSize: 10, fontWeight: 700, borderRadius: 9, padding: '0 5px',
                    minWidth: 16, textAlign: 'center', display: 'inline-block',
                    background: active ? 'rgba(128,128,128,0.18)' : (theme.isDark ? '#3a3a3a' : '#d8d8d8'),
                    color: active ? theme.btnActiveText : theme.muted,
                  }}>{sourceCounts[key]}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div ref={filterRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MenuButton
                label="Filter"
                title={activeFilter ? filterTitle(settings) : 'Filter'}
                active={openMenu === 'filter' || activeFilter}
                theme={theme}
                icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 4h12M4 8h8M6 12h4" /></svg>}
                onClick={() => {
                  setTopicPickerOpen(false);
                  setSearch('');
                  setOpenMenu(openMenu === 'filter' ? null : 'filter');
                }}
              />
              {openMenu === 'filter' && !topicPickerOpen && (
                <FilterMenu
                  settings={settings}
                  theme={theme}
                  onChange={setPatch}
                  onOpenTopics={() => { setTopicPickerOpen(true); setOpenMenu(null); setSearch(''); }}
                />
              )}
              {topicPickerOpen && (
                <TopicPicker
                  theme={theme}
                  search={search}
                  setSearch={setSearch}
                  tags={visibleTags}
                  availableTags={availableTags}
                  selected={settings.tagFilters}
                  onToggle={toggleTag}
                  onClear={() => setPatch({ tagFilters: [] })}
                  onDone={() => { setTopicPickerOpen(false); setOpenMenu('filter'); setSearch(''); }}
                  onEscape={() => { setTopicPickerOpen(false); setOpenMenu('filter'); setSearch(''); }}
                />
              )}
            </div>

            <div ref={sortRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MenuButton
                label="Sort"
                title={sort === 'rating' ? 'Sort: by rating' : 'Sort: by errors'}
                active={openMenu === 'sort' || sort === 'rating'}
                theme={theme}
                icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v10M5 13l-2-2M5 13l2-2M11 13V3M11 3l-2 2M11 3l2 2" /></svg>}
                onClick={() => { setTopicPickerOpen(false); setSearch(''); setOpenMenu(openMenu === 'sort' ? null : 'sort'); }}
              />
              {openMenu === 'sort' && (
                <SortMenu
                  sort={sort}
                  theme={theme}
                  onChange={next => { setSort(next); setPatch({ sortMode: next }); setOpenMenu(null); }}
                />
              )}
            </div>

            <div ref={viewRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <MenuButton
                label="View"
                title={viewTitle(settings)}
                active={openMenu === 'view' || activeView}
                theme={theme}
                icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2" /></svg>}
                onClick={() => { setTopicPickerOpen(false); setSearch(''); setOpenMenu(openMenu === 'view' ? null : 'view'); }}
              />
              {openMenu === 'view' && <ViewMenu settings={settings} theme={theme} onChange={setPatch} />}
            </div>
          </div>
        </div>
        {settings.tagFilters.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', padding: '5px 12px',
            borderBottom: `1px solid ${theme.borderLighter}`, minHeight: 32,
            gap: 5, flexWrap: 'wrap', flexShrink: 0,
          }}>
            {settings.tagFilters.map(tag => (
              <span
                key={tag}
                className="cfpm-tag-pill"
                title={`Remove: ${tag}`}
                style={{
                  background: theme.isDark ? '#16244a' : '#dbeafe',
                  color: theme.isDark ? '#93c5fd' : '#1e40af',
                  border: `1px solid ${theme.isDark ? '#2d5ba6' : '#93c5fd'}`,
                }}
                onClick={() => toggleTag(tag)}
              >
                <span>{tag}</span><span style={{ opacity: 0.5, fontSize: 9, marginLeft: 1 }}>✕</span>
              </span>
            ))}
          </div>
        )}

        <div className="cfpm-list-scroll" style={{
          flex: `0 0 ${LIST_HEIGHT}`, overflowY: 'auto', height: LIST_HEIGHT, width: '100%', boxSizing: 'border-box',
        }}>
          {!sorted.length ? (
            <div style={{ padding: '24px 14px', color: theme.emptyText, fontStyle: 'italic', fontSize: 13, textAlign: 'center' }}>
              {settings.tagFilters.length || settings.ratingMin || settings.ratingMax || settings.solvedOnly || settings.hideAC
                ? 'No problems match the selected filters.'
                : 'No problems with errors found.'}
            </div>
          ) : (
            <>
              <ProblemsHeader theme={theme} hideRatings={settings.hideRatings} />
              {sorted.map((problem, index) => (
                <ProblemRow
                  key={`${problem.contestId}-${problem.index}`}
                  problem={problem}
                  index={index}
                  theme={theme}
                  source={source}
                  hideTags={settings.hideTags}
                  hideRatings={settings.hideRatings}
                  solvedBy={solvedCounts === null ? undefined : (solvedCounts[problem.pid] ?? null)}
                  onSubmissions={openSubmissions}
                />
              ))}
            </>
          )}
        </div>

        {popup && (
          <SubmissionPopup
            label="All"
            ids={popup.ids}
            verdicts={popup.verdicts}
            contestId={popup.contestId}
            badgeBg={theme.btnActiveBg}
            badgeFg={theme.btnActiveText}
            timingMap={modeData.submissionTimingMap}
            contestMap={modeData.submissionContestMap}
            theme={theme}
            crossContest={popup.contestId <= 0}
            crossContestSort={popupSort}
            anchor={popup.anchor}
            problemIndex={popup.problemIndex}
            problemName={popup.problemName}
            problemContestName={popup.problemContestName}
            onCrossContestSortChange={onPopupSortChange}
            onClose={() => setPopup(null)}
          />
        )}
      </div>
    </div>
  );
}

function filterTitle(settings: ExtensionSettings) {
  const parts: string[] = [];
  if (settings.minAttempts !== 1) parts.push(`Min ${settings.minAttempts} errors`);
  if (settings.ratingMin !== '' || settings.ratingMax !== '') parts.push(`Rating ${settings.ratingMin || 'any'}–${settings.ratingMax || 'any'}`);
  if (settings.tagFilters.length) parts.push(`${settings.tagFilters.length} topic${settings.tagFilters.length > 1 ? 's' : ''}`);
  return parts.length ? `Filters: ${parts.join(', ')}` : 'Filter';
}

function viewTitle(settings: ExtensionSettings) {
  const parts: string[] = [];
  if (settings.hideAC) parts.push('Unsolved only');
  if (settings.solvedOnly) parts.push('Solved only');
  if (settings.hideTags) parts.push('Tags hidden');
  if (settings.hideRatings) parts.push('Ratings hidden');
  return parts.length ? parts.join(' · ') : 'View options';
}

function MenuButton({ theme, active, title, icon, label, onClick }: {
  theme: Theme; active: boolean; title: string; icon: ReactNode; label?: string; onClick: () => void;
}) {
  return (
    <button
      className={label ? 'cfpm-pill-btn' : 'cfpm-icon-btn'}
      title={title}
      style={{
        background: active ? theme.btnActiveBg : theme.btnBg,
        color: active ? theme.btnActiveText : theme.muted,
        border: `1px solid ${active ? theme.btnActiveBorder : theme.btnBorder}`,
        gap: label ? 6 : 0,
      }}
      onClick={event => { event.stopPropagation(); onClick(); }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

function FilterMenu({ settings, theme, onChange, onOpenTopics }: {
  settings: ExtensionSettings; theme: Theme; onChange: (patch: Partial<ExtensionSettings>) => void; onOpenTopics: () => void;
}) {
  const ratingClear = settings.ratingMin !== '' || settings.ratingMax !== '';
  return (
    <div
      id="cfpm-filter-dd"
      style={{
        background: theme.dropdownBg, border: `1px solid ${theme.dropdownBorder}`,
        overflow: 'hidden', display: 'flex', position: 'absolute',
        top: 'calc(100% + 6px)', right: 0, zIndex: 10000,
        borderRadius: 6, flexDirection: 'column', minWidth: 260, maxWidth: 300,
        boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.08)',
      }}
      onClick={event => event.stopPropagation()}
    >
      <div style={{
        padding: '10px 14px 8px', fontSize: 11, fontWeight: 600, color: theme.mutedStrong,
        borderBottom: `1px solid ${theme.dropdownBorder}`, background: theme.dropdownSection,
      }}>Filters</div>

      <div style={{ display: 'flex', flexDirection: 'column', padding: '9px 12px', borderBottom: `1px solid ${theme.dropdownBorder}`, gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 12, color: theme.text, whiteSpace: 'nowrap' }}>Min. wrong attempts</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <button className="cfpm-step-btn" style={{ background: theme.btnBg, border: `1px solid ${theme.btnBorder}`, color: theme.text }} disabled={settings.minAttempts <= 1} onClick={() => onChange({ minAttempts: Math.max(1, settings.minAttempts - 1) })}>
              <svg width="8" height="2" viewBox="0 0 8 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="0" y1="1" x2="8" y2="1" /></svg>
            </button>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 28, height: 24, fontSize: 13, fontWeight: 700, color: theme.text, borderRadius: 4, background: theme.inputBg, border: `1px solid ${theme.btnBorder}` }}>{settings.minAttempts}</span>
            <button className="cfpm-step-btn" style={{ background: theme.btnBg, border: `1px solid ${theme.btnBorder}`, color: theme.text }} disabled={settings.minAttempts >= 99} onClick={() => onChange({ minAttempts: Math.min(99, settings.minAttempts + 1) })}>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="0" x2="4" y2="8" /><line x1="0" y1="4" x2="8" y2="4" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '9px 12px', borderBottom: `1px solid ${theme.dropdownBorder}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: theme.text, whiteSpace: 'nowrap', flexShrink: 0 }}>Difficulty</span>
          <input className="cfpm-rating-input" type="number" min="800" max="3500" step="100" placeholder="min" value={settings.ratingMin}
            style={{ width: 58, height: 26, padding: '0 6px', borderRadius: 4, border: `1px solid ${theme.inputBorder}`, background: theme.inputBg, color: theme.inputText, fontSize: 12, fontWeight: 600, textAlign: 'center', fontFamily: theme.fontFamily, outline: 'none', boxSizing: 'border-box' }}
            onClick={e => e.stopPropagation()} onChange={e => onChange({ ratingMin: e.target.value })} />
          <span style={{ color: theme.muted, fontSize: 13, flexShrink: 0 }}>—</span>
          <input className="cfpm-rating-input" type="number" min="800" max="3500" step="100" placeholder="max" value={settings.ratingMax}
            style={{ width: 58, height: 26, padding: '0 6px', borderRadius: 4, border: `1px solid ${theme.inputBorder}`, background: theme.inputBg, color: theme.inputText, fontSize: 12, fontWeight: 600, textAlign: 'center', fontFamily: theme.fontFamily, outline: 'none', boxSizing: 'border-box' }}
            onClick={e => e.stopPropagation()} onChange={e => onChange({ ratingMax: e.target.value })} />
          {ratingClear && <button style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: 0, outline: 'none', color: theme.accentBlue, marginLeft: 'auto' }} onClick={e => { e.stopPropagation(); onChange({ ratingMin: '', ratingMax: '' }); }}>Clear</button>}
        </div>
      </div>

      <div style={{ padding: '9px 12px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: theme.text, flex: 1, fontWeight: 500 }}>Topics</span>
          {settings.tagFilters.length > 0 && <button style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: 0, outline: 'none', color: theme.accentBlue }} onClick={e => { e.stopPropagation(); onChange({ tagFilters: [] }); }}>Clear</button>}
          <button
            className="cfpm-add-topic-btn"
            style={{ background: theme.btnBg, border: `1px solid ${theme.btnBorder}`, color: theme.btnText, cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onOpenTopics(); }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="4.5" y1="1" x2="4.5" y2="8" /><line x1="1" y1="4.5" x2="8" y2="4.5" /></svg>&nbsp;Add tag
          </button>
        </div>
        {settings.tagFilters.length > 0 && (
          <div className="cfpm-filter-tag-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 0, marginTop: 7 }}>
            {settings.tagFilters.map(tag => (
              <span key={tag} className="cfpm-filter-tag-pill" title={`Remove: ${tag}`}
                style={{ background: theme.isDark ? '#16244a' : '#dbeafe', color: theme.isDark ? '#93c5fd' : '#1e40af', border: `1px solid ${theme.isDark ? '#2d5ba6' : '#93c5fd'}` }}
                onClick={e => { e.stopPropagation(); onChange({ tagFilters: settings.tagFilters.filter(item => item !== tag) }); }}
              >
                <span>{tag}</span><span className="cfpm-filter-tag-pill-x">✕</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SortMenu({ sort, theme, onChange }: { sort: 'errors' | 'rating'; theme: Theme; onChange: (sort: 'errors' | 'rating') => void }) {
  return (
    <div id="cfpm-sort-dd" style={{
      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 10000,
      background: theme.dropdownBg, border: `1px solid ${theme.dropdownBorder}`,
      borderRadius: 7, overflow: 'hidden', minWidth: 190,
      boxShadow: '0 6px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07)',
    }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '10px 14px 8px', fontSize: 11, fontWeight: 600, color: theme.mutedStrong, borderBottom: `1px solid ${theme.dropdownBorder}`, background: theme.dropdownSection }}>Sort by</div>
      {[
        ['errors', 'Wrong attempts', 'Most errors first'],
        ['rating', 'Rating', 'Highest rated first'],
      ].map(([key, label, desc]) => {
        const active = sort === key;
        return (
          <div key={key} className="cfpm-sort-opt"
            style={{ background: active ? (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') : 'transparent', color: theme.text }}
            onClick={() => onChange(key as 'errors' | 'rating')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: active ? 700 : 600, color: active ? theme.mutedStrong : theme.text }}>{label}</div>
              <div style={{ fontSize: 11, color: theme.muted }}>{desc}</div>
            </div>
            {active && <span style={{ color: theme.mutedStrong, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>✓</span>}
          </div>
        );
      })}
    </div>
  );
}

function ViewMenu({ settings, theme, onChange }: { settings: ExtensionSettings; theme: Theme; onChange: (patch: Partial<ExtensionSettings>) => void }) {
  const opts = [
    { label: 'Unsolved only', desc: 'Hide already-solved problems', active: settings.hideAC, patch: (v: boolean) => ({ hideAC: v, solvedOnly: v ? false : settings.solvedOnly }) },
    { label: 'Solved only', desc: 'Show only solved problems', active: settings.solvedOnly, patch: (v: boolean) => ({ solvedOnly: v, hideAC: v ? false : settings.hideAC }) },
    { label: 'Hide topic tags', desc: "Don't show topic tags", active: settings.hideTags, patch: (v: boolean) => ({ hideTags: v }) },
    { label: 'Hide ratings', desc: "Don't show difficulty ratings", active: settings.hideRatings, patch: (v: boolean) => ({ hideRatings: v }) },
  ];
  return (
    <div id="cfpm-view-dd" style={{
      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 10000,
      background: theme.dropdownBg, border: `1px solid ${theme.dropdownBorder}`,
      borderRadius: 7, overflow: 'hidden', minWidth: 210,
      boxShadow: '0 6px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07)',
    }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '10px 14px 8px', fontSize: 11, fontWeight: 600, color: theme.mutedStrong, borderBottom: `1px solid ${theme.dropdownBorder}`, background: theme.dropdownSection }}>View options</div>
      {opts.map(option => (
        <div key={option.label} className="cfpm-view-opt"
          style={{ background: option.active ? (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') : 'transparent', color: theme.text }}
          onClick={() => onChange(option.patch(!option.active) as Partial<ExtensionSettings>)}
        >
          <span style={{
            width: 14, height: 14, borderRadius: 3, flexShrink: 0, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', boxSizing: 'border-box',
            border: `1.5px solid ${option.active ? theme.mutedStrong : theme.btnBorder}`,
            background: option.active ? theme.mutedStrong : 'transparent',
          }}>{option.active ? '✓' : ''}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: option.active ? 700 : 600, color: option.active ? theme.mutedStrong : theme.text }}>{option.label}</div>
            <div style={{ fontSize: 11, color: theme.muted }}>{option.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TopicPicker({ theme, search, setSearch, tags, availableTags, selected, onToggle, onClear, onDone, onEscape }: {
  theme: Theme; search: string; setSearch: (value: string) => void; tags: string[]; availableTags: string[];
  selected: string[]; onToggle: (tag: string) => void; onClear: () => void; onDone: () => void; onEscape: () => void;
}) {
  return (
    <div id="cfpm-topic-picker" style={{
      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 10001,
      background: theme.dropdownBg, border: `1px solid ${theme.dropdownBorder}`,
      borderRadius: 6, minWidth: 260, maxWidth: 300, overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.08)',
      display: 'flex', flexDirection: 'column',
    }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '8px 12px 7px', fontSize: 12, fontWeight: 600, color: theme.mutedStrong, borderBottom: `1px solid ${theme.dropdownBorder}`, background: theme.dropdownSection, flexShrink: 0 }}>Filter by topic</div>
      <div className="cfpm-tag-search-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${theme.dropdownBorder}`, background: theme.dropdownSection, flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke={theme.muted} strokeWidth="1.6" strokeLinecap="round" style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}><circle cx="6" cy="6" r="4" /><path d="M10 10l2.5 2.5" /></svg>
        <input autoFocus className="cfpm-tag-search" type="text" placeholder="Search topics…" value={search}
          style={{ width: '100%', boxSizing: 'border-box', height: 30, padding: '0 10px 0 30px', fontSize: 12, fontFamily: theme.fontFamily, outline: 'none', border: 'none', background: 'transparent', color: theme.inputText }}
          onChange={e => setSearch(e.target.value)}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Escape') onEscape(); }}
        />
      </div>
      <div id="cfpm-tag-list" style={{ overflowY: 'auto', maxHeight: 110, flex: 1 }}>
        {tags.length ? tags.map(tag => {
          const active = selected.includes(tag);
          const available = availableTags.includes(tag);
          return (
            <div key={tag} className="cfpm-tag-opt"
              style={{
                background: active ? (theme.isDark ? '#16244a' : '#eff6ff') : 'transparent',
                color: available ? theme.text : theme.muted,
                opacity: available ? 1 : 0.55,
              }}
              onClick={() => onToggle(tag)}
            >
              <span className="cfpm-tag-check" style={{
                border: `1.5px solid ${active ? theme.mutedStrong : theme.btnBorder}`,
                background: active ? theme.mutedStrong : 'transparent',
              }}>{active ? '✓' : ''}</span>
              <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.4, fontWeight: active ? 600 : 400 }}>{tag}{!available ? ' (none here)' : ''}</span>
            </div>
          );
        }) : (
          <div style={{ padding: 12, color: theme.emptyText, fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
            {search.trim() ? 'No matching topics.' : 'No topics available.'}
          </div>
        )}
      </div>
      <div style={{
        borderTop: `1px solid ${theme.dropdownBorder}`, background: theme.dropdownSection,
        padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: theme.muted }}>{selected.length ? `${selected.length} selected` : ''}</span>
          {selected.length > 0 && (
            <button
              id="cfpm-topic-clear"
              style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: 0, outline: 'none', color: theme.accentBlue }}
              onClick={e => { e.stopPropagation(); onClear(); }}
            >Clear</button>
          )}
        </div>
        <button className="cfpm-pill-btn" style={{
          background: theme.btnActiveBg, color: theme.btnActiveText, border: `1px solid ${theme.btnActiveBorder}`,
          cursor: 'pointer', fontSize: 11, height: 26, padding: '0 14px', borderRadius: 4, fontWeight: 700,
        }} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/*
 * One fixed set of columns, shared by the header and every row so they
 * always line up - the same layout as the Codeforces problemset table:
 * # | Name | Rating | Solved by | Submissions | Status.
 */
function gridColumns(hideRatings: boolean): string {
  return hideRatings
    ? '80px minmax(0, 1fr) 96px 104px 88px'
    : '80px minmax(0, 1fr) 64px 96px 104px 88px';
}

/*
 * The Codeforces problemset table's own look. The light values are read off
 * the live table: 1px #e1e1e1 lines, #f8f8f8 on every other row starting with
 * the first, #d4edc9 for solved. In dark mode the extension's own theme
 * colors stand in.
 */
function tableLook(theme: Theme) {
  return theme.isDark
    ? { line: theme.borderLight, zebra: 'rgba(255,255,255,0.03)', head: theme.bg, solved: theme.solvedBadge, solvedText: theme.solvedBadgeText }
    : { line: '#e1e1e1', zebra: '#f8f8f8', head: '#ffffff', solved: '#d4edc9', solvedText: '#1b5e20' };
}

/* Links look like Codeforces links: blue and underlined, purple once visited (see .cfpm-prob-link). */
function linkStyle(theme: Theme): CSSProperties {
  return theme.isDark ? { color: theme.problemLink } : {};
}

/* Every submission of one problem, and what each one's verdict was. */
function collectSubmissions(problem: ProblemEntry, theme: Theme): { ids: number[]; verdicts: PopupVerdicts } {
  const look: Record<SubmissionVerdictKey, { label: string; bg: string; fg: string }> = {
    ac: { label: 'AC', bg: theme.solvedBadge, fg: theme.solvedBadgeText },
    wa: { label: 'WA', bg: theme.waBadge, fg: theme.waBadgeText },
    tle: { label: 'TLE', bg: theme.tleBg, fg: theme.tleFg },
    rte: { label: 'RTE', bg: theme.rteBg, fg: theme.rteFg },
    mle: { label: 'MLE', bg: theme.mleBg, fg: theme.mleFg },
    other: { label: 'Error', bg: theme.errBg, fg: theme.errFg },
  };

  const verdicts: PopupVerdicts = new Map();
  getProblemSubmissions(problem).forEach(({ id, verdict }) => verdicts.set(id, look[verdict]));

  return { ids: Array.from(verdicts.keys()), verdicts };
}

function ProblemsHeader({ theme, hideRatings }: { theme: Theme; hideRatings: boolean }) {
  const look = tableLook(theme);

  const cell: CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: theme.text,
    whiteSpace: 'nowrap',
    textAlign: 'center',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridColumns(hideRatings),
        alignItems: 'center',
        columnGap: 10,
        minHeight: 36,
        padding: '6px 10px 6px 15px',
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: look.head,
        borderBottom: `1px solid ${look.line}`,
        boxSizing: 'border-box',
      }}
    >
      <span style={cell}>#</span>
      <span style={cell}>Name</span>
      {!hideRatings && <span style={cell}>Rating</span>}
      <span style={cell} title="How many Codeforces users have solved this problem">Solved by</span>
      <span style={cell}>Submissions</span>
      <span style={cell}>Status</span>
    </div>
  );
}

function ProblemRow({
  problem,
  index,
  theme,
  source,
  hideTags,
  hideRatings,
  solvedBy,
  onSubmissions,
}: {
  problem: ProblemEntry;
  index: number;
  theme: Theme;
  source: FrictionSource;
  hideTags: boolean;
  hideRatings: boolean;
  /* undefined: not loaded yet; null: loaded but Codeforces has no figure for this problem. */
  solvedBy: number | null | undefined;
  onSubmissions: (
    event: MouseEvent<HTMLElement>,
    ids: number[],
    verdicts: PopupVerdicts,
    problem: ProblemEntry
  ) => void;
}) {
  const errors = totalErrors(problem);
  const look = tableLook(theme);
  const problemUrl = `https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`;
  const sourceLabel = source === 'category' ? 'in-contest' : 'practice';
  const { ids, verdicts } = collectSubmissions(problem, theme);
  const tagText = problem.tags.slice(0, 3).join(', ') + (problem.tags.length > 3 ? ` +${problem.tags.length - 3}` : '');

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: gridColumns(hideRatings),
    alignItems: 'center',
    columnGap: 10,
    minHeight: 36,
    padding: '4px 10px',
    boxSizing: 'border-box',
    /* Solved rows carry the same green edge Codeforces gives them. */
    borderLeft: `5px solid ${problem.solved ? look.solved : 'transparent'}`,
    borderTop: index > 0 ? `1px solid ${look.line}` : undefined,
    background: index % 2 === 0 ? look.zebra : 'transparent',
    width: '100%',
    fontSize: 13,
  };

  const link = linkStyle(theme);
  const centered: CSSProperties = { textAlign: 'center', whiteSpace: 'nowrap' };

  return (
    <div style={rowStyle}>
      {/* # */}
      <a
        className="cfpm-prob-link"
        href={problemUrl}
        target="_blank"
        rel="noopener"
        title={problem.contestName || undefined}
        style={{ ...link, ...centered }}
      >
        {problem.contestId}{problem.index}
      </a>

      {/* Name, with the topic tags quietly beside it */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <a
          className="cfpm-prob-link"
          href={problemUrl}
          target="_blank"
          rel="noopener"
          title={problem.name}
          style={{
            ...link,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '0 1 auto',
            minWidth: 0,
          }}
        >
          {problem.name}
        </a>

        {!hideTags && problem.tags.length > 0 && (
          <span
            title={problem.tags.join(', ')}
            style={{
              marginLeft: 'auto',
              color: theme.muted,
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: '0 1 auto',
              minWidth: 0,
              maxWidth: '45%',
            }}
          >
            {tagText}
          </span>
        )}
      </div>

      {/* Rating: plain bold, as on Codeforces */}
      {!hideRatings && (
        <span style={{ ...centered, fontSize: 12, fontWeight: 700, color: problem.rating ? theme.text : theme.muted }}>
          {problem.rating ?? '—'}
        </span>
      )}

      {/* Solved by */}
      <span
        style={{ ...centered, fontSize: 12, color: theme.text, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
        title={typeof solvedBy === 'number' ? `${solvedBy} users have solved this problem` : undefined}
      >
        {typeof solvedBy === 'number' ? (
          <>
            <svg width="12" height="13" viewBox="0 0 12 13" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="3.6" r="2.7" fill={theme.isDark ? '#7aabff' : '#3d6db5'} />
              <path d="M0.8 12.4c0-3 2.3-4.9 5.2-4.9s5.2 1.9 5.2 4.9z" fill={theme.isDark ? '#7aabff' : '#3d6db5'} />
            </svg>
            {`x${solvedBy}`}
          </>
        ) : solvedBy === undefined ? '…' : '—'}
      </span>

      {/* Submissions: one count, the list opens on click */}
      <span style={centered}>
        <button
          type="button"
          className="cfpm-prob-link"
          disabled={!ids.length}
          title={
            ids.length
              ? `${errors} wrong, ${problem.acIds.length} accepted (${sourceLabel}) - click to view all ${ids.length}`
              : 'No submissions to show'
          }
          style={{
            ...link,
            background: 'none',
            border: 0,
            padding: 0,
            font: 'inherit',
            fontWeight: 700,
            cursor: ids.length ? 'pointer' : 'default',
          }}
          onClick={event => onSubmissions(event, ids, verdicts, problem)}
        >
          {ids.length}
        </button>
      </span>

      {/* Status: a solved row's cell is filled green, like Codeforces' solved marker */}
      <span
        title={problem.solved ? (problem.acIds.length ? 'Solved' : "Solved (but that accepted submission isn't included in the dates or contest type you're currently viewing)") : 'Not yet solved'}
        style={{
          alignSelf: 'stretch',
          margin: '-4px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: problem.solved ? 700 : 400,
          color: problem.solved ? look.solvedText : theme.muted,
          background: problem.solved ? look.solved : 'transparent',
        }}
      >
        {problem.solved ? 'Solved' : 'Unsolved'}
      </span>
    </div>
  );
}
