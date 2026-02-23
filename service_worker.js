// service_worker.js (MV3 service worker, module)

const DEFAULT_ENDPOINTS = ["/.well-known/security.txt", "/security.txt"];

const STORAGE_EXTRA_ENDPOINTS = "extraEndpoints"; // string[]
const STORAGE_TRY_HTTP = "tryHttpFallback"; // boolean

const TAB_CACHE_KEY_PREFIX = "tabResult:"; // stored in chrome.storage.session

function normalizePath(p) {
  let x = String(p || "").trim();
  if (!x) return "";
  if (!x.startsWith("/")) x = "/" + x;
  return x;
}

async function getSettings() {
  const data = await chrome.storage.sync.get([STORAGE_EXTRA_ENDPOINTS, STORAGE_TRY_HTTP]);
  const extra = Array.isArray(data[STORAGE_EXTRA_ENDPOINTS]) ? data[STORAGE_EXTRA_ENDPOINTS] : [];
  const tryHttpFallback = Boolean(data[STORAGE_TRY_HTTP]);

  return {
    extraEndpoints: extra.map(normalizePath).filter(Boolean),
    tryHttpFallback
  };
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildCandidateUrls(tabUrl, endpoints, tryHttpFallback) {
  const u = new URL(tabUrl);
  const host = u.hostname;

  const https = endpoints.map((ep) => `https://${host}${ep}`);
  if (!tryHttpFallback) return https;

  // RFC best practice is HTTPS; HTTP fallback is optional (user setting)
  const http = endpoints.map((ep) => `http://${host}${ep}`);
  return [...https, ...http];
}

async function fetchWithMeta(url) {
  const meta = { url, ok: false, status: null, statusText: null, contentType: null, error: null, text: null };

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store"
    });

    meta.status = res.status;
    meta.statusText = res.statusText;

    const ct = res.headers.get("content-type");
    meta.contentType = ct || null;

    if (res.ok) {
      meta.ok = true;
      meta.text = await res.text();
    } else {
      meta.ok = false;
    }
  } catch (e) {
    meta.error = String(e?.message || e);
  }

  return meta;
}

function quickLintState(text) {
  // ultra-lightweight check for badge: is there at least one "Contact:" line?
  // Case-insensitive, start of line preferred.
  if (!text) return "warn";
  const hasContact = /^contact\s*:/im.test(text);
  return hasContact ? "ok" : "warn";
}

async function setBadge(tabId, state) {
  // state: "checking" | "ok" | "warn" | "no"
  if (state === "ok") {
    await chrome.action.setBadgeText({ tabId, text: "OK" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2e7d32" });
    return;
  }
  if (state === "warn") {
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#f9a825" });
    return;
  }
  if (state === "no") {
    await chrome.action.setBadgeText({ tabId, text: "NO" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b71c1c" });
    return;
  }
  await chrome.action.setBadgeText({ tabId, text: "?" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#616161" });
}

async function cacheTabResult(tabId, payload) {
  const key = `${TAB_CACHE_KEY_PREFIX}${tabId}`;
  await chrome.storage.session.set({ [key]: payload });
}

async function getCachedTabResult(tabId) {
  const key = `${TAB_CACHE_KEY_PREFIX}${tabId}`;
  const data = await chrome.storage.session.get(key);
  return data[key] || null;
}

async function probeSecurityTxt(tabUrl) {
  const settings = await getSettings();
  const endpoints = [...DEFAULT_ENDPOINTS, ...settings.extraEndpoints]
    .map(normalizePath)
    .filter(Boolean);

  const candidates = buildCandidateUrls(tabUrl, endpoints, settings.tryHttpFallback);

  const attempts = [];
  for (const url of candidates) {
    const meta = await fetchWithMeta(url);
    attempts.push({
      url: meta.url,
      ok: meta.ok,
      status: meta.status,
      statusText: meta.statusText,
      contentType: meta.contentType,
      error: meta.error
    });

    if (meta.ok) {
      // Found first successful one
      return {
        found: true,
        foundUrl: meta.url,
        status: meta.status,
        contentType: meta.contentType,
        text: meta.text,
        attempts
      };
    }
  }

  return {
    found: false,
    foundUrl: null,
    status: null,
    contentType: null,
    text: null,
    attempts
  };
}

async function checkTab(tabId, tabUrl) {
  if (!tabUrl || !isHttpUrl(tabUrl)) {
    await setBadge(tabId, "checking");
    await cacheTabResult(tabId, {
      tabUrl: tabUrl || null,
      checkedAt: Date.now(),
      found: false,
      foundUrl: null,
      status: null,
      contentType: null,
      text: null,
      attempts: [],
      error: "Not an http(s) URL"
    });
    await setBadge(tabId, "no");
    return;
  }

  await setBadge(tabId, "checking");
  const result = await probeSecurityTxt(tabUrl);

  const payload = {
    tabUrl,
    checkedAt: Date.now(),
    ...result
  };

  await cacheTabResult(tabId, payload);

  if (!result.found) {
    await setBadge(tabId, "no");
  } else {
    const lint = quickLintState(result.text);
    await setBadge(tabId, lint === "ok" ? "ok" : "warn");
  }
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

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.url) checkTab(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_TAB_RESULT") {
      const cached = await getCachedTabResult(msg.tabId);
      sendResponse({ ok: true, result: cached });
      return;
    }

    if (msg?.type === "FORCE_RECHECK") {
      const tab = await chrome.tabs.get(msg.tabId);
      if (tab?.url) await checkTab(msg.tabId, tab.url);
      const cached = await getCachedTabResult(msg.tabId);
      sendResponse({ ok: true, result: cached });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })();

  return true;
});
