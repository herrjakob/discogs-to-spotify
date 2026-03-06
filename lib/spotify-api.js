// Spotify Web API helpers

async function rateLimitedFetch(url, options, retries = 3) {
  const res = await fetch(url, options);

  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return rateLimitedFetch(url, options, retries - 1);
  }

  return res;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// Search for albums matching artist + album name
export async function searchAlbum(token, artistQuery, albumQuery) {
  const q = `album:${albumQuery} artist:${artistQuery}`;
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'album');
  url.searchParams.set('limit', '5');

  const res = await rateLimitedFetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return data.albums.items;
}

// Freeform search (no field filters) as a fallback
export async function searchAlbumFreeform(token, query) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'album');
  url.searchParams.set('limit', '10');

  const res = await rateLimitedFetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return data.albums.items;
}

// Get all track URIs for an album
export async function getAlbumTracks(token, albumId) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`;

  while (url) {
    const res = await rateLimitedFetch(url, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`Get tracks failed: ${res.status}`);
    const data = await res.json();
    tracks.push(...data.items.map(t => t.uri));
    url = data.next;
  }

  return tracks;
}

// Add track URIs to a playlist (batches of 100)
export async function addTracksToPlaylist(token, playlistId, trackUris) {
  const BATCH_SIZE = 100;
  for (let i = 0; i < trackUris.length; i += BATCH_SIZE) {
    const batch = trackUris.slice(i, i + BATCH_SIZE);
    const res = await rateLimitedFetch(
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uris: batch })
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Add tracks failed: ${err.error?.message || res.status}`);
    }
  }
}

// Fetch all user playlists
export async function getUserPlaylists(token) {
  const playlists = [];
  let url = 'https://api.spotify.com/v1/me/playlists?limit=50';

  while (url) {
    const res = await rateLimitedFetch(url, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`Get playlists failed: ${res.status}`);
    const data = await res.json();
    playlists.push(...data.items.map(p => ({ id: p.id, name: p.name })));
    url = data.next;
  }

  return playlists;
}
