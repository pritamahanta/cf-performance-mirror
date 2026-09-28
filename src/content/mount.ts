export interface MountResult {
  host: HTMLElement;
  root: Document;
  appRoot: HTMLDivElement;
  onlineFriendsHost: HTMLElement | null;
  widthSource: Element | null;
}

function findProblemRatingsBox(): Element | null {
  const boxes =
    document.querySelectorAll('.box');

  for (const box of boxes) {
    const headings =
      box.querySelectorAll(
        'h2, h3, .title, [class*="title"], [class*="header"]',
      );

    for (const heading of headings) {
      if (
        heading.textContent
          ?.trim()
          .toLowerCase()
          .includes('problem ratings')
      ) {
        return box;
      }
    }

    const firstText =
      box.firstElementChild;

    if (
      firstText?.textContent
        ?.trim()
        .toLowerCase()
        .includes('problem ratings')
    ) {
      return box;
    }
  }

  return null;
}

/*
 * Finds a sidebar box by its title. Matches on the
 * box's own caption (e.g. "-> Top rated") rather
 * than all of its text, so a box that merely
 * mentions one of these phrases in its content
 * (a "Pay attention" announcement, say) can't be
 * mistaken for it. Boxes without a caption fall
 * back to matching their whole text, as before.
 */
function findSidebarBoxByText(
  sidebar: Element,
  text: string,
): Element | null {
  const target =
    text.toLowerCase();

  const boxes =
    sidebar.querySelectorAll(
      '.roundbox',
    );

  for (const box of boxes) {
    const label =
      (
        box.querySelector(
          '.caption',
        ) ?? box
      ).textContent
        ?.trim()
        .toLowerCase() ?? '';

    if (
      label.includes(target)
    ) {
      return box;
    }
  }

  return null;
}

export function mountOnlineFriendsHost():
  HTMLElement | null {
  const existing =
    document.getElementById(
      'cfpm-online-friends',
    );

  if (existing) {
    return existing;
  }

  const sidebar =
    document.getElementById(
      'sidebar',
    );

  if (!sidebar) {
    return null;
  }

  const host =
    document.createElement('div');

  host.id =
    'cfpm-online-friends';

  host.style.width =
    '100%';

  host.style.boxSizing =
    'border-box';

  /*
   * Top rated and Top contributors are each about
   * ten rows tall, so placing the box below them
   * pushes it off-screen on most displays. Put it
   * directly above them instead, so it is visible
   * without scrolling:
   *
   * (profile / Pay attention)
   * Online Friends
   * Top rated
   * Top contributors
   * Find user
   */
  const anchor =
    findSidebarBoxByText(
      sidebar,
      'top rated',
    ) ??
    findSidebarBoxByText(
      sidebar,
      'top contributors',
    ) ??
    findSidebarBoxByText(
      sidebar,
      'find user',
    );

  if (anchor) {
    anchor.insertAdjacentElement(
      'beforebegin',
      host,
    );

    return host;
  }

  /*
   * Fallback if the sidebar titles aren't found
   * (Codeforces changed the markup, or the page is
   * not in English): still keep it near the top, right
   * after the first box, instead of at the very bottom.
   */
  const firstBox =
    sidebar.querySelector(
      '.roundbox',
    );

  if (firstBox) {
    firstBox.insertAdjacentElement(
      'afterend',
      host,
    );
  } else {
    sidebar.appendChild(host);
  }

  return host;
}

export function mountExtension():
  MountResult {
  const existing =
    document.getElementById(
      'cfpm-compact',
    );

  if (existing) {
    const appRoot =
      existing.querySelector<HTMLDivElement>(
        '#cfpm-react-root',
      ) ||
      (existing as HTMLDivElement);

    return {
      host: existing,
      root: document,
      appRoot,
      onlineFriendsHost:
        document.getElementById(
          'cfpm-online-friends',
        ),
      widthSource: null,
    };
  }

  const host =
    document.createElement('div');

  host.id =
    'cfpm-compact';

  const visible =
    Array.from(
      document.querySelectorAll(
        '.box',
      ),
    ).filter(element => {
      const rect =
        element.getBoundingClientRect();

      return (
        rect.width > 220 &&
        rect.height > 50
      );
    });

  let widthSource:
    Element | null = null;

  if (visible.length > 0) {
    widthSource =
      visible[visible.length - 1];

    host.style.width =
      `${Math.round(
        widthSource.getBoundingClientRect()
          .width,
      )}px`;

    widthSource.insertAdjacentElement(
      'afterend',
      host,
    );
  } else {
    const main =
      document.querySelector(
        '#pageContent, #mainContent, .mainContent, .content',
      );

    if (main) {
      widthSource = main;

      host.style.width =
        `${Math.round(
          main.getBoundingClientRect()
            .width,
        )}px`;

      main.appendChild(host);
    } else {
      document.body.appendChild(
        host,
      );

      host.style.width =
        '880px';
    }
  }

  const appRoot =
    document.createElement('div');

  appRoot.id =
    'cfpm-react-root';

  host.appendChild(
    appRoot,
  );

  const existingRatingsBox =
    findProblemRatingsBox();

  if (
    existingRatingsBox &&
    existingRatingsBox !== host
  ) {
    existingRatingsBox.insertAdjacentElement(
      'afterend',
      host,
    );

    return {
      host,
      root: document,
      appRoot,
      onlineFriendsHost:
        mountOnlineFriendsHost(),
      widthSource,
    };
  }

  let relocated = false;

  const relocateObserver =
    new MutationObserver(
      () => {
        if (relocated) return;

        const ratingsBox =
          findProblemRatingsBox();

        if (
          !ratingsBox ||
          ratingsBox === host
        ) {
          return;
        }

        relocated = true;

        relocateObserver.disconnect();

        setTimeout(() => {
          ratingsBox.insertAdjacentElement(
            'afterend',
            host,
          );
        }, 50);
      },
    );

  relocateObserver.observe(
    document.body,
    {
      childList: true,
      subtree: true,
    },
  );

  setTimeout(() => {
    if (!relocated) {
      relocateObserver.disconnect();
    }
  }, 10000);

  return {
    host,
    root: document,
    appRoot,
    onlineFriendsHost:
      mountOnlineFriendsHost(),
    widthSource,
  };
}

export function observeWidth(
  host: HTMLElement,
  source: Element | null,
): ResizeObserver | null {
  if (
    !source ||
    !window.ResizeObserver
  ) {
    return null;
  }

  const observer =
    new ResizeObserver(
      entries => {
        for (const entry of entries) {
          const width =
            Math.round(
              entry.contentRect.width,
            );

          if (width > 220) {
            host.style.width =
              `${width}px`;
          }
        }
      },
    );

  observer.observe(source);

  return observer;
}