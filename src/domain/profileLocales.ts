/*
 * How a Codeforces profile page words its "Last visit" line, per
 * site language.
 *
 * Codeforces serves each page in the language the visitor chose
 * (the flags in its header: English and Russian). The extension
 * must NOT switch that language (that would change the user's own
 * setting), so it reads the page in whatever language it arrives in.
 *
 * Supporting another language is one new entry below. Until a
 * language is listed, its pages are answered "unknown" (never
 * "offline"), so an unsupported language can never show wrong data.
 */
export interface ProfileLocale {
  id: string;

  /* The label in front of the value, without the colon. */
  lastVisit: string;

  /* What the value says for someone who is online right now (lower case). */
  online: readonly string[];

  /* The label of the next line; used to stop reading the value. */
  registered: string;
}

export const PROFILE_LOCALES: readonly ProfileLocale[] = [
  {
    id: 'en',
    lastVisit: 'Last visit',
    online: ['online now'],
    registered: 'Registered',
  },
  {
    id: 'ru',
    lastVisit: 'Последнее посещение',
    online: ['сейчас на сайте'],
    registered: 'Зарегистрирован',
  },
];

/* Enough text after the label to hold its value, tags included. */
export const LAST_VISIT_CONTEXT_CHARS = 400;

/* A space as it may appear in HTML text: plain, tab/newline, or an entity. */
const SPACE = String.raw`(?:\s|&nbsp;|&#160;|&#xa0;)`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/* "Last visit" -> "Last<space>+visit", so a non-breaking space still matches. */
function phrase(text: string): string {
  return text.split(' ').map(escapeRegExp).join(`${SPACE}+`);
}

const LABEL_PATTERN = new RegExp(
  `(?:${PROFILE_LOCALES.map(locale => phrase(locale.lastVisit)).join('|')})${SPACE}*:`,
  'i',
);

/* Where the value can end: another list item, the end of the list, or the next line's label. */
const VALUE_END_PATTERN = new RegExp(
  `<li[\\s>]|</li|</ul|${PROFILE_LOCALES.map(locale => phrase(locale.registered)).join('|')}`,
  'gi',
);

export interface LastVisitLabel {
  /* Where the label starts, and where the text after its colon begins. */
  index: number;
  end: number;
}

export function findLastVisitLabel(html: string): LastVisitLabel | null {
  const match = LABEL_PATTERN.exec(html);

  return match
    ? { index: match.index, end: match.index + match[0].length }
    : null;
}

/* Tags removed, entities turned into spaces, whitespace collapsed, lower case. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/*
 * The text of the "Last visit" value. Tags are removed first (so a
 * date in a title="" attribute can't leak in), and reading stops at
 * the first place the value can end (see VALUE_END_PATTERN) that comes
 * after some text. A label that sits alone in its own list item
 * therefore still finds its value in the next one, while a value
 * never runs on into the neighbouring line.
 */
export function readLastVisitValue(html: string, end: number): string {
  const region = html.slice(end, end + LAST_VISIT_CONTEXT_CHARS);

  VALUE_END_PATTERN.lastIndex = 0;

  for (let match = VALUE_END_PATTERN.exec(region); match; match = VALUE_END_PATTERN.exec(region)) {
    const value = plainText(region.slice(0, match.index));

    if (value !== '') {
      return value;
    }
  }

  return plainText(region);
}

export function isOnlineValue(value: string): boolean {
  return PROFILE_LOCALES.some(locale =>
    locale.online.some(text => value.includes(text)),
  );
}

/*
 * Offline values are always a count of time ("18 minutes ago",
 * "4 дня назад"). A value that is neither "online" nor like that is
 * something we don't understand, which must not be read as "offline".
 */
export function looksLikeElapsedTime(value: string): boolean {
  return /\d/.test(value) || /\bago\b/.test(value) || value.includes('назад');
}
