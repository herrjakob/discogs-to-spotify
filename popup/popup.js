// --- DOM Elements ---
const setupSection = document.getElementById('setup-section');
const authSection = document.getElementById('auth-section');
const configSection = document.getElementById('config-section');
const syncSection = document.getElementById('sync-section');
const errorEl = document.getElementById('error');

const clientIdInput = document.getElementById('client-id-input');
const saveClientIdBtn = document.getElementById('save-client-id-btn');
const changeClientIdBtn = document.getElementById('change-client-id-btn');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const saveConfigBtn = document.getElementById('save-config-btn');
const playlistSelect = document.getElementById('playlist-select');
const playlistName = document.getElementById('playlist-name');
const changePlaylistBtn = document.getElementById('change-playlist-btn');
const syncBtn = document.getElementById('sync-btn');
const syncAllBtn = document.getElementById('sync-all-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');

const progressEl = document.getElementById('progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultsEl = document.getElementById('results');
const matchedStat = document.getElementById('matched-stat');
const skippedStat = document.getElementById('skipped-stat');
const notFoundStat = document.getElementById('not-found-stat');
const tracksStat = document.getElementById('tracks-stat');
const notFoundSection = document.getElementById('not-found-section');
const notFoundList = document.getElementById('not-found-list');
const logEntries = document.getElementById('log-entries');
const clearLogBtn = document.getElementById('clear-log-btn');

// --- Helpers ---
function showSection(section) {
  setupSection.classList.add('hidden');
  authSection.classList.add('hidden');
  configSection.classList.add('hidden');
  syncSection.classList.add('hidden');
  section.classList.remove('hidden');
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.classList.add('hidden');
}

function setSyncButtons(disabled) {
  syncBtn.disabled = disabled;
  syncAllBtn.disabled = disabled;
}

function setBackupButtons(disabled) {
  exportBtn.disabled = disabled;
  importBtn.disabled = disabled;
}

async function buildBackupPayload() {
  const { processedReleases } = await chrome.storage.local.get('processedReleases');
  const releases = processedReleases || {};
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: Object.keys(releases).length,
    processedReleases: releases
  };
}

async function applyImportedBackup(data) {
  if (!data || typeof data.processedReleases !== 'object') {
    throw new Error('Invalid backup file: missing processedReleases field');
  }
  const { processedReleases: existing } = await chrome.storage.local.get('processedReleases');
  const merged = { ...data.processedReleases, ...(existing || {}) };
  await chrome.storage.local.set({ processedReleases: merged });
  const added = Object.keys(merged).length - Object.keys(existing || {}).length;
  return { added, total: Object.keys(merged).length };
}

// --- Log Rendering ---
function formatLogTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderLogEntry(entry) {
  const el = document.createElement('div');
  el.className = `log-entry log-${entry.type}`;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = formatLogTime(entry.time);
  el.appendChild(time);
  el.appendChild(document.createTextNode(entry.text));
  return el;
}

function prependLogEntries(entries) {
  for (const entry of [...entries].reverse()) {
    logEntries.insertBefore(renderLogEntry(entry), logEntries.firstChild);
  }
}

async function loadLog() {
  const { syncLog } = await chrome.storage.local.get('syncLog');
  logEntries.innerHTML = '';
  if (syncLog && syncLog.length > 0) {
    // Show newest first
    for (const entry of [...syncLog].reverse()) {
      logEntries.appendChild(renderLogEntry(entry));
    }
  }
}

// --- Init ---
async function init() {
  clearError();

  const { spotifyClientId } = await chrome.storage.local.get('spotifyClientId');
  if (!spotifyClientId) {
    showSection(setupSection);
    return;
  }

  const { authenticated } = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });

  if (!authenticated) {
    showSection(authSection);
    return;
  }

  const { targetPlaylistId, targetPlaylistName } = await chrome.storage.local.get([
    'targetPlaylistId',
    'targetPlaylistName'
  ]);

  if (targetPlaylistId && targetPlaylistName) {
    playlistName.textContent = targetPlaylistName;
    showSection(syncSection);
  } else {
    await loadPlaylists();
    showSection(configSection);
  }

  await loadLog();
}

async function loadPlaylists() {
  playlistSelect.innerHTML = '<option value="">Loading...</option>';
  const response = await chrome.runtime.sendMessage({ action: 'getPlaylists' });

  if (!response.success) {
    showError(response.error || 'Failed to load playlists');
    return;
  }

  playlistSelect.innerHTML = '';
  for (const pl of response.playlists) {
    const opt = document.createElement('option');
    opt.value = pl.id;
    opt.textContent = pl.name;
    playlistSelect.appendChild(opt);
  }

  // Pre-select saved playlist if it exists
  const { targetPlaylistId } = await chrome.storage.local.get('targetPlaylistId');
  if (targetPlaylistId) {
    playlistSelect.value = targetPlaylistId;
  }
}

// --- Event Handlers ---
saveClientIdBtn.addEventListener('click', async () => {
  const id = clientIdInput.value.trim();
  if (!id) {
    showError('Please enter a Client ID');
    return;
  }
  await chrome.storage.local.set({ spotifyClientId: id });
  await init();
});

