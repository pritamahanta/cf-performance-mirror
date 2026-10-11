import { useEffect, useState } from 'react';
import { createTheme, type Theme } from '../domain/theme';

/*
 * createTheme() reads computed styles (background/border colors via
 * getComputedStyle), not just DOM attributes - a theme change can come
 * from a stylesheet swap or an OS-level prefers-color-scheme switch,
 * neither of which touches an element's class/style/data-theme
 * attribute and so would not fire the MutationObserver below. The
 * interval is the only thing that would still catch that, which is
 * why it is kept rather than dropped - just no longer flat-rate
 * forever: fast for the first stretch after mount, while the page is
 * still settling, then much slower, and paused entirely while the tab
 * is hidden (same document.hidden/visibilitychange pattern already
 * used for the Online Friends poller - see useOnlineFriends.ts).
 */
const FAST_POLL_MS = 500;
const FAST_POLL_WINDOW_MS = 10_000;
const SLOW_POLL_MS = 5_000;

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => createTheme());

  useEffect(() => {
    let previous = theme;
    let intervalId: number | null = null;
    let settleTimeoutId: number | null = null;
    let settled = false;

    const update = () => {
      const next = createTheme();
      if (
        next.isDark !== previous.isDark ||
        next.bg !== previous.bg ||
        next.border !== previous.border ||
        next.borderLight !== previous.borderLight
      ) {
        previous = next;
        setTheme(next);
      }
    };

    const clearPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPolling = (everyMs: number) => {
      clearPolling();

      if (!document.hidden) {
        intervalId = window.setInterval(update, everyMs);
      }
    };

    const observer = new MutationObserver(update);
    const observe = (element: Element | null) => {
      if (element) observer.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    };

    observe(document.documentElement);
    observe(document.body);
    for (const selector of ['.info', '.roundbox', '#pageContent']) {
      observe(document.querySelector(selector));
    }

    startPolling(FAST_POLL_MS);
    settleTimeoutId = window.setTimeout(() => {
      settleTimeoutId = null;
      settled = true;
      startPolling(SLOW_POLL_MS);
    }, FAST_POLL_WINDOW_MS);

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearPolling();
        return;
      }

      /* Catch anything missed while hidden, then resume at whichever rate was active. */
      update();
      startPolling(settled ? SLOW_POLL_MS : FAST_POLL_MS);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', update);
    window.setTimeout(update, 100);

    return () => {
      observer.disconnect();
      clearPolling();

      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
      }

      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', update);
    };
  }, []);

  return theme;
}
