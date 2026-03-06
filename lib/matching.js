// Strip Discogs disambiguation suffixes: "Jennie (8)" -> "Jennie"
export function cleanArtistName(name) {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

// Normalize for comparison: lowercase, remove diacritics, collapse whitespace
export function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score how well a Spotify album matches a Discogs release
export function scoreMatch(spotifyAlbum, discogsRelease) {
  const spotifyName = normalize(spotifyAlbum.name);
  const discogsName = normalize(discogsRelease.albumTitle);

  // Album name must be a reasonable match
  const exactAlbum = spotifyName === discogsName;
  const partialAlbum = spotifyName.includes(discogsName) || discogsName.includes(spotifyName);

  if (!exactAlbum && !partialAlbum) return 0;

  // Check artist overlap
  const discogsArtists = discogsRelease.artists.map(a => normalize(cleanArtistName(a)));
  const spotifyArtists = spotifyAlbum.artists.map(a => normalize(a.name));

  const matchedCount = discogsArtists.filter(da =>
    spotifyArtists.some(sa => sa.includes(da) || da.includes(sa))
  ).length;

  if (matchedCount === 0) return 0;

  let score = matchedCount / Math.max(discogsArtists.length, spotifyArtists.length);
  if (exactAlbum) score += 1;

  return score;
}

// Find the best Spotify match above a minimum threshold
export function findBestMatch(spotifyResults, discogsRelease) {
  let bestScore = 0;
  let bestAlbum = null;

  for (const album of spotifyResults) {
    const score = scoreMatch(album, discogsRelease);
    if (score > bestScore) {
      bestScore = score;
      bestAlbum = album;
    }
  }

  return bestScore >= 0.5 ? bestAlbum : null;
}
