/*
 * Problem lists the user brings in from a file: a list is just an ordered
 * set of Codeforces problems ("<contestId>-<index>", the same key as
 * ProblemEntry.pid). Nothing about a list is shipped with the extension;
 * the file the user picks is the only source.
 */

export const MAX_LISTS = 10;
export const MAX_PROBLEMS_PER_LIST = 1000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_LIST_NAME_LENGTH = 60;

const MAX_PROBLEM_NAME_LENGTH = 200;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 60;

/* What the list remembers about a problem, taken from Codeforces' problem list. */
export interface ListProblemMeta {
  /* Empty when Codeforces' problem list does not know the problem (a gym problem, say). */
  name: string;
  rating: number | null;
  tags: string[];
}

export interface StoredProblemList {
  id: string;
  name: string;
  pids: string[];
  /* A pid with an entry here has been looked up; one without is still to be looked up. */
  meta: Record<string, ListProblemMeta>;
}

export interface ParsedProblemList {
  pids: string[];
  /* Lines (or JSON items) that held no problem. */
  ignored: number;
  /* More problems than MAX_PROBLEMS_PER_LIST: the rest was dropped. */
  truncated: boolean;
}

const PID_PATTERN = /^\d{1,6}-[A-Z][A-Z0-9]{0,3}$/;

const URL_PATTERN =
  /(?:problemset\/problem|contest|gym)\/(\d{1,6})\/(?:problem\/)?([A-Za-z][A-Za-z0-9]{0,3})(?![A-Za-z0-9])/i;

const ID_PATTERN = /^(\d{1,6})[\s\-/_:.]?([A-Za-z][A-Za-z0-9]{0,3})$/;

function makePid(contestId: string | number, index: string): string | null {
  const id = typeof contestId === 'number' ? contestId : Number.parseInt(contestId, 10);

  if (!Number.isInteger(id) || id < 1 || id > 999_999) {
    return null;
  }

  const pid = `${id}-${index.toUpperCase()}`;

  return PID_PATTERN.test(pid) ? pid : null;
}

function stripWrapping(cell: string): string {
  return cell.trim().replace(/^[\s"'`([{<]+|[\s"'`)\]}>.,;]+$/g, '');
}

/* One line of text (or one JSON string): a link or an id such as 4A, 4-A, 4/A. */
function pidFromText(line: string): string | null {
  const url = URL_PATTERN.exec(line);

  if (url) {
    return makePid(url[1], url[2]);
  }

  const cells = line.split(/[,;\t|]/);

  for (const cell of cells) {
    const match = ID_PATTERN.exec(stripWrapping(cell));

    if (match) {
      const pid = makePid(match[1], match[2]);

      if (pid) {
        return pid;
      }
    }
  }

  const whole = ID_PATTERN.exec(stripWrapping(line));

  return whole ? makePid(whole[1], whole[2]) : null;
}

function pidFromJsonItem(item: unknown): string | null {
  if (typeof item === 'string') {
    return pidFromText(item);
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const { contestId, index } = record;

  if (
    (typeof contestId === 'number' || (typeof contestId === 'string' && /^\d{1,6}$/.test(contestId))) &&
    typeof index === 'string'
  ) {
    return makePid(contestId, index.trim());
  }

  for (const key of ['problem', 'pid', 'id', 'url', 'link']) {
    const value = record[key];

    if (typeof value === 'string' || (value && typeof value === 'object')) {
      const pid = pidFromJsonItem(value);

      if (pid) {
        return pid;
      }
    }
  }

  return null;
}

function jsonItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    const problems = (value as Record<string, unknown>).problems;

    if (Array.isArray(problems)) {
      return problems;
    }
  }

  return null;
}

/*
 * Reads the text of a list file. It accepts, one problem per line or per
 * JSON item: problem links (problemset/problem, contest, gym), ids such as
 * 4A / 4-A / 4/A, CSV or TSV rows holding one of those, and JSON arrays of
 * links, ids or {contestId, index} objects (also under a "problems" key).
 * Duplicates are dropped, the first position wins. Never throws.
 */
export function parseProblemListText(text: string): ParsedProblemList {
  const found: string[] = [];
  const seen = new Set<string>();
  let ignored = 0;

  const add = (pid: string | null): void => {
    if (!pid) {
      ignored += 1;

      return;
    }

    if (!seen.has(pid)) {
      seen.add(pid);
      found.push(pid);
    }
  };

  const trimmed = text.replace(/^﻿/, '').trim();
  let items: unknown[] | null = null;

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      items = jsonItems(JSON.parse(trimmed));
    } catch {
      items = null;
    }
  }

  if (items) {
    for (const item of items) {
      add(pidFromJsonItem(item));
    }
  } else {
    for (const rawLine of trimmed.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();

      if (line === '' || line.startsWith('#') || line.startsWith('//')) {
        continue;
      }

      add(pidFromText(line));
    }
  }

  return {
    pids: found.slice(0, MAX_PROBLEMS_PER_LIST),
    ignored,
    truncated: found.length > MAX_PROBLEMS_PER_LIST,
  };
}

