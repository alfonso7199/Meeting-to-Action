// MeetingToAction frontend logic

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const MAX_FILE_MB = 5;
const MAX_FILES = 6;
const ACCEPTED = new Set(["txt", "md", "vtt", "eml", "text"]);

const state = { files: [], example: null };
const session = { transcript: "" };

const dropzone = $("#dropzone");
const fileInput = $("#file-input");
const fileList = $("#file-list");
const runBtn = $("#run-btn");
const hint = $("#input-hint");

function extOf(name) { return (name.toLowerCase().split(".").pop() || ""); }

function appendAudit(summary) {
  const audit = document.querySelector(".audit");
  if (!audit) return;
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = el("div");
  line.innerHTML = `<span class="a-time">[${ts}]</span> <span class="a-agent">Reviewer</span>: ${esc(summary)}`;
  audit.appendChild(line);
}

// ---------- files ----------
function renderFiles() {
  fileList.innerHTML = "";
  state.files.forEach((f, i) => {
    const li = el("li");
    li.innerHTML = `<svg class="fl-icon"><use href="#i-doc"/></svg><span class="fl-name">${esc(f.name)}</span>` +
      `<span class="fl-kind">${(f.size / 1024).toFixed(0)} KB</span><button class="fl-x" title="Remove">&times;</button>`;
    li.querySelector(".fl-x").onclick = () => { state.files.splice(i, 1); renderFiles(); updateRun(); };
    fileList.appendChild(li);
  });
}
function addFiles(list) {
  const warnings = [];
  for (const f of list) {
    const ext = extOf(f.name);
    if (!ACCEPTED.has(ext)) { warnings.push(`${f.name}: unsupported type`); continue; }
    if (f.size > MAX_FILE_MB * 1024 * 1024) { warnings.push(`${f.name}: over ${MAX_FILE_MB} MB`); continue; }
    if (state.files.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (state.files.length >= MAX_FILES) { warnings.push(`max ${MAX_FILES} files`); break; }
    state.files.push(f);
  }
  renderFiles();
  updateRun();
  if (warnings.length) hint.textContent = "Skipped — " + warnings.join("; ");
}
function updateRun() {
  runBtn.disabled = !(state.files.length || $("#text-input").value.trim());
  hint.textContent = "";
}

dropzone.onclick = () => fileInput.click();
dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
$("#text-input").addEventListener("input", updateRun);

// ---------- examples ----------
async function loadExamples() {
  try {
    const names = await (await fetch("/api/examples")).json();
    if (!Array.isArray(names)) return;
    const box = $("#example-chips");
    names.forEach((n) => {
      const chip = el("button", "chip");
      chip.textContent = n.replace(/_/g, " ").replace(/^\d+\s*/, "");
      chip.onclick = async () => {
        const wasActive = state.example === n;
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        if (wasActive) { state.example = null; $("#text-input").value = ""; }
        else {
          chip.classList.add("active"); state.example = n;
          try { const d = await (await fetch("/api/example/" + encodeURIComponent(n))).json(); $("#text-input").value = d.text || ""; }
          catch (e) { /* ignore */ }
        }
        updateRun();
      };
      box.appendChild(chip);
    });
  } catch (e) { /* optional */ }
}

// ---------- stepper ----------
const STEPS = [
  { key: "extract", label: "Extract" },
  { key: "plan", label: "Plan" },
  { key: "followup", label: "Follow-up" },
  { key: "review", label: "Review" },
];
const AGENT_STEP = { ExtractorAgent: "extract", PlannerAgent: "plan", FollowUpAgent: "followup", Manager: "review" };

function buildStepper() {
  const ol = $("#stepper");
  ol.innerHTML = "";
  STEPS.forEach((s) => {
    const li = el("li");
    li.dataset.key = s.key;
    li.innerHTML = `<div class="s-label">${s.label}</div>`;
    ol.appendChild(li);
  });
}
function setStep(key) {
  const order = STEPS.map((s) => s.key);
  const idx = order.indexOf(key);
  if (idx < 0) return;
  document.querySelectorAll("#stepper li").forEach((li) => {
    const i = order.indexOf(li.dataset.key);
    li.classList.remove("active", "done");
    if (i < idx) li.classList.add("done");
    else if (i === idx) li.classList.add("active");
  });
}
function finishStepper() {
  document.querySelectorAll("#stepper li").forEach((li) => { li.classList.remove("active"); li.classList.add("done"); });
}

// ---------- run ----------
function startJob(fd) {
  $("#composer").classList.add("hidden");
  buildStepper();
  $("#board").classList.remove("hidden");
  $("#result").innerHTML = "";
  $("#run-status").textContent = "Starting agents...";
  $("#reset-row").classList.add("hidden");
  $("#board").scrollIntoView({ behavior: "smooth", block: "start" });

  (async () => {
    let job;
    try { job = await (await fetch("/api/process", { method: "POST", body: fd })).json(); }
    catch (e) { return showError("Could not reach the server. Is it running?"); }
    if (!job || !job.job_id) return showError("The server did not start a job.");

    let done = false;
    const es = new EventSource("/api/events/" + job.job_id);
    es.onmessage = (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === "progress") { setStep(AGENT_STEP[ev.agent] || "extract"); $("#run-status").textContent = `${ev.agent}: ${ev.status}`; }
      else if (ev.type === "note") $("#run-status").textContent = ev.message;
      else if (ev.type === "result") { done = true; es.close(); session.transcript = ev.transcript || session.transcript; renderResult(ev.data); }
      else if (ev.type === "error") { done = true; es.close(); showError(ev.message); }
    };
    es.onerror = () => { es.close(); if (!done) showError("Lost connection during processing. Please retry."); };
  })();
}

