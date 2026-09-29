export interface Theme {
  isDark: boolean;
  bg: string;
  text: string;
  fontFamily: string;
  border: string;
  borderLight: string;
  borderLighter: string;
  muted: string;
  headingText: string;
  tableHeaderText: string;
  tableCellText: string;
  accentBlue: string;
  mutedStrong: string;
  btnBg: string;
  btnText: string;
  btnBorder: string;
  btnActiveBg: string;
  btnActiveText: string;
  btnActiveBorder: string;
  emptyText: string;
  inputBg: string;
  inputText: string;
  inputBorder: string;
  dropdownBg: string;
  dropdownBorder: string;
  dropdownSection: string;
  problemLink: string;
  solvedBadge: string;
  solvedBadgeText: string;
  waBadge: string;
  waBadgeText: string;
  tleBg: string;
  tleFg: string;
  rteBg: string;
  rteFg: string;
  mleBg: string;
  mleFg: string;
  errBg: string;
  errFg: string;
}

function detectDarkMode(): boolean {
  const hasDarkClass =
    document.documentElement.classList.contains('dark') ||
    document.documentElement.classList.contains('dark-mode') ||
    document.body.classList.contains('dark') ||
    document.body.classList.contains('dark-mode');
  if (hasDarkClass) return true;
  const containers = ['.info', '.datatable', '.roundbox', '#pageContent', '.second-level-menu-list', 'body'];
  for (const selector of containers) {
    const container = document.querySelector(selector);
    if (!container) continue;
    const bg = window.getComputedStyle(container).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      const rgb = bg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const brightness = (Number(rgb[0]) * 299 + Number(rgb[1]) * 587 + Number(rgb[2]) * 114) / 1000;
        if (brightness < 128) return true;
      }
    }
  }
  return false;
}

function getBackground(): string {
  for (const selector of ['.info', '.roundbox', '#pageContent']) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const background = window.getComputedStyle(element).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
  }
  const bodyBackground = window.getComputedStyle(document.body).backgroundColor;
  if (bodyBackground && bodyBackground !== 'rgba(0, 0, 0, 0)' && bodyBackground !== 'transparent') return bodyBackground;
  return detectDarkMode() ? '#1a1a1a' : '#ffffff';
}

function getBorderColor(): string {
  for (const selector of ['.roundbox', '.info', '.datatable']) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const border = window.getComputedStyle(element).borderColor;
    if (border && border !== 'rgba(0, 0, 0, 0)' && border !== 'transparent') return border;
  }
  return detectDarkMode() ? '#444' : '#d4d4d4';
}

function getFontFamily(): string {
  for (const selector of ['.roundbox', '.info', '#pageContent']) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const fontFamily = window.getComputedStyle(element).fontFamily;
    if (fontFamily) return fontFamily;
  }
  const bodyFontFamily = window.getComputedStyle(document.body).fontFamily;
  if (bodyFontFamily) return bodyFontFamily;
  /*
   * Verified against a live codeforces.com page's
   * computed body font-family - used only if every
   * selector above comes back empty.
   */
  return 'Verdana, Arial, sans-serif';
}

export function createTheme(): Theme {
  const isDark = detectDarkMode();
  const active = isDark
    ? { bg: '#323645', text: '#e8e8e8', border: '#6870a0' }
    : { bg: '#e2e6ef', text: '#1a1a2e', border: '#7a84a8' };

  return {
    isDark,
    bg: getBackground(),
    text: isDark ? '#e8e8e8' : '#000000',
    fontFamily: getFontFamily(),
    border: getBorderColor(),
    borderLight: isDark ? '#3a3a3a' : '#e8e8e8',
    borderLighter: isDark ? '#2e2e2e' : '#f2f2f2',
    muted: isDark ? '#999' : '#777',
    mutedStrong: isDark ? '#bbb' : '#555',
    headingText: isDark ? '#ddd' : '#222',
    tableHeaderText: isDark ? '#bbb' : '#666',
    tableCellText: isDark ? '#ccc' : '#555',
    accentBlue: isDark ? '#1652d6' : '#0000cc',
    btnBg: isDark ? '#2e2e2e' : '#f4f4f4',
    btnText: isDark ? '#ccc' : '#444',
    btnBorder: isDark ? '#484848' : '#d0d0d0',
    btnActiveBg: active.bg,
    btnActiveText: active.text,
    btnActiveBorder: active.border,
    emptyText: isDark ? '#666' : '#aaa',
    inputBg: isDark ? '#242424' : '#fff',
    inputText: isDark ? '#ddd' : '#333',
    inputBorder: isDark ? '#484848' : '#d0d0d0',
    dropdownBg: isDark ? '#202020' : '#ffffff',
    dropdownBorder: isDark ? '#383838' : '#e0e0e0',
    dropdownSection: isDark ? '#1a1a1a' : '#f9f9f9',
    problemLink: isDark ? '#7aabff' : '#0000cc',
    solvedBadge: isDark ? '#1a3320' : '#e6f4ea',
    solvedBadgeText: isDark ? '#4caf50' : '#276221',
    waBadge: isDark ? '#331a1a' : '#fdecea',
    waBadgeText: isDark ? '#f48080' : '#b71c1c',
    tleBg: isDark ? '#2a2000' : '#fff8e1',
    tleFg: isDark ? '#ffd54f' : '#b45309',
    rteBg: isDark ? '#1a1a2e' : '#ede7f6',
    rteFg: isDark ? '#9fa8da' : '#4527a0',
    mleBg: isDark ? '#002828' : '#e0f2f1',
    mleFg: isDark ? '#4db6ac' : '#00695c',
    errBg: isDark ? '#2a2a2a' : '#f0f0f0',
    errFg: isDark ? '#999' : '#555',
  };
}
