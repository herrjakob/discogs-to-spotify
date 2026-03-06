import { searchAlbum, searchAlbumFreeform, getAlbumTracks, addTracksToPlaylist, getUserPlaylists } from '../lib/spotify-api.js';
import { cleanArtistName, findBestMatch } from '../lib/matching.js';

// --- Configuration ---
const SPOTIFY_SCOPES = 'playlist-read-private playlist-modify-public playlist-modify-private';

async function getClientId() {
  const { spotifyClientId } = await chrome.storage.local.get('spotifyClientId');
  if (!spotifyClientId) throw new Error('Spotify Client ID not configured');
  return spotifyClientId;
}

// --- PKCE Helpers ---
function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- Token Management ---
async function storeTokens({ accessToken, refreshToken, expiresAt }) {
  await chrome.storage.local.set({ accessToken, refreshToken, expiresAt });
}

async function getValidToken() {
  const stored = await chrome.storage.local.get(['accessToken', 'expiresAt', 'refreshToken']);
  if (stored.accessToken && stored.expiresAt > Date.now() + 60000) {
    return stored.accessToken;
  }
  if (stored.refreshToken) {
    return await refreshAccessToken(stored.refreshToken);
  }
  throw new Error('Not authenticated');
}

async function refreshAccessToken(refreshToken) {
  const clientId = await getClientId();
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!res.ok) throw new Error('Token refresh failed');
  const data = await res.json();

  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000)
  };
  await storeTokens(tokens);
  return tokens.accessToken;
}

// --- Spotify OAuth PKCE ---
async function authenticate() {
  const clientId = await getClientId();
  const redirectUrl = chrome.identity.getRedirectURL();
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);

  await chrome.storage.session.set({ codeVerifier, oauthState: state });

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('state', state);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (callbackUrl) => {
        if (chrome.runtime.lastError || !callbackUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'Auth failed'));
          return;
        }

        try {
          const url = new URL(callbackUrl);
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');

          const stored = await chrome.storage.session.get(['codeVerifier', 'oauthState']);
          if (returnedState !== stored.oauthState) {
            reject(new Error('State mismatch'));
            return;
          }

          // Exchange code for tokens
          const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUrl,
              code_verifier: stored.codeVerifier
            })
          });

          if (!res.ok) {
            reject(new Error(`Token exchange failed: ${res.status}`));
            return;
          }

          const data = await res.json();
          const tokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in * 1000)
          };
          await storeTokens(tokens);
          resolve(tokens);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

// --- Sync Log ---
const LOG_MAX = 500;

async function appendToLog(entries) {
  const { syncLog } = await chrome.storage.local.get('syncLog');
  const log = syncLog || [];
  log.push(...entries);
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  await chrome.storage.local.set({ syncLog: log });
  // Notify popup if open
  chrome.runtime.sendMessage({ action: 'logAppended', entries }).catch(() => {});
}

// --- Release Tracking ---
async function getProcessedReleases() {
  const { processedReleases } = await chrome.storage.local.get('processedReleases');
  return processedReleases || {};
}

async function markReleasesProcessed(releaseIds) {
  const processed = await getProcessedReleases();
  const now = Date.now();
  for (const id of releaseIds) {
    processed[id] = now;
  }
  await chrome.storage.local.set({ processedReleases: processed });
}

// --- Search & Match ---
async function searchForRelease(token, release) {
  const primaryArtist = cleanArtistName(release.artists[0]);

  // Strategy 1: Structured search
  let results = await searchAlbum(token, primaryArtist, release.albumTitle);
  let match = findBestMatch(results, release);
  if (match) return match;

  // Strategy 2: Freeform search
  results = await searchAlbumFreeform(token, `${primaryArtist} ${release.albumTitle}`);
  match = findBestMatch(results, release);
  if (match) return match;

  // Strategy 3: All artists combined (for multi-artist releases)
  if (release.artists.length > 1) {
    const allArtists = release.artists.map(cleanArtistName).join(' ');
    results = await searchAlbumFreeform(token, `${allArtists} ${release.albumTitle}`);
    match = findBestMatch(results, release);
    if (match) return match;
  }

  return null;
}

