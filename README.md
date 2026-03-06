# Discogs → Spotify

A Chrome extension that adds releases from your Discogs ["New for me"](https://www.discogs.com/search/?type=master&layout=sm&limit=250&sort=year%2Cdesc&format_exact=Album&country_exact=Germany&in_collection_wantlist=0&nmp=1) page to a Spotify playlist.

## Prerequisites

- Google Chrome
- A [Spotify account](https://spotify.com)
- A [Spotify Developer app](https://developer.spotify.com/dashboard) (free)

## Setup

### 1. Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app.
2. In the app settings, add the following **Redirect URI**:

   ```
   https://<your-extension-id>.chromiumapp.org/
   ```

   You'll find your extension ID in Chrome after loading the extension (step 3 below). You can update the redirect URI afterwards.

3. Copy your **Client ID** from the app dashboard.

### 2. Load the extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder

### 3. Configure the extension

1. Click the extension icon in the Chrome toolbar
2. Paste your Spotify **Client ID** and click Save
3. Click **Connect Spotify** and complete the OAuth flow
4. Select a target playlist

## Usage

1. Go to your Discogs ["New for me"](https://www.discogs.com/search/?sort=nfm&layout=sm) search page
2. Click the extension icon
3. Click **Add Current Page** to sync the visible releases, or **Add All Pages** to paginate through all results

Previously synced releases are skipped automatically. Use **Export JSON** / **Import JSON** to back up and restore your sync history.

## License

MIT
