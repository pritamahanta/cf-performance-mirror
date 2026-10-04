const API_BASE = 'https://codeforces.com/api';

/* Shorter than the page-side wait for this reply (20s), so the real error arrives first. */
const FETCH_TIMEOUT_MS = 15000;

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      !message ||
      message.type !== 'CFPM_FETCH_USER_INFO'
    ) {
      return false;
    }

    const handles = Array.isArray(
      message.handles,
    )
      ? message.handles
      : [];

    if (handles.length === 0) {
      sendResponse({
        ok: true,
        data: [],
      });

      return false;
    }

    (async () => {
      try {
        const params =
          handles
            .map(
              handle =>
                encodeURIComponent(
                  handle,
                ),
            )
            .join(';');

        /*
         * Give up after a while so a stalled connection can't leave
         * this request, and the page waiting on it, hanging. The
         * limit covers reading the body too.
         */
        const limit =
          new AbortController();

        const timer =
          setTimeout(
            () => limit.abort(),
            FETCH_TIMEOUT_MS,
          );

        let data;

        try {
          const response =
            await fetch(
              `${API_BASE}/user.info?handles=${params}`,
              {
                cache: 'no-store',
                signal: limit.signal,
              },
            );

          if (!response.ok) {
            throw new Error(
              `Codeforces API HTTP ${response.status}`,
            );
          }

          data =
            await response.json();
        } finally {
          clearTimeout(timer);
        }

        if (data.status !== 'OK') {
          throw new Error(
            data.comment ||
              'Codeforces API returned FAILED',
          );
        }

        sendResponse({
          ok: true,
          data:
            Array.isArray(
              data.result,
            )
              ? data.result
              : [],
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown Codeforces API error',
        });
      }
    })();

    /*
     * Keep the message channel open while
     * the asynchronous fetch completes.
     */
    return true;
  },
);