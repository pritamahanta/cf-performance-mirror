import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PerformanceEngine } from '../domain/performanceEngine';
import {
  MAX_FILE_BYTES,
  MAX_LISTS,
  MAX_PROBLEMS_PER_LIST,
  extractProblemLinks,
  listNameFromFile,
  listNameFromUrl,
  noProblemsAtUrlMessage,
  normalizeListUrl,
  parseProblemListText,
  urlFailureMessage,
  validateListUrl,
} from '../domain/problemLists';
import type { ParsedProblemList, StoredProblemList } from '../domain/problemLists';
import { fetchProblemMetadata } from '../services/codeforcesApi';
import { fetchListText } from '../services/problemListFetch';
import {
  defaultListStorage,
  loadProblemLists,
  saveProblemLists,
} from '../services/problemListStore';
import type { ProblemEntry } from '../types/performance';

/* After a failed lookup of names and ratings, do not ask again for this long. */
const METADATA_RETRY_MS = 60_000;

export interface ProblemListsApi {
  lists: StoredProblemList[];
  active: StoredProblemList | null;
  setActiveId: (id: string) => void;
  /* The active list's problems, in the list's own order, with the user's submissions on each. */
  entries: ProblemEntry[];
  notice: string | null;
  /* Names and ratings of the active list are being looked up. */
  loadingNames: boolean;
  importFile: (file: File) => Promise<void>;
  /* Reads a list from a web address; true when a list was added. */
  importUrl: (address: string) => Promise<boolean>;
  /* An address is being read. */
  importing: boolean;
  remove: (id: string) => void;
}

function newId(existing: readonly StoredProblemList[]): string {
  for (;;) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    if (!existing.some(list => list.id === id)) {
      return id;
    }
  }
}

export function useProblemLists(engine: PerformanceEngine): ProblemListsApi {
  const [lists, setLists] = useState<StoredProblemList[]>(() =>
    loadProblemLists(defaultListStorage()),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingNames, setLoadingNames] = useState(false);
  const [importing, setImporting] = useState(false);

  const listsRef = useRef(lists);
  const pendingRef = useRef(new Set<string>());
  const importingRef = useRef(false);
  const failedAtRef = useRef(Number.NEGATIVE_INFINITY);

  const active = lists.find(list => list.id === activeId) ?? lists[0] ?? null;

  /* Saves first: the screen only changes when the lists really are stored. */
  const commit = useCallback((next: StoredProblemList[]): boolean => {
    if (!saveProblemLists(defaultListStorage(), next)) {
      return false;
    }

    listsRef.current = next;
    setLists(next);

    return true;
  }, []);

  /* Stores a parsed list and tells the user what came of it; false when nothing was added. */
  const addList = useCallback(
    (name: string, parsed: ParsedProblemList): boolean => {
      /* A file or an address is read asynchronously: the lists may have changed meanwhile. */
      if (listsRef.current.length >= MAX_LISTS) {
        setNotice(`You can keep up to ${MAX_LISTS} lists. Remove one first.`);

        return false;
      }

      const list: StoredProblemList = {
        id: newId(listsRef.current),
        name,
        pids: parsed.pids,
        meta: {},
      };

      if (!commit([...listsRef.current, list])) {
        setNotice('The list could not be saved: browser storage is full or blocked.');

        return false;
      }

      setActiveId(list.id);

      const parts = [`Imported ${parsed.pids.length} problem${parsed.pids.length === 1 ? '' : 's'}`];

      if (parsed.ignored > 0) {
        parts.push(`${parsed.ignored} line${parsed.ignored === 1 ? '' : 's'} had no problem`);
      }

      if (parsed.truncated) {
        parts.push(`only the first ${MAX_PROBLEMS_PER_LIST} were kept`);
      }

      setNotice(`${parts.join('; ')}.`);

      return true;
    },
    [commit],
  );

  const importFile = useCallback(
    async (file: File): Promise<void> => {
      if (file.size > MAX_FILE_BYTES) {
        setNotice(`That file is too large (the limit is ${MAX_FILE_BYTES / 1024} KB).`);

        return;
      }

      if (listsRef.current.length >= MAX_LISTS) {
        setNotice(`You can keep up to ${MAX_LISTS} lists. Remove one first.`);

        return;
      }

      let text: string;

      try {
        text = await file.text();
      } catch {
        setNotice('That file could not be read.');

        return;
      }

      const parsed = parseProblemListText(text);

      if (parsed.pids.length === 0) {
        setNotice(`No Codeforces problems were found in "${file.name}".`);

        return;
      }

      addList(listNameFromFile(file.name), parsed);
    },
    [addList],
  );

  const importUrl = useCallback(
    async (address: string): Promise<boolean> => {
      if (importingRef.current) {
        return false;
      }

      const checked = validateListUrl(address);

      if (!checked.ok) {
        setNotice(checked.message);

        return false;
      }

      if (listsRef.current.length >= MAX_LISTS) {
        setNotice(`You can keep up to ${MAX_LISTS} lists. Remove one first.`);

        return false;
      }

      importingRef.current = true;
      setImporting(true);
      setNotice(null);

      try {
        const url = normalizeListUrl(checked.url);
        const result = await fetchListText(url.href);

        if (!result.ok) {
          setNotice(urlFailureMessage(result.failure, url.hostname, result.status));

          return false;
        }

        const isPage = /html/i.test(result.contentType) || /^\s*<(!doctype|html)/i.test(result.text);
        const parsed = isPage ? extractProblemLinks(result.text) : parseProblemListText(result.text);

        if (parsed.pids.length === 0) {
          setNotice(noProblemsAtUrlMessage(isPage));

          return false;
        }

        return addList(listNameFromUrl(url), parsed);
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [addList],
  );

  const remove = useCallback(
    (id: string): void => {
      if (!commit(listsRef.current.filter(list => list.id !== id))) {
        setNotice('The list could not be removed: browser storage is blocked.');

        return;
      }

      setNotice(null);
    },
    [commit],
  );

  /*
   * Names, ratings and topics of problems the user never submitted come
   * from Codeforces' problemset, once per list, and are stored with the
   * list. A problem the user did submit does not need them.
   */
  useEffect(() => {
    if (!active) {
      return;
    }

    const missing = active.pids.filter(pid => !(pid in active.meta));

    if (
      missing.length === 0 ||
      pendingRef.current.has(active.id) ||
      Date.now() - failedAtRef.current < METADATA_RETRY_MS
    ) {
      return;
    }

    const listId = active.id;

    pendingRef.current.add(listId);
    setLoadingNames(true);

    fetchProblemMetadata(new Set(missing))
      .then(found => {
        const latest = listsRef.current.find(list => list.id === listId);

        if (!latest) {
          return;
        }

        const meta = { ...latest.meta };

        for (const pid of missing) {
          meta[pid] = found[pid] ?? { name: '', rating: null, tags: [] };
        }

        commit(listsRef.current.map(list => (list.id === listId ? { ...latest, meta } : list)));
      })
      .catch(() => {
        failedAtRef.current = Date.now();
      })
      .finally(() => {
        pendingRef.current.delete(listId);
        setLoadingNames(false);
      });
  }, [active, commit]);

  const entries = useMemo(
    () => (active ? engine.entriesForPids(active.pids, pid => active.meta[pid]) : []),
    [engine, active],
  );

  return { lists, active, setActiveId, entries, notice, loadingNames, importFile, importUrl, importing, remove };
}
