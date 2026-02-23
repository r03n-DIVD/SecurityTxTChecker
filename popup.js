async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(result) {
  const statusEl = document.getElementById("statusText");
  const urlEl = document.getElementById("foundUrl");
  const contentEl = document.getElementById("content");

  if (!result) {
    statusEl.textContent = "No data yet.";
    statusEl.className = "";
    urlEl.textContent = "";
    contentEl.textContent = "(no content)";
    return;
  }

  if (result.found) {
    statusEl.textContent = "FOUND ✓";
    statusEl.className = "ok";
    urlEl.innerHTML = `Source: <a href="${result.url}" target="_blank" rel="noreferrer">${result.url}</a> (HTTP ${result.status})`;
    contentEl.textContent = result.text || "";
  } else {
    statusEl.textContent = "NOT FOUND";
    statusEl.className = "no";
    urlEl.textContent = "";
    contentEl.textContent = "(no security.txt found on default/extra endpoints)";
  }
}

async function load() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const resp = await chrome.runtime.sendMessage({ type: "GET_TAB_RESULT", tabId: tab.id });
  setStatus(resp?.result || null);

  document.getElementById("recheckBtn").addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ type: "FORCE_RECHECK", tabId: tab.id });
    setStatus(r?.result || null);
  });

  document.getElementById("optionsBtn").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });
}

load();
