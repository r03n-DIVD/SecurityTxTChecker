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
  const fields = {}; // fieldLower -> { name, values[] }
  const rawLines = String(text || "").split(/\r?\n/);

  for (const line0 of rawLines) {
    const line = line0.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const m = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
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
  const v = String(s || "").trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function lint(fields) {
  let score = 100;
  const issues = [];

  const contacts = fields["contact"]?.values || [];
  const expires = fields["expires"]?.values || [];
  const policy = fields["policy"]?.values || [];
  const prefLang = fields["preferred-languages"]?.values || [];
  const encryption = fields["encryption"]?.values || [];
  const acknowledgments = fields["acknowledgments"]?.values || [];
  const hiring = fields["hiring"]?.values || [];

  if (contacts.length === 0) {
    issues.push({ level: "fail", msg: "Missing Contact: field (provide at least one security contact)." });
    score -= 60;
  } else {
    const bad = contacts.filter((c) => !looksLikeUrlOrMailto(c));
    if (bad.length) {
      issues.push({ level: "warn", msg: `Contact: has ${bad.length} value(s) that do not look like a URL or mailto.` });
      score -= 15;
    }
  }

  if (expires.length === 0) {
    issues.push({ level: "warn", msg: "Missing Expires: field (recommended)." });
    score -= 10;
  } else {
    const d = parseRfc3339Date(expires[0]);
    if (!d) {
      issues.push({ level: "warn", msg: "Expires: present but not parseable as a date/time." });
      score -= 10;
    } else if (d.getTime() < Date.now()) {
      issues.push({ level: "fail", msg: `Expires: is in the past (${d.toISOString()}).` });
      score -= 35;
    }
  }

  if (policy.length === 0) {
    issues.push({ level: "warn", msg: "Missing Policy: field (recommended; points to disclosure policy)." });
    score -= 5;
  } else {
    const bad = policy.filter((p) => !looksLikeUrlOrMailto(p));
    if (bad.length) {
      issues.push({ level: "warn", msg: "Policy: value(s) should usually be a URL." });
      score -= 5;
    }
  }

  if (prefLang.length) {
    const bad = prefLang
      .flatMap((x) => x.split(","))
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((tag) => !/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(tag));
    if (bad.length) {
      issues.push({ level: "warn", msg: `Preferred-Languages: contains suspicious tag(s): ${bad.join(", ")}` });
      score -= 3;
    }
  }

  const bonusCount = [encryption, acknowledgments, hiring].filter((a) => a.length > 0).length;
  score += Math.min(6, bonusCount * 2);

  if (fields.__unparsed?.values?.length) {
    issues.push({ level: "warn", msg: `Found ${fields.__unparsed.values.length} non “Field: value” line(s).` });
    score -= 5;
  }

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
    parts.push(`<code>${escapeHtml(item.name)}</code> × ${item.values.length}`);
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
        <div style="max-width: 310px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${ok} <a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.url)}</a>${ct}
        </div>
        <div class="muted" style="white-space: nowrap;">${right}</div>
      </div>
    `;
  }).join("");
}

// --- (3) Quick actions: open Contact/Policy/Found file ---
// Preference: open first "Contact:" that is mailto/https/http
function pickBestContact(fields) {
  const contacts = fields["contact"]?.values || [];
  for (const v of contacts) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (/^mailto:/i.test(s)) return s;
    try {
      const u = new URL(s);
      if (u.protocol === "https:" || u.protocol === "http:") return s;
    } catch {}
  }
  return null;
}

function pickBestPolicy(fields) {
  const policies = fields["policy"]?.values || [];
  for (const v of policies) {
    const s = String(v || "").trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === "https:" || u.protocol === "http:") return s;
    } catch {}
  }
  return null;
}

// --- Website contact scanning (email + phone) ---
// We fetch a few likely pages and grep for emails/phones.
// This is intentionally "best effort" (not crawling entire site).
const CONTACT_URL_PATHS = ["/", "/contact", "/contact-us", "/security", "/support"];

function uniq(arr) { return [...new Set(arr)]; }

function extractEmails(html) {
  const found = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  // filter common false positives in scripts can happen, but keep it
  return uniq(found.map((x) => x.toLowerCase()));
}

function extractPhones(html) {
  // NL/EU-ish: match +31..., 020..., 06..., etc (very loose)
  const matches = html.match(/(\+\d{1,3}[\s-]?)?(\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/g) || [];
  // Clean and keep plausible length
  const cleaned = matches
    .map((m) => m.replace(/\s+/g, " ").trim())
    .filter((m) => m.replace(/[^\d]/g, "").length >= 9);
  return uniq(cleaned);
}

async function fetchText(url) {
  const res = await fetch(url, { method: "GET", redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function scanSiteForContacts(host) {
  const urls = CONTACT_URL_PATHS.map((p) => `https://${host}${p}`);
  const results = { emails: [], phones: [], sources: [], errors: [] };

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const emails = extractEmails(html);
      const phones = extractPhones(html);

      if (emails.length || phones.length) {
        results.sources.push({ url, emails: emails.length, phones: phones.length });
      }

      results.emails.push(...emails);
      results.phones.push(...phones);
    } catch (e) {
      results.errors.push({ url, error: String(e?.message || e) });
    }
  }

  results.emails = uniq(results.emails);
  results.phones = uniq(results.phones);

  return results;
}

