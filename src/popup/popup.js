import { FORMAT_LABELS } from '../lib/formats.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

const settings = await chrome.storage.sync.get({ interceptEnabled: true, interceptDownloads: false });
$('interceptEnabled').checked = settings.interceptEnabled;
$('interceptDownloads').checked = settings.interceptDownloads;

for (const id of ['interceptEnabled', 'interceptDownloads']) {
  $(id).addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ [id]: e.target.checked });
    const res = await chrome.runtime.sendMessage({ type: 'applyRules' });
    status(res?.ok ? 'Saved.' : `Failed: ${res?.error || 'unknown'}`);
  });
}

$('urlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('urlInput').value.trim();
  let origin;
  try { origin = new URL(url).origin; } catch { status('Invalid URL'); return; }
  if (!/\.amazonaws\.com(\.cn)?$/.test(new URL(url).hostname)) {
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
    if (!granted) { status('Permission denied for ' + origin); return; }
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') + '#u=' + encodeURIComponent(url) });
  window.close();
});

$('openLocal').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') + '#local=1' });
  window.close();
});

const formats = $('formats');
for (const label of FORMAT_LABELS) {
  const s = document.createElement('span');
  s.textContent = label;
  formats.appendChild(s);
}