changeClientIdBtn.addEventListener('click', () => {
  clientIdInput.value = '';
  showSection(setupSection);
});

loginBtn.addEventListener('click', async () => {
  clearError();
  loginBtn.disabled = true;
  loginBtn.textContent = 'Connecting...';

  const response = await chrome.runtime.sendMessage({ action: 'authenticate' });

  if (response.success) {
    await loadPlaylists();
    showSection(configSection);
  } else {
    showError(response.error || 'Authentication failed');
  }

  loginBtn.disabled = false;
  loginBtn.textContent = 'Connect Spotify';
});

logoutBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'logout' });
  await chrome.storage.local.remove(['targetPlaylistId', 'targetPlaylistName']);
  showSection(authSection);
});

saveConfigBtn.addEventListener('click', async () => {
  const id = playlistSelect.value;
  const name = playlistSelect.options[playlistSelect.selectedIndex]?.text;

  if (!id) {
    showError('Please select a playlist');
    return;
  }

  await chrome.storage.local.set({ targetPlaylistId: id, targetPlaylistName: name });
  playlistName.textContent = name;
  showSection(syncSection);
});

changePlaylistBtn.addEventListener('click', async () => {
  await loadPlaylists();
  showSection(configSection);
});

async function startSync(paginate) {
  clearError();
  resultsEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'Parsing releases from page...';
  setSyncButtons(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('discogs.com/search')) {
      showError('Navigate to a Discogs search page first (e.g. the "New for me" page)');
      setSyncButtons(false);
      progressEl.classList.add('hidden');
      return;
    }

    // Parse releases from the current page via content script
    const parsed = await chrome.tabs.sendMessage(tab.id, { action: 'parseReleases' });

    if (!parsed || !parsed.releases || parsed.releases.length === 0) {
      showError('No releases found on this page. The Discogs page layout may have changed — check that you are on a search results page and that release cards are visible.');
      setSyncButtons(false);
      progressEl.classList.add('hidden');
      return;
    }

    progressText.textContent = `Found ${parsed.releases.length} releases. Starting sync...`;

    // Send to background for processing
    chrome.runtime.sendMessage({
      action: 'syncReleases',
      releases: parsed.releases,
      tabId: tab.id,
      paginate,
      nextPage: parsed.nextPage
    });

  } catch (err) {
    showError(err.message || 'Failed to parse page');
    setSyncButtons(false);
    progressEl.classList.add('hidden');
  }
}

syncBtn.addEventListener('click', () => startSync(false));
syncAllBtn.addEventListener('click', () => startSync(true));

clearLogBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'clearLog' });
  logEntries.innerHTML = '';
});

clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Clear all sync history? Previously added releases will be synced again next time.')) {
    await chrome.runtime.sendMessage({ action: 'clearHistory' });
    clearHistoryBtn.textContent = 'History cleared';
    setTimeout(() => { clearHistoryBtn.textContent = 'Clear sync history'; }, 2000);
  }
});

exportBtn.addEventListener('click', async () => {
  clearError();
  setBackupButtons(true);
  try {
    const payload = await buildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newforme-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError('Export failed: ' + err.message);
  } finally {
    setBackupButtons(false);
  }
});

importBtn.addEventListener('click', () => {
  importFileInput.value = '';
  importFileInput.click();
});

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  if (!file) return;
  clearError();
  setBackupButtons(true);
  importBtn.textContent = 'Importing...';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const { added } = await applyImportedBackup(data);
    importBtn.textContent = `Done (+${added} added)`;
    setTimeout(() => { importBtn.textContent = 'Import JSON'; }, 3000);
  } catch (err) {
    showError('Import failed: ' + err.message);
    importBtn.textContent = 'Import JSON';
  } finally {
    setBackupButtons(false);
  }
});

// --- Listen for progress/completion from background ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'syncProgress') {
    progressText.textContent = message.message;
    if (message.total && message.current) {
      const pct = Math.round((message.current / message.total) * 100);
      progressFill.style.width = `${pct}%`;
    }
  }

  if (message.action === 'syncComplete') {
    const r = message.results;
    progressEl.classList.add('hidden');
    setSyncButtons(false);

    matchedStat.textContent = `${r.matched} matched`;
    skippedStat.textContent = `${r.skipped} already synced`;
    notFoundStat.textContent = `${r.notFound.length} not found`;
    tracksStat.textContent = `${r.tracksAdded} tracks added`;

    if (r.notFound.length > 0) {
      notFoundList.innerHTML = '';
      for (const name of r.notFound) {
        const li = document.createElement('li');
        li.textContent = name;
        notFoundList.appendChild(li);
      }
      notFoundSection.classList.remove('hidden');
    } else {
      notFoundSection.classList.add('hidden');
    }

    resultsEl.classList.remove('hidden');
  }

  if (message.action === 'syncError') {
    progressEl.classList.add('hidden');
    setSyncButtons(false);
    showError(message.error || 'Sync failed');
  }

  if (message.action === 'logAppended' && message.entries) {
    prependLogEntries(message.entries);
  }
});

// --- Start ---
init();