function renderSiteContactsScanResult(r) {
  const status = el("siteStatus");
  const out = el("siteResults");

  if (!r) {
    status.textContent = "(not scanned)";
    out.innerHTML = "";
    return;
  }

  const lines = [];
  status.textContent = `Scanned. Emails: ${r.emails.length} · Phones: ${r.phones.length}`;

  if (r.emails.length) {
    lines.push(`<div><strong>Emails</strong></div>`);
    for (const e of r.emails.slice(0, 20)) {
      lines.push(`<div>• <a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a></div>`);
    }
    if (r.emails.length > 20) lines.push(`<div class="muted">(+${r.emails.length - 20} more)</div>`);
  } else {
    lines.push(`<div class="muted">No emails found on scanned pages.</div>`);
  }

  if (r.phones.length) {
    lines.push(`<div style="margin-top:6px;"><strong>Phones</strong></div>`);
    for (const p of r.phones.slice(0, 20)) {
      // tel: should be digits+plus only
      const tel = p.replace(/[^\d+]/g, "");
      lines.push(`<div>• <a href="tel:${escapeHtml(tel)}">${escapeHtml(p)}</a></div>`);
    }
    if (r.phones.length > 20) lines.push(`<div class="muted">(+${r.phones.length - 20} more)</div>`);
  }

  if (r.sources.length) {
    lines.push(`<div style="margin-top:6px;" class="muted"><strong>Sources</strong></div>`);
    for (const s of r.sources) {
      lines.push(`<div class="muted">• ${escapeHtml(s.url)} (emails ${s.emails}, phones ${s.phones})</div>`);
    }
  }

  if (r.errors.length) {
    lines.push(`<div style="margin-top:6px;" class="muted"><strong>Errors</strong></div>`);
    for (const er of r.errors.slice(0, 4)) {
      lines.push(`<div class="muted">• ${escapeHtml(er.url)} → ${escapeHtml(er.error)}</div>`);
    }
  }

  out.innerHTML = lines.join("");
}

function renderAll(result) {
  // Reset quick actions
  el("openContactBtn").disabled = true;
  el("openPolicyBtn").disabled = true;
  el("openFoundBtn").disabled = true;
  el("quickHint").textContent = "";
  renderSiteContactsScanResult(null);

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

  if (!result.found) {
    setPill("fail", "FAIL");
    el("headline").textContent = "security.txt not found";
    el("meta").textContent = `Checked: ${checkedAt}`;
    el("content").textContent = "(no security.txt found)";
    el("fields").innerHTML = "(none)";
    el("scoreText").textContent = "0/100";
    el("scoreHint").textContent = "Publish security.txt to route vulnerability reports.";
    renderIssues([{ level: "fail", msg: "No endpoint returned a 2xx response." }]);
    renderAttempts(result.attempts || []);
    return;
  }

  el("headline").textContent = "security.txt found";
  el("meta").innerHTML =
    `Found: <a href="${escapeHtml(result.foundUrl)}" target="_blank" rel="noreferrer">${escapeHtml(result.foundUrl)}</a>` +
    ` · mode: ${escapeHtml(result.checkedHostMode || "host")}` +
    ` · Checked: ${checkedAt}`;

  const text = result.text || "";
  el("content").textContent = text;

  const fields = parseSecurityTxt(text);
  el("fields").innerHTML = renderFields(fields);

  const report = lint(fields);
  if (report.verdict === "ok") setPill("ok", "OK");
  else if (report.verdict === "warn") setPill("warn", "WARN");
  else setPill("fail", "FAIL");

  el("scoreText").textContent = `${report.score}/100`;
  el("scoreHint").textContent =
    report.verdict === "ok" ? "Looks good. Consider optional fields for maturity."
    : report.verdict === "warn" ? "Usable, but fix WARN items for best practice."
    : "High risk for missed reports. Fix FAIL items first.";

  renderIssues(report.issues);
  renderAttempts(result.attempts || []);

  // (3) Quick buttons
  const bestContact = pickBestContact(fields);
  const bestPolicy = pickBestPolicy(fields);

  if (bestContact) {
    el("openContactBtn").disabled = false;
    el("openContactBtn").onclick = () => chrome.tabs.create({ url: bestContact });
  } else {
    el("openContactBtn").onclick = null;
  }

  if (bestPolicy) {
    el("openPolicyBtn").disabled = false;
    el("openPolicyBtn").onclick = () => chrome.tabs.create({ url: bestPolicy });
  } else {
    el("openPolicyBtn").onclick = null;
  }

  if (result.foundUrl) {
    el("openFoundBtn").disabled = false;
    el("openFoundBtn").onclick = () => chrome.tabs.create({ url: result.foundUrl });
  } else {
    el("openFoundBtn").onclick = null;
  }

  // Hint: show what we’ll scan / what we found in security.txt
  const hints = [];
  if (!bestContact) hints.push("No usable Contact: value to open.");
  if (!bestPolicy) hints.push("No usable Policy: URL to open.");
  el("quickHint").textContent = hints.join(" ");
}

async function load() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return;

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

  // Site scan button
  el("scanSiteBtn").addEventListener("click", async () => {
    try {
      el("siteStatus").textContent = "Scanning…";
      el("siteResults").innerHTML = "";
      const host = new URL(tab.url).hostname;
      const r = await scanSiteForContacts(host);
      renderSiteContactsScanResult(r);
    } catch (e) {
      el("siteStatus").textContent = `Scan failed: ${String(e?.message || e)}`;
    }
  });
}

load();