runBtn.onclick = () => {
  const fd = new FormData();
  fd.append("text", $("#text-input").value || "");
  state.files.forEach((f) => fd.append("files", f, f.name));
  startJob(fd);
};

function showError(message) {
  finishStepper();
  $("#run-status").textContent = "";
  $("#result").innerHTML = `<div class="card-block"><h3>${icon("i-alert")} Could not complete</h3>
    <p class="para">${esc(message)}</p>
    <p class="para" style="color:var(--muted)">Check that OPENAI_API_KEY is set in .env and the transcript is readable.</p></div>`;
  $("#reset-row").classList.remove("hidden");
}

// ---------- rendering helpers ----------
const pct = (v) => (v == null || isNaN(Number(v)) ? "—" : (Number(v) * 100).toFixed(0) + "%");
const tags = (arr, cls) => (Array.isArray(arr) && arr.length)
  ? `<div class="tagrow">${arr.map((t) => `<span class="tag ${cls || ""}">${esc(t)}</span>`).join("")}</div>` : "";
const cites = (arr) => (Array.isArray(arr) && arr.length)
  ? arr.map((c) => `<span class="cite" title="${esc(c.quote)}">${esc(c.line)}</span>`).join("") : "";

const ROUTE = { ready_to_send: "Ready to send", needs_review: "Needs review", blocked: "Blocked" };
const ACTION_LABEL = { followup_queued: "Follow-up queued", returned_for_edit: "Returned for edit" };
const KCOLS = [
  { key: "ready", name: "Ready" },
  { key: "needs_owner", name: "Needs owner" },
  { key: "needs_date", name: "Needs date" },
  { key: "blocked", name: "Blocked" },
];

