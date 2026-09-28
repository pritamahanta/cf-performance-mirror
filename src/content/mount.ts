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
    const content =
      box.textContent
        ?.trim()
        .toLowerCase() ?? '';

    if (
      content.includes(target)
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

  const topContributors =
    findSidebarBoxByText(
      sidebar,
      'top contributors',
    );

  const findUser =
    findSidebarBoxByText(
      sidebar,
      'find user',
    );

  /*
   * Preferred location:
   *
   * Top contributors
   * Online Friends
   * Find user
   */
  if (topContributors) {
    topContributors.insertAdjacentElement(
      'afterend',
      host,
    );
  } else if (findUser) {
    findUser.insertAdjacentElement(
      'beforebegin',
      host,
    );
  } else {
    /*
     * Fallback if Codeforces changes
     * the sidebar markup.
     */
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