const STORAGE_EXTRA_ENDPOINTS = "extraEndpoints";
const STORAGE_TRY_HTTP = "tryHttpFallback";

function normalizePath(p) {
  let x = String(p || "").trim();
  if (!x) return "";
  if (!x.startsWith("/")) x = "/" + x;
  return x;
}

async function getAll() {
  const data = await chrome.storage.sync.get([STORAGE_EXTRA_ENDPOINTS, STORAGE_TRY_HTTP]);
  return {
    extra: Array.isArray(data[STORAGE_EXTRA_ENDPOINTS]) ? data[STORAGE_EXTRA_ENDPOINTS] : [],
    tryHttp: Boolean(data[STORAGE_TRY_HTTP])
  };
}

async function setExtra(extra) {
  await chrome.storage.sync.set({ [STORAGE_EXTRA_ENDPOINTS]: extra });
}

async function setTryHttp(v) {
  await chrome.storage.sync.set({ [STORAGE_TRY_HTTP]: Boolean(v) });
}

function render(list) {
  const ul = document.getElementById("list");
  ul.innerHTML = "";

  if (!list.length) {
    const li = document.createElement("li");
    li.textContent = "(none)";
    ul.appendChild(li);
    return;
  }

  for (const ep of list) {
    const li = document.createElement("li");

    const code = document.createElement("code");
    code.textContent = ep;

    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      const { extra } = await getAll();
      const next = extra.filter((x) => x !== ep);
      await setExtra(next);
      render(next);
    });

    li.appendChild(code);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function main() {
  const { extra, tryHttp } = await getAll();
  render(extra.map(normalizePath).filter(Boolean));

  const tryHttpEl = document.getElementById("tryHttp");
  tryHttpEl.checked = tryHttp;
  tryHttpEl.addEventListener("change", async () => {
    await setTryHttp(tryHttpEl.checked);
  });

  document.getElementById("addBtn").addEventListener("click", async () => {
    const input = document.getElementById("endpointInput");
    const ep = normalizePath(input.value);
    if (!ep) return;

    const { extra } = await getAll();
    const normalized = extra.map(normalizePath).filter(Boolean);

    if (!normalized.includes(ep)) {
      normalized.push(ep);
      await setExtra(normalized);
      render(normalized);
    }
    input.value = "";
  });
}

main();