function renderResult(d) {
  const r = $("#result");
  r.innerHTML = "";
  finishStepper();
  $("#run-status").textContent = "";

  const ex = d.extract || {}, plan = d.plan || {}, fu = d.followup || {};
  const routeLabel = ROUTE[plan.route] || esc(plan.route || "—");

  // meeting header
  const head = el("div", "card-block meeting-head");
  head.innerHTML = `<h3>${icon("i-board")} Meeting</h3>
    <p class="m-title">${esc(ex.meeting_title || "Untitled meeting")}</p>
    <p class="m-summary">${esc(ex.summary || "")}</p>
    <div class="participants">${(ex.participants || []).map((p) => `<span class="pp">${icon("i-user")}${esc(p)}</span>`).join("")}</div>`;
  r.appendChild(head);

  // route banner
  const banner = el("div", "banner route-" + (plan.route || "unknown"));
  banner.innerHTML = `<span class="b-dot"></span><div class="b-main">${routeLabel}</div><span class="b-conf">confidence ${pct(plan.confidence)}</span>`;
  r.appendChild(banner);
  if (plan.requires_human_review) {
    r.appendChild(el("div", "review-note", `${icon("i-alert")} Human review required before the follow-up goes out.`));
  }

  // action items kanban
  const items = Array.isArray(ex.action_items) ? ex.action_items : [];
  const kb = el("div", "card-block");
  let cols = "";
  KCOLS.forEach((col) => {
    const inCol = items.filter((it) => (it.status || "ready") === col.key);
    const cards = inCol.length ? inCol.map((it) => `
      <div class="kcard">
        <p class="kt">${esc(it.task)}</p>
        <div class="kmeta">
          ${it.owner ? `<span class="m">${icon("i-user")}${esc(it.owner)}</span>` : ""}
          ${it.due ? `<span class="m">${icon("i-clock")}${esc(it.due)}</span>` : ""}
        </div>
        ${cites(it.citations)}
      </div>`).join("") : `<p class="kcol-empty">None</p>`;
    cols += `<div class="kcol col-${col.key}">
      <div class="kcol-head"><span class="kc-name">${col.name}</span><span class="kc-count">${inCol.length}</span></div>
      ${cards}
    </div>`;
  });
  kb.innerHTML = `<h3>${icon("i-check")} Action items</h3><div class="kanban">${cols}</div>`;
  r.appendChild(kb);

  // decisions
  if (Array.isArray(ex.decisions) && ex.decisions.length) {
    const dec = el("div", "card-block");
    dec.innerHTML = `<h3>${icon("i-flag")} Decisions</h3>
      <ul class="dlist">${ex.decisions.map((x) => `<li>${esc(x.decision)}${x.owner ? ` <span class="owner">— ${esc(x.owner)}</span>` : ""}<br>${cites(x.citations)}</li>`).join("")}</ul>`;
    r.appendChild(dec);
  }

  // risks + open questions
  const rq = el("div", "cols-2");
  rq.innerHTML = `
    <div class="card-block"><h3>${icon("i-alert")} Risks</h3>${(ex.risks && ex.risks.length) ? `<ul class="dlist">${ex.risks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="para" style="color:var(--muted)">None flagged.</p>`}</div>
    <div class="card-block"><h3>${icon("i-doc")} Open questions</h3>${(ex.open_questions && ex.open_questions.length) ? `<ul class="dlist">${ex.open_questions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="para" style="color:var(--muted)">None.</p>`}
      ${ex.missing_fields && ex.missing_fields.length ? `<p class="subhead">Missing for execution</p>${tags(ex.missing_fields, "warn")}` : ""}</div>`;
  r.appendChild(rq);

  // execution plan
  const pl = el("div", "card-block");
  pl.innerHTML = `<h3>${icon("i-board")} Execution plan</h3>
    ${plan.workstreams && plan.workstreams.length ? `<p class="subhead">Workstreams</p>${tags(plan.workstreams)}` : ""}
    ${plan.project_updates && plan.project_updates.length ? `<p class="subhead">Project updates</p><ul class="dlist">${plan.project_updates.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${plan.calendar_followups && plan.calendar_followups.length ? `<p class="subhead">Calendar follow-ups</p><ul class="dlist">${plan.calendar_followups.map((x) => `<li>${icon("i-cal")} ${esc(x)}</li>`).join("")}</ul>` : ""}
    ${plan.blockers && plan.blockers.length ? `<p class="subhead">Blockers</p>${tags(plan.blockers, "bad")}` : ""}`;
  r.appendChild(pl);

  // follow-up email + decision
  const mail = el("div", "card-block");
  const cur = plan.route || "";
  const opts = Object.keys(ROUTE).map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${ROUTE[k]}</option>`).join("");
  mail.innerHTML = `<h3>${icon("i-mail")} Follow-up email</h3>
    <div class="email">
      <p class="e-subj">${esc(fu.subject || "(no subject)")}</p>
      <p class="e-to">To: ${(fu.recipients || []).map(esc).join(", ") || "—"}</p>
      <div class="e-body">${esc(fu.message || "")}</div>
    </div>
    <div class="override">
      <label class="ov-label">Plan route <select class="ov-route">${opts}</select></label>
      <textarea class="ov-note" rows="2" placeholder="Reviewer note (optional) — recorded in the audit trail"></textarea>
    </div>
    <div class="actions">
      <button class="btn-approve">${icon("i-check")} Approve &amp; queue</button>
      <button class="btn-reject">Return for edit</button>
      <button class="btn-ghost btn-dl">${icon("i-download")} Download JSON</button>
    </div>
    <div class="decision-made" style="color:var(--muted)"></div>`;
  r.appendChild(mail);

  const note = mail.querySelector(".decision-made");
  const approveBtn = mail.querySelector(".btn-approve");
  const rejectBtn = mail.querySelector(".btn-reject");
  const routeSel = mail.querySelector(".ov-route");
  const noteEl = mail.querySelector(".ov-note");

  async function finalize(decision) {
    approveBtn.disabled = rejectBtn.disabled = true;
    note.style.color = "var(--muted)";
    note.innerHTML = `<span class="spinner"></span> Triggering downstream action...`;
    const chosenRoute = routeSel ? routeSel.value : plan.route;
    const reviewerNote = noteEl ? noteEl.value.trim() : "";
    const overridden = chosenRoute !== plan.route;
    const planOut = Object.assign({}, plan, { route: chosenRoute });
    try {
      const fin = await (await fetch("/api/finalize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, extract: d.extract, plan: planOut, followup: d.followup, note: reviewerNote }),
      })).json();
      if (fin.error) { note.textContent = "Could not finalize: " + fin.error; note.style.color = "var(--red)"; approveBtn.disabled = rejectBtn.disabled = false; return; }
      note.textContent = "";
      appendAudit(`${decision}` + (overridden ? ` · route overridden to ${ROUTE[chosenRoute] || chosenRoute}` : "") + (reviewerNote ? ` · note: ${reviewerNote}` : ""));
      renderOutcome(decision, fin, r, d, { approveBtn, rejectBtn, note });
    } catch (e) { note.textContent = "Could not finalize. Please retry."; note.style.color = "var(--red)"; approveBtn.disabled = rejectBtn.disabled = false; }
  }
  approveBtn.onclick = () => finalize("approved");
  rejectBtn.onclick = () => finalize("rejected");
  mail.querySelector(".btn-dl").onclick = () => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = "action_pack.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // audit
  const au = el("div", "card-block");
  au.innerHTML = `<h3>${icon("i-clip")} Audit trail</h3><div class="audit">` +
    (d.audit_log || []).map((e) => `<div><span class="a-time">[${esc(e.timestamp)}]</span> <span class="a-agent">${esc(e.agent)}</span>: ${esc(e.summary)}</div>`).join("") + `</div>`;
  r.appendChild(au);

  reevalPanel(r);
  $("#reset-row").classList.remove("hidden");
  r.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOutcome(decision, fin, r, full, controls) {
  full.decision = decision; full.finalization = fin;
  const ok = decision === "approved";
  const p = el("div", "card-block");
  p.innerHTML = `<h3>${icon(ok ? "i-check" : "i-alert")} Outcome</h3>
    <div class="flagline ${ok ? "flag-yes" : "flag-no"}">${icon(ok ? "i-check" : "i-alert")} ${esc(ACTION_LABEL[fin.action] || fin.action || "")} — ${esc(fin.action_summary || "")}</div>
    ${Array.isArray(fin.next_steps) && fin.next_steps.length ? `<p class="subhead">Next steps</p><ul class="next">${fin.next_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <div class="actions"><button class="btn-ghost btn-reopen">${icon("i-redo")} Reopen for review</button></div>`;
  p.querySelector(".btn-reopen").onclick = () => {
    p.remove();
    if (controls) { controls.approveBtn.disabled = false; controls.rejectBtn.disabled = false; controls.note.textContent = ""; }
    appendAudit("action pack reopened for review");
  };
  r.appendChild(p);
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function reevalPanel(r) {
  const p = el("div", "card-block");
  p.innerHTML = `<h3>${icon("i-upload")} Add notes &amp; re-run</h3>
    <p class="para" style="color:var(--muted)">Captured a correction or extra context (owner, date, decision)? Add it and re-run the agents over the transcript.</p>
    <textarea class="re-text" rows="3" placeholder="e.g. Maya owns the rollback runbook; due next Friday"></textarea>
    <div class="actions">
      <label class="btn-ghost re-file-label">${icon("i-upload")} Add files</label>
      <input type="file" class="re-files" multiple hidden accept=".txt,.md,.vtt,.eml,.text">
      <span class="re-fname" style="color:var(--muted)"></span>
      <button class="btn-approve re-run">${icon("i-redo")} Re-run</button>
    </div>`;
  const fin = p.querySelector(".re-files");
  const fname = p.querySelector(".re-fname");
  let extra = [];
  p.querySelector(".re-file-label").onclick = () => fin.click();
  fin.onchange = () => { extra = Array.from(fin.files); fname.textContent = extra.map((f) => f.name).join(", "); };
  p.querySelector(".re-run").onclick = () => {
    const txt = p.querySelector(".re-text").value.trim();
    if (!txt && !extra.length) { fname.textContent = "Add a note or a file first."; return; }
    const fd = new FormData();
    fd.append("text", (session.transcript || "") + "\n\n=== ADDED NOTES (reviewer) ===\n" + txt);
    extra.forEach((f) => fd.append("files", f, f.name));
    startJob(fd);
  };
  r.appendChild(p);
}

// ---------- reset ----------
$("#reset-btn").onclick = () => {
  state.files = []; state.example = null;
  fileInput.value = ""; $("#text-input").value = "";
  renderFiles();
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  $("#board").classList.add("hidden");
  $("#reset-row").classList.add("hidden");
  $("#composer").classList.remove("hidden");
  updateRun();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

loadExamples();

/* ============================================================
   Bring-your-own OpenAI key (for public / self-hosted demo).
   Adds a top-bar button; stores the key in localStorage and
   sends it as X-OpenAI-Key on every /api/ request. The server
   uses it if present, otherwise falls back to its .env key.
   ============================================================ */
(function () {
  var KEY = "OPENAI_KEY";
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    var k = localStorage.getItem(KEY);
    if (k && typeof url === "string" && url.indexOf("/api/") === 0) {
      opts = Object.assign({}, opts);
      opts.headers = Object.assign({}, opts.headers || {}, { "X-OpenAI-Key": k });
    }
    return _fetch(url, opts);
  };

  var ACC = "var(--accent, var(--teal, var(--accent-deep, #2563eb)))";
  var CARD = "var(--card, var(--panel, var(--paper, #ffffff)))";
  var INK = "var(--ink, #1a1a1a)";
  var LINE = "var(--line, #dddddd)";
  var MUTED = "var(--muted, var(--slate, var(--muted-ink, #888888)))";
  var css =
    ".kk-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid " + LINE + ";background:" + CARD + ";color:" + INK + ";font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer}" +
    ".kk-btn:hover{border-color:" + ACC + "}" +
    ".kk-dot{width:8px;height:8px;border-radius:50%;background:#d9a33a}" +
    ".kk-dot.on{background:#2aa676}" +
    ".kk-ov{position:fixed;inset:0;background:rgba(10,15,20,.55);display:grid;place-items:center;z-index:99999;padding:20px}" +
    ".kk-card{background:" + CARD + ";color:" + INK + ";border:1px solid " + LINE + ";border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:inherit}" +
    ".kk-card h4{margin:0 0 6px;font-size:18px}" +
    ".kk-card p{margin:0 0 14px;font-size:13px;color:" + MUTED + "}" +
    ".kk-card input{width:100%;box-sizing:border-box;border:1px solid " + LINE + ";border-radius:10px;padding:11px 13px;font:inherit;font-size:14px;background:" + CARD + ";color:" + INK + "}" +
    ".kk-card input:focus{outline:none;border-color:" + ACC + "}" +
    ".kk-row{display:flex;gap:10px;margin-top:14px}" +
    ".kk-save{flex:1;border:none;cursor:pointer;background:" + ACC + ";color:#fff;border-radius:10px;padding:11px;font:inherit;font-weight:600}" +
    ".kk-clear{border:1px solid " + LINE + ";background:transparent;color:" + INK + ";border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit;font-weight:600}" +
    ".kk-note{margin-top:12px;font-size:11.5px;color:" + MUTED + ";line-height:1.5}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "kk-btn";
  btn.type = "button";
  function refresh() {
    var has = !!localStorage.getItem(KEY);
    btn.innerHTML = '<span class="kk-dot' + (has ? " on" : "") + '"></span>' + (has ? "API key set" : "Add API key");
  }
  function mount() {
    var h = document.querySelector(".nav-inner") || document.querySelector(".topbar");
    if (!h) {
      btn.style.position = "fixed"; btn.style.top = "14px"; btn.style.right = "16px"; btn.style.zIndex = "9998";
      document.body.appendChild(btn);
    } else {
      h.appendChild(btn);
    }
    refresh();
  }
  btn.onclick = function () {
    var ov = document.createElement("div"); ov.className = "kk-ov";
    var cur = localStorage.getItem(KEY) || "";
    var card = document.createElement("div"); card.className = "kk-card";
    card.innerHTML =
      "<h4>OpenAI API key</h4>" +
      "<p>Use your own key to run this demo. It is stored only in this browser and sent to your local server with each request.</p>" +
      '<input type="password" class="kk-in" placeholder="sk-..." autocomplete="off">' +
      '<div class="kk-row"><button class="kk-save" type="button">Save</button><button class="kk-clear" type="button">Clear</button></div>' +
      '<div class="kk-note">Stored in your browser (localStorage) on this device only. Never commit your key to the repo. If you leave this empty, the server uses its own .env key.</div>';
    ov.appendChild(card);
    card.querySelector(".kk-in").value = cur;
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    card.querySelector(".kk-save").onclick = function () {
      var v = card.querySelector(".kk-in").value.trim();
      if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
      refresh(); ov.remove();
    };
    card.querySelector(".kk-clear").onclick = function () { localStorage.removeItem(KEY); refresh(); ov.remove(); };
    document.body.appendChild(ov);
    card.querySelector(".kk-in").focus();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
