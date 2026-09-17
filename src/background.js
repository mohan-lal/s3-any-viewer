// Service worker: installs the declarativeNetRequest rules that turn a presigned-S3 navigation
// (what the console's "Open" button does) into a navigation to our viewer page.
// Nothing here ever sees AWS credentials - only the already-signed URL the console produced.

const RULE_ALLOW_ATTACHMENT = 1;
const RULE_REDIRECT_PRESIGNED = 2;
const RULE_REDIRECT_PRESIGNED_CN = 3;

const DEFAULT_SETTINGS = { interceptEnabled: true, interceptDownloads: false };

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function viewerUrlFor(matchToken) {
  // \0 is the whole matched URL; it lands after '#' so it never leaves the browser (not sent to any server).
  return `${chrome.runtime.getURL('viewer.html')}#u=${matchToken}`;
}

async function applyRules() {
  const { interceptEnabled, interceptDownloads } = await getSettings();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map(r => r.id);
  const addRules = [];

  if (interceptEnabled) {
    if (!interceptDownloads) {
      // Higher priority "allow" so the console's Download button keeps downloading.
      addRules.push({
        id: RULE_ALLOW_ATTACHMENT,
        priority: 10,
        action: { type: 'allow' },
        condition: {
          regexFilter: '^https://[^/]+\\.amazonaws\\.com(\\.cn)?/.*response-content-disposition=attachment',
          resourceTypes: ['main_frame'],
        },
      });
    }
    // Any top-level navigation to a SigV4-presigned S3 URL -> open in the viewer instead.
    addRules.push({
      id: RULE_REDIRECT_PRESIGNED,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: viewerUrlFor('\\0') } },
      condition: {
        regexFilter: '^https://[^/]+\\.amazonaws\\.com/.*X-Amz-Signature=.*$',
        resourceTypes: ['main_frame'],
      },
    });
    addRules.push({
      id: RULE_REDIRECT_PRESIGNED_CN,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: viewerUrlFor('\\0') } },
      condition: {
        regexFilter: '^https://[^/]+\\.amazonaws\\.com\\.cn/.*X-Amz-Signature=.*$',
        resourceTypes: ['main_frame'],
      },
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  await chrome.action.setBadgeText({ text: interceptEnabled ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#777' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await applyRules();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-in-viewer',
      title: 'Open link in S3 Any Viewer',
      contexts: ['link'],
    });
  });
});
chrome.runtime.onStartup.addListener(applyRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.interceptEnabled || changes.interceptDownloads)) applyRules();
});

const isAwsHost = (hostname) => /(^|\.)amazonaws\.com(\.cn)?$/.test(hostname);

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'open-in-viewer' || !info.linkUrl) return;
  // Non-AWS origins need an optional host permission; a context-menu click counts as the user gesture
  // that permissions.request() requires, so ask here and the viewer can fetch straight away.
  try {
    const u = new URL(info.linkUrl);
    if (/^https?:$/.test(u.protocol) && !isAwsHost(u.hostname)) {
      const origins = [`${u.origin}/*`];
      if (!(await chrome.permissions.contains({ origins }))) await chrome.permissions.request({ origins });
    }
  } catch { /* the viewer shows its own grant button if this did not work */ }
  chrome.tabs.create({ url: viewerUrlFor(encodeURIComponent(info.linkUrl)) });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'applyRules') applyRules().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
