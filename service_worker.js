// service_worker.js (MV3 service worker, module)

const DEFAULT_ENDPOINTS = ["/.well-known/security.txt", "/security.txt"];

const STORAGE_EXTRA_ENDPOINTS = "extraEndpoints"; // string[]
const STORAGE_TRY_HTTP = "tryHttpFallback"; // boolean

const TAB_CACHE_KEY_PREFIX = "tabResult:"; // chrome.storage.session

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

// --- (4) Registrable domain fallback (eTLD+1-ish heuristic) ---
// Real PSL is huge; this is a pragmatic heuristic with common multi-part suffixes.
const MULTIPART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "org.nz",
  "co.jp", "ne.jp", "or.jp",
  "com.br", "com.mx",
  "co.za",
  "com.sg",
  "co.in", "net.in", "org.in",
  "com.tr",
  "com.ar"
]);

function guessRegistrableDomain(hostname) {
  // Returns hostname itself if already apex-ish.
  // For foo.bar.co.uk -> bar.co.uk
  // For a.b.example.nl -> example.nl
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;

  const last2 = parts.slice(-2).join(".");
  const last3 = parts.slice(-3).join(".");

  // If ends with multipart suffix, registrable is last 3 labels
  if (MULTIPART_SUFFIXES.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  // Otherwise last 2 labels
  return parts.slice(-2).join(".");
}

// --- Case-variants for security.txt filename ---
function expandCaseVariantsForEndpoint(ep) {
  // If endpoint ends with /.../security.txt (any case), add variants.
  // Otherwise keep as-is.
  const m = /(\/)(security\.txt)$/i.exec(ep);
  if (!m) return [ep];

  const base = ep.replace(/security\.txt$/i, "security.txt");
  const variants = [
    base,
    base.replace(/security\.txt$/i, "Security.txt"),
    base.replace(/security\.txt$/i, "security.TXT"),
    base.replace(/security\.txt$/i, "SECURITY.TXT")
  ];

  // Unique
  return [...new Set(variants)];
}

function buildCandidateUrlsForHost(host, endpoints, tryHttpFallback) {
  const expandedEndpoints = endpoints
    .flatMap(expandCaseVariantsForEndpoint)
    .map(normalizePath)
    .filter(Boolean);

  const https = expandedEndpoints.map((ep) => `https://${host}${ep}`);
  if (!tryHttpFallback) return https;

  const http = expandedEndpoints.map((ep) => `http://${host}${ep}`);
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
    }
  } catch (e) {
    meta.error = String(e?.message || e);
  }

  return meta;
}

function quickLintState(text) {
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

  const u = new URL(tabUrl);
  const host = u.hostname;
  const apex = guessRegistrableDomain(host);

  // (4) Try host first, then apex if different
  const hostsToTry = host === apex ? [host] : [host, apex];

  const attempts = [];

  for (const h of hostsToTry) {
    const candidates = buildCandidateUrlsForHost(h, endpoints, settings.tryHttpFallback);

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
        return {
          found: true,
          foundUrl: meta.url,
          status: meta.status,
          contentType: meta.contentType,
          text: meta.text,
          attempts,
          checkedHost: h,
          checkedHostMode: h === host ? "host" : "apex"
        };
      }
    }
  }

  return {
    found: false,
    foundUrl: null,
    status: null,
    contentType: null,
    text: null,
    attempts,
    checkedHost: host,
    checkedHostMode: "host"
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

// Tab listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) checkTab(tabId, tab.url);
  if (changeInfo.url) checkTab(tabId, changeInfo.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab?.url) checkTab(tabId, tab.url);
});

// Messages for popup
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
