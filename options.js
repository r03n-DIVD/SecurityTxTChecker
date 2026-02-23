const STORAGE_KEY = "extraEndpoints";

function normalizePath(p) {
  let x = String(p || "").trim();
  if (!x) return "";
  if (!x.startsWith("/")) x = "/" + x;
  return x;
}

async function getExtra() {
  const { [STORAGE_KEY]: extra } = await chrome.storage.sync.get(STORAGE_KEY);
  return Array.isArray(extra) ? extra : [];
}

async function setExtra(extra) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: extra });
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
      const current = await getExtra();
      const next = current.filter((x) => x !== ep);
      await setExtra(next);
      render(next);
    });

    li.appendChild(code);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function main() {
  const current = await getExtra();
  render(current);

  document.getElementById("addBtn").addEventListener("click", async () => {
    const input = document.getElementById("endpointInput");
    const ep = normalizePath(input.value);
    if (!ep) return;

    const list = await getExtra();
    if (!list.includes(ep)) {
      list.push(ep);
      await setExtra(list);
      render(list);
    }
    input.value = "";
  });
}

main();
