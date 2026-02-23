async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function el(id) { return document.getElementById(id); }

function setPill(kind, text) {
  const b = el("badge");
  b.className = "pill " + (kind || "");
  b.textContent = text;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseSecurityTxt(text) {
  // Very practical parser:
  // - ignores empty lines
  // - ignores comment lines starting with "#"
  // - supports "Field: value"
  // - supports repeated fields (array)
  // - stores unknown fields too
  const fields = {}; // fieldLower -> { name, values[] }
  const rawLines = String(text || "").split(/\r?\n/);

  for (const line0 of rawLines) {
    const line = line0.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const m = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      // non-field line (could be invalid/garbage)
      if (!fields.__unparsed) fields.__unparsed = { name: "__unparsed", values: [] };
      fields.__unparsed.values.push(line0);
      continue;
    }

    const name = m[1];
    const value = m[2] || "";
    const key = name.toLowerCase();

    if (!fields[key]) fields[key] = { name, values: [] };
    fields[key].values.push(value);
  }

  return fields;
}

function looksLikeUrlOrMailto(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  if (/^mailto:/i.test(s)) return true;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function parseRfc3339Date(s) {
  // JS Date parses many formats; we restrict lightly to RFC3339-ish
  const v = String(s || "").trim();
  if (!v) return null;
  // Accept "YYYY-MM-DD" or full timestamp; RFC uses full date-time, but be forgiving
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function lint(fields) {
  // Returns { verdict: ok|warn|fail, score, issues[], parsedSummary[] }
  // Score starts at 100, subtract penalties.
  let score = 100;
  const issues = [];

  const contacts = fields["contact"]?.values || [];
  const expires = fields["expires"]?.values || [];
  const policy = fields["policy"]?.values || [];
  const prefLang = fields["preferred-languages"]?.values || [];
  const encryption = fields["encryption"]?.values || [];
  const acknowledgments = fields["acknowledgments"]?.values || [];
  const hiring = fields["hiring"]?.values || [];

  // Contact (practically required)
  if (contacts.length === 0) {
    issues.push({ level: "fail", msg: "Missing Contact: field (you should provide at least one security contact)." });
    score -= 60;
  } else {
    const bad = contacts.filter((c) => !looksLikeUrlOrMailto(c));
    if (bad.length) {
      issues.push({ level: "warn", msg: `Contact: has ${bad.length} value(s) that do not look like a URL or mailto:` });
      score -= 15;
    }
  }

  // Expires (strongly recommended; warn if missing; fail if in past)
  if (expires.length === 0) {
    issues.push({ level: "warn", msg: "Missing Expires: field (recommended so consumers know freshness)." });
    score -= 10;
  } else {
    const d = parseRfc3339Date(expires[0]);
    if (!d) {
      issues.push({ level: "warn", msg: "Expires: is present but not parseable as a date/time." });
      score -= 10;
    } else {
      const now = new Date();
      if (d.getTime() < now.getTime()) {
        issues.push({ level: "fail", msg: `Expires: is in the past (${d.toISOString()}).` });
        score -= 35;
      }
    }
  }

  // Policy (recommended)
  if (policy.length === 0) {
    issues.push({ level: "warn", msg: "Missing Policy: field (recommended; points to disclosure policy / instructions)." });
    score -= 5;
  } else {
    const bad = policy.filter((p) => !looksLikeUrlOrMailto(p));
    if (bad.length) {
      issues.push({ level: "warn", msg: "Policy: value(s) should usually be a URL." });
      score -= 5;
    }
  }

  // Preferred-Languages (nice to have)
  if (prefLang.length) {
    // very loose BCP47 check: letters/digits/hyphen, separated by comma
    const bad = prefLang
      .flatMap((x) => x.split(","))
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((tag) => !/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(tag));
    if (bad.length) {
      issues.push({ level: "warn", msg: `Preferred-Languages: contains non-BCP47-ish tag(s): ${bad.join(", ")}` });
      score -= 3;
    }
  }

  // Encryption / Acknowledgments / Hiring are optional; mild bonus if present
  const bonusCount = [encryption, acknowledgments, hiring].filter((a) => a.length > 0).length;
  score += Math.min(6, bonusCount * 2);

  // Unknown/unparsed lines
  if (fields.__unparsed?.values?.length) {
    issues.push({ level: "warn", msg: `Found ${fields.__unparsed.values.length} non “Field: value” line(s).` });
    score -= 5;
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  let verdict = "ok";
  if (issues.some((i) => i.level === "fail")) verdict = "fail";
  else if (issues.some((i) => i.level === "warn")) verdict = "warn";

  return { verdict, score, issues };
}

function renderFields(fields) {
  const knownOrder = [
    "contact", "expires", "encryption", "acknowledgments", "policy", "preferred-languages", "canonical", "hiring"
  ];

  const keys = Object.keys(fields).filter((k) => k !== "__unparsed");
  keys.sort((a, b) => {
    const ia = knownOrder.indexOf(a);
    const ib = knownOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  if (!keys.length) return "(none)";

  const parts = [];
  for (const k of keys) {
    const item = fields[k];
    const count = item.values.length;
    parts.push(`<code>${escapeHtml(item.name)}</code> × ${count}`);
  }
  return parts.join(" · ");
}

function renderIssues(issues) {
  const ul = el("issues");
  ul.innerHTML = "";
  if (!issues.length) {
    const li = document.createElement("li");
    li.textContent = "No issues found. Looks healthy.";
    ul.appendChild(li);
    return;
  }

  for (const it of issues) {
    const li = document.createElement("li");
    li.textContent = `${it.level.toUpperCase()}: ${it.msg}`;
    ul.appendChild(li);
  }
}

function renderAttempts(attempts) {
  const box = el("attempts");
  if (!attempts || !attempts.length) {
    box.textContent = "(none)";
    return;
  }

  box.innerHTML = attempts.map((a) => {
    const right = a.error
      ? `ERR: ${escapeHtml(a.error)}`
      : (a.status != null ? `HTTP ${a.status}` : "—");

    const ct = a.contentType ? ` · ${escapeHtml(a.contentType)}` : "";
    const ok = a.ok ? "✓" : "×";

    return `
      <div class="attempt">
        <div style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${ok} <a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.url)}</a>${ct}
        </div>
        <div class="muted" style="white-space: nowrap;">${right}</div>
      </div>
    `;
  }).join("");
}

function renderAll(result) {
  if (!result) {
    setPill("", "…");
    el("headline").textContent = "No data yet.";
    el("meta").textContent = "";
    el("content").textContent = "(no content)";
    el("fields").innerHTML = "(none)";
    el("scoreText").textContent = "—";
    el("scoreHint").textContent = "";
    renderIssues([]);
    renderAttempts([]);
    return;
  }

  const checkedAt = result.checkedAt ? new Date(result.checkedAt).toLocaleString() : "—";
  const tabUrl = result.tabUrl || "";

  if (!result.found) {
    setPill("fail", "FAIL");
    el("headline").textContent = "security.txt not found";
    el("meta").textContent = `Checked: ${checkedAt} · Tab: ${tabUrl}`;
    el("content").textContent = "(no security.txt found)";
    el("fields").innerHTML = "(none)";
    el("scoreText").textContent = "0/100";
    el("scoreHint").textContent = "Publish security.txt to enable responsible disclosure routing.";
    renderIssues([{ level: "fail", msg: "No endpoint returned a 2xx response." }]);
    renderAttempts(result.attempts || []);
    return;
  }

  const text = result.text || "";
  el("content").textContent = text;

  el("headline").textContent = "security.txt found";
  el("meta").innerHTML =
    `Found: <a href="${escapeHtml(result.foundUrl)}" target="_blank" rel="noreferrer">${escapeHtml(result.foundUrl)}</a>` +
    ` · ${result.contentType ? escapeHtml(result.contentType) : ""}` +
    ` · Checked: ${checkedAt}`;

  const fields = parseSecurityTxt(text);
  el("fields").innerHTML = renderFields(fields);

  const report = lint(fields);
  if (report.verdict === "ok") setPill("ok", "OK");
  else if (report.verdict === "warn") setPill("warn", "WARN");
  else setPill("fail", "FAIL");

  el("scoreText").textContent = `${report.score}/100`;

  if (report.verdict === "ok") {
    el("scoreHint").textContent = "Looks good. You can still add optional fields (Encryption/Acknowledgments/Hiring).";
  } else if (report.verdict === "warn") {
    el("scoreHint").textContent = "Usable, but consider fixing warnings for best practice & automation friendliness.";
  } else {
    el("scoreHint").textContent = "High risk for missed reports. Fix FAIL items first.";
  }

  renderIssues(report.issues);
  renderAttempts(result.attempts || []);
}

async function load() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const resp = await chrome.runtime.sendMessage({ type: "GET_TAB_RESULT", tabId: tab.id });
  renderAll(resp?.result || null);

  el("recheckBtn").addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ type: "FORCE_RECHECK", tabId: tab.id });
    renderAll(r?.result || null);
  });

  el("optionsBtn").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });

  el("copyBtn").addEventListener("click", async () => {
    const current = (await chrome.runtime.sendMessage({ type: "GET_TAB_RESULT", tabId: tab.id }))?.result;
    const text = current?.text || "";
    try {
      await navigator.clipboard.writeText(text);
      el("copyBtn").textContent = "Copied!";
      setTimeout(() => (el("copyBtn").textContent = "Copy"), 900);
    } catch {
      el("copyBtn").textContent = "Copy failed";
      setTimeout(() => (el("copyBtn").textContent = "Copy"), 900);
    }
  });
}

load();
