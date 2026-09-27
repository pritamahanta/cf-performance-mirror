const API_BASE = 'https://codeforces.com/api';

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

        const response =
          await fetch(
            `${API_BASE}/user.info?handles=${params}`,
            {
              cache: 'no-store',
            },
          );

        if (!response.ok) {
          throw new Error(
            `Codeforces API HTTP ${response.status}`,
          );
        }

        const data =
          await response.json();

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