// Content script — parses Discogs "New for me" releases from the DOM
(function () {
  function parseReleases() {
    const cards = document.querySelectorAll('li.card.card_text-only');
    const releases = [];

    for (const card of cards) {
      const h4 = card.querySelector('.card_body h4');
      if (!h4) continue;

      // Artists: each artist is in a span[title] inside the h4
      const artistSpans = h4.querySelectorAll('span[title]');
      const artists = Array.from(artistSpans).map(span => span.getAttribute('title'));

      // Album title from the search_result_title link
      const titleLink = h4.querySelector('a.search_result_title');
      const albumTitle = titleLink ? titleLink.getAttribute('title') : null;

      if (artists.length === 0 || !albumTitle) continue;

      // Metadata
      const year = card.querySelector('.card_release_year')?.textContent?.trim() || null;
      const format = card.querySelector('.card_release_format')?.textContent?.trim() || null;
      const releaseId = card.dataset.objectId || null;
      const masterId = card.dataset.masterId || null;

      releases.push({
        artists,
        albumTitle,
        year,
        format,
        discogsReleaseId: releaseId,
        discogsMasterId: masterId
      });
    }

    return releases;
  }

  function getNextPageUrl() {
    const nextLink = document.querySelector('a.pagination_next');
    return nextLink ? nextLink.href : null;
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'parseReleases') {
      const releases = parseReleases();
      const nextPage = getNextPageUrl();
      sendResponse({ releases, nextPage });
    }
  });
})();