// --- Sync Orchestration ---
async function syncReleases(releases, tabId, paginate, nextPage, sendProgress) {
  const token = await getValidToken();
  const processed = await getProcessedReleases();

  // Collect all releases (with pagination if requested)
  let allReleases = [...releases];

  if (paginate && nextPage) {
    let nextUrl = nextPage;
    while (nextUrl) {
      sendProgress({ status: 'paginating', message: `Loading next page...` });

      await chrome.tabs.update(tabId, { url: nextUrl });

      // Wait for the content script to be ready and return releases
      let response;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(r => setTimeout(r, 300));
        try {
          response = await chrome.tabs.sendMessage(tabId, { action: 'parseReleases' });
          if (response.releases.length > 0) break; // DOM has rendered
        } catch {
          // Content script not yet injected — try again
        }
      }
      if (!response || response.releases.length === 0) throw new Error('No releases found after navigating to next page. The Discogs page layout may have changed.');
      allReleases.push(...response.releases);
      nextUrl = response.nextPage;
    }
  }

  // Deduplicate: filter against previous syncs AND within current batch
  const dedupKey = r => r.discogsMasterId || r.discogsReleaseId;
  const seenInBatch = new Set();
  const newReleases = allReleases.filter(r => {
    const key = dedupKey(r);
    if (!key || processed[key] || seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });
  const skippedCount = allReleases.length - newReleases.length;

  const now = Date.now();
  sendProgress({
    status: 'searching',
    message: `Found ${allReleases.length} releases (${skippedCount} already processed, ${newReleases.length} new)`
  });
  await appendToLog([{
    time: now,
    type: 'info',
    text: `— Sync started: ${allReleases.length} found, ${skippedCount} skipped, ${newReleases.length} new`
  }]);

  // Search and match each release
  const { targetPlaylistId } = await chrome.storage.local.get('targetPlaylistId');
  if (!targetPlaylistId) throw new Error('No playlist configured');

  const matched = [];
  const notFound = [];
  let allTrackUris = [];

  for (let i = 0; i < newReleases.length; i++) {
    const release = newReleases[i];
    const artistStr = release.artists.join(', ');
    const releaseLabel = `${artistStr} - ${release.albumTitle}`;
    sendProgress({
      status: 'searching',
      message: `Searching ${i + 1}/${newReleases.length}: ${releaseLabel}`,
      current: i + 1,
      total: newReleases.length
    });

    try {
      const album = await searchForRelease(token, release);
      if (album) {
        const trackUris = await getAlbumTracks(token, album.id);
        allTrackUris.push(...trackUris);
        matched.push({ release, spotifyAlbum: album, trackCount: trackUris.length });
        await appendToLog([{
          time: Date.now(),
          type: 'matched',
          text: `✓ ${releaseLabel} → "${album.name}" (${trackUris.length} tracks)`
        }]);
      } else {
        notFound.push(release);
        await appendToLog([{
          time: Date.now(),
          type: 'notFound',
          text: `✗ ${releaseLabel} (not found on Spotify)`
        }]);
      }
    } catch (err) {
      console.error(`Error processing ${releaseLabel}:`, err);
      notFound.push(release);
      await appendToLog([{
        time: Date.now(),
        type: 'error',
        text: `✗ ${releaseLabel} (error: ${err.message})`
      }]);
    }
  }

  // Add all tracks to the playlist
  if (allTrackUris.length > 0) {
    sendProgress({ status: 'adding', message: `Adding ${allTrackUris.length} tracks to playlist...` });
    await addTracksToPlaylist(token, targetPlaylistId, allTrackUris);
  }

  // Mark successfully matched releases as processed (key by masterId when available)
  const processedIds = matched
    .map(m => m.release.discogsMasterId || m.release.discogsReleaseId)
    .filter(Boolean);
  if (processedIds.length > 0) {
    await markReleasesProcessed(processedIds);
  }

  await appendToLog([{
    time: Date.now(),
    type: 'info',
    text: `— Sync complete: ${matched.length} matched, ${notFound.length} not found, ${allTrackUris.length} tracks added`
  }]);

  return {
    total: allReleases.length,
    skipped: skippedCount,
    matched: matched.length,
    tracksAdded: allTrackUris.length,
    notFound: notFound.map(r => `${r.artists.join(', ')} - ${r.albumTitle}`)
  };
}

// --- Message Handler ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'authenticate') {
    authenticate()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'getAuthStatus') {
    getValidToken()
      .then(() => sendResponse({ authenticated: true }))
      .catch(() => sendResponse({ authenticated: false }));
    return true;
  }

  if (message.action === 'getPlaylists') {
    getValidToken()
      .then(token => getUserPlaylists(token))
      .then(playlists => sendResponse({ success: true, playlists }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'syncReleases') {
    const { releases, tabId, paginate, nextPage } = message;

    const sendProgress = (progress) => {
      chrome.runtime.sendMessage({ action: 'syncProgress', ...progress }).catch(() => {});
    };

    syncReleases(releases, tabId, paginate, nextPage, sendProgress)
      .then(results => {
        chrome.runtime.sendMessage({ action: 'syncComplete', results }).catch(() => {});

        // Fire a system notification regardless of whether the popup is open
        const parts = [`Added ${results.tracksAdded} tracks from ${results.matched} albums`];
        if (results.skipped > 0) parts.push(`${results.skipped} already synced`);
        if (results.notFound.length > 0) parts.push(`${results.notFound.length} not found`);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Discogs → Spotify sync complete',
          message: parts.join(' · ')
        });
      })
      .catch(err => {
        chrome.runtime.sendMessage({ action: 'syncError', error: err.message }).catch(() => {});
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Discogs → Spotify sync failed',
          message: err.message || 'An error occurred during sync'
        });
        appendToLog([{
          time: Date.now(),
          type: 'error',
          text: `— Sync failed: ${err.message || 'unknown error'}`
        }]).catch(() => {});
      });

    sendResponse({ started: true });
    return true;
  }

  if (message.action === 'clearHistory') {
    chrome.storage.local.remove('processedReleases')
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'clearLog') {
    chrome.storage.local.remove('syncLog')
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'logout') {
    chrome.storage.local.remove(['accessToken', 'refreshToken', 'expiresAt'])
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