/* The file's name without its extension, as the list's name. */
export function listNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]*$/, '').replace(/[\r\n\t]+/g, ' ').trim();

  return (base || 'Imported list').slice(0, MAX_LIST_NAME_LENGTH);
}

/*
 * Picks the wanted problems out of problemset.problems' result. Anything
 * that does not look like a problem entry is skipped, not trusted.
 */
export function parseProblemMetadata(
  result: unknown,
  wanted: ReadonlySet<string>,
): Record<string, ListProblemMeta> {
  const out: Record<string, ListProblemMeta> = {};
  const problems = (result as { problems?: unknown } | null | undefined)?.problems;

  if (!Array.isArray(problems)) {
    return out;
  }

  for (const entry of problems) {
    if (!entry || typeof entry !== 'object') continue;

    const { contestId, index, name, rating, tags } = entry as Record<string, unknown>;

    if (typeof contestId !== 'number' || !Number.isInteger(contestId) || typeof index !== 'string' || typeof name !== 'string') {
      continue;
    }

    const pid = `${contestId}-${index}`;

    if (!wanted.has(pid)) continue;

    out[pid] = {
      name: name.slice(0, MAX_PROBLEM_NAME_LENGTH),
      rating: typeof rating === 'number' && Number.isFinite(rating) ? rating : null,
      tags: Array.isArray(tags)
        ? tags
            .filter((tag): tag is string => typeof tag === 'string')
            .slice(0, MAX_TAGS)
            .map(tag => tag.slice(0, MAX_TAG_LENGTH))
        : [],
    };
  }

  return out;
}

function normalizeMeta(value: unknown): ListProblemMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const { name, rating, tags } = value as Record<string, unknown>;

  if (typeof name !== 'string' || name.length > MAX_PROBLEM_NAME_LENGTH) {
    return null;
  }

  if (rating !== null && (typeof rating !== 'number' || !Number.isFinite(rating))) {
    return null;
  }

  if (
    !Array.isArray(tags) ||
    tags.length > MAX_TAGS ||
    !tags.every(tag => typeof tag === 'string' && tag.length <= MAX_TAG_LENGTH)
  ) {
    return null;
  }

  return { name, rating: rating as number | null, tags: tags as string[] };
}

/* Stored lists come from localStorage: whatever does not match the shape is dropped, never trusted. */
export function normalizeStoredLists(raw: unknown): StoredProblemList[] {
  const lists = (raw as { lists?: unknown } | null | undefined)?.lists;

  if (!Array.isArray(lists)) {
    return [];
  }

  const out: StoredProblemList[] = [];
  const ids = new Set<string>();

  for (const item of lists) {
    if (out.length >= MAX_LISTS) break;
    if (!item || typeof item !== 'object') continue;

    const { id, name, pids, meta } = item as Record<string, unknown>;

    if (typeof id !== 'string' || id === '' || id.length > 40 || ids.has(id)) continue;
    if (typeof name !== 'string' || name === '' || name.length > MAX_LIST_NAME_LENGTH) continue;
    if (!Array.isArray(pids) || pids.length === 0 || pids.length > MAX_PROBLEMS_PER_LIST) continue;
    if (!pids.every(pid => typeof pid === 'string' && PID_PATTERN.test(pid))) continue;
    if (new Set(pids).size !== pids.length) continue;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;

    const allowed = new Set(pids as string[]);
    const cleanMeta: Record<string, ListProblemMeta> = {};

    for (const [pid, value] of Object.entries(meta as Record<string, unknown>)) {
      const clean = allowed.has(pid) ? normalizeMeta(value) : null;

      if (clean) {
        cleanMeta[pid] = clean;
      }
    }

    ids.add(id);
    out.push({ id, name, pids: pids as string[], meta: cleanMeta });
  }

  return out;
}
