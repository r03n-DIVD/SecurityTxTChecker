// service_worker.js (MV3 service worker, module)

const DEFAULT_ENDPOINTS = ["/.well-known/security.txt", "/security.txt"];
const STORAGE_KEY = "extraEndpoints"; // array of strings
const TAB_CACHE_KEY_PREFIX = "tabResult:"; // stored in chrome.storage.session

async function getExtraEndpoints() {
  const { [STORAGE_KEY]: extra } = await chrome.storage.sync.get(STORAGE_KEY);
  if (!Array.isArray(extra)) return [];
  return extra
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .map(normalizePath);
}

function normalizePath(p) {
  // Ensure it starts with "/" and has no whitespace
  let x = String(p || "").trim();
  if (!x) return "";
  if (!x.startsWith("/")) x = "/" + x;
  // Do NOT force trailing slash; security.txt is a file path.
  return x;
}

function buildCandidateUrls(tabUrl, endpoints) {
  const u = new URL(tabUrl);
  const host = u.hostname;

  // RFC 9116 expects HTTPS delivery; we always try https://HOST first.
  // (Even if user browses http, we still probe https.)
  return endpoints.map((ep) => `https://${host}${ep}`);
}

async function probeSecurityTxt(tabUrl) {
  const extra = await getExtraEndpoints();
  const endpoints = [...DEFAULT_ENDPOINTS, ...extra]
    .map(normalizePath)
    .filter(Boolean);

  const candidates = buildCandidateUrls(tabUrl, endpoints);

  // Try endpoints in order; first successful 200 (or any ok-ish) wins
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        // no-cors would make it opaque; we want text, so keep default mode
        cache: "no-store"
      });

      // Many servers return 200 with text/plain; some may set other content-types.
      if (res.ok) {
        const text = await res.text();
        return {
          found: true,
          url,
          status: res.status,
          text
        };
      }
    } catch (e) {
      // ignore and continue
    }
  }

  return {
    found: false,
    url: null,
    status: null,
    text: null
  };
}

async function setBadge(tabId, state) {
  // state: "checking" | "found" | "notfound"
  if (state === "found") {
    await chrome.action.setBadgeText({ tabId, text: "OK" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2e7d32" });
    return;
  }
  if (state === "notfound") {
    await chrome.action.setBadgeText({ tabId, text: "NO" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b71c1c" });
    return;
  }
  await chrome.action.setBadgeText({ tabId, text: "?" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#616161" });
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function cacheTabResult(tabId, result, tabUrl) {
  // Use session storage to survive service worker sleeping
  const key = `${TAB_CACHE_KEY_PREFIX}${tabId}`;
  await chrome.storage.session.set({
    [key]: {
      tabUrl,
      checkedAt: Date.now(),
      ...result
    }
  });
}

async function getCachedTabResult(tabId) {
  const key = `${TAB_CACHE_KEY_PREFIX}${tabId}`;
  const data = await chrome.storage.session.get(key);
  return data[key] || null;
}

async function checkTab(tabId, tabUrl) {
  if (!tabUrl || !isHttpUrl(tabUrl)) {
    await setBadge(tabId, "checking");
    await cacheTabResult(tabId, {
      found: false,
      url: null,
      status: null,
      text: null,
      error: "Not an http(s) URL"
    }, tabUrl || null);
    await setBadge(tabId, "notfound");
    return;
  }

  await setBadge(tabId, "checking");
  const result = await probeSecurityTxt(tabUrl);
  await cacheTabResult(tabId, result, tabUrl);
  await setBadge(tabId, result.found ? "found" : "notfound");
}

// Re-check when tab finishes loading or URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    checkTab(tabId, tab.url);
  }
  if (changeInfo.url) {
    checkTab(tabId, changeInfo.url);
  }
});

// Re-check when switching tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.url) checkTab(tabId, tab.url);
});

// Provide data to popup/options
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_TAB_RESULT") {
      const tabId = msg.tabId;
      const cached = await getCachedTabResult(tabId);
      sendResponse({ ok: true, result: cached });
      return;
    }

    if (msg?.type === "FORCE_RECHECK") {
      const tabId = msg.tabId;
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) await checkTab(tabId, tab.url);
      const cached = await getCachedTabResult(tabId);
      sendResponse({ ok: true, result: cached });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();

  return true; // keep channel open for async response
});
