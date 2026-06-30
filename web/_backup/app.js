const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const steps = ["evidence", "extract", "plan", "followup", "ready"];
const agentStep = { ExtractorAgent: "extract", PlannerAgent: "plan", FollowUpAgent: "followup", Manager: "ready" };
const state = { example: null, files: [], result: null };

function updateRun() {
  $("#run").disabled = !($("#text").value.trim() || state.example || state.files.length);
  $("#hint").textContent = "";
}

function setStep(step) {
  const idx = steps.indexOf(step);
  document.querySelectorAll("#timeline li").forEach((li) => {
    const i = steps.indexOf(li.dataset.step);
    li.classList.remove("active", "done");
    if (i < idx) li.classList.add("done");
    if (i === idx) li.classList.add("active");
  });
}

function finishTimeline() {
  document.querySelectorAll("#timeline li").forEach((li) => {
    li.classList.remove("active");
    li.classList.add("done");
  });
}

function tags(items, cls = "") {
  return Array.isArray(items) && items.length
    ? `<div class="tags">${items.map((x) => `<span class="tag ${cls}">${esc(x)}</span>`).join("")}</div>`
    : "";
}

function citations(items) {
  return (items || []).flatMap((x) => x.citations || []);
}

async function loadExamples() {
  const names = await (await fetch("/api/examples")).json();
  const box = $("#examples");
  names.forEach((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = name.replace(/_/g, " ");
    button.onclick = () => {
      const active = state.example === name;
      document.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
      state.example = active ? null : name;
      if (!active) button.classList.add("active");
      updateRun();
    };
    box.appendChild(button);
  });
}

$("#text").addEventListener("input", updateRun);
$("#files").addEventListener("change", () => {
  state.files = Array.from($("#files").files || []);
  $("#file-list").innerHTML = "";
  state.files.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = `${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`;
    $("#file-list").appendChild(li);
  });
  updateRun();
});

$("#run").onclick = async () => {
  const fd = new FormData();
  fd.append("text", $("#text").value || "");
  if (state.example) fd.append("examples", state.example);
  state.files.forEach((f) => fd.append("files", f, f.name));
  $("#run").disabled = true;
  $("#hint").textContent = "";
  $("#evidence").innerHTML = "";
  $("#results").innerHTML = `<div class="empty">${icon("i-meeting")}<h2>Agents at work</h2><p>Building the action pack.</p></div>`;
  setStep("evidence");

  let job;
  try {
    job = await (await fetch("/api/process", { method: "POST", body: fd })).json();
  } catch (e) {
    $("#run").disabled = false;
    $("#hint").textContent = "Server not reachable.";
    return;
  }

  const es = new EventSource(`/api/events/${job.job_id}`);
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "progress") {
      $("#status").textContent = `${ev.agent}: ${ev.status}`;
      setStep(agentStep[ev.agent] || "evidence");
    }
    if (ev.type === "evidence") {
      const li = document.createElement("li");
      li.textContent = `${ev.name} - ${ev.kind}`;
      $("#evidence").appendChild(li);
    }
    if (ev.type === "error") {
      es.close();
      $("#run").disabled = false;
      $("#hint").textContent = ev.message;
    }
    if (ev.type === "result") {
      es.close();
      $("#run").disabled = false;
      finishTimeline();
      state.result = ev.data;
      renderResult(ev.data);
    }
  };
};

function renderResult(d) {
  const extract = d.extract || {};
  const plan = d.plan || {};
  const followup = d.followup || {};
  const confidence = Math.round((Number(plan.confidence) || 0) * 100);
  $("#results").innerHTML = `
    <div class="banner ${esc(plan.route)}">
      <div><h2>${esc(plan.route || "Action pack")}</h2><p>${esc(extract.summary)}</p></div>
      <div class="confidence"><strong>${confidence}%</strong><span>confidence</span></div>
    </div>
    <div class="grid">
      <section class="block"><h3>Decisions</h3>${(extract.decisions || []).map((x) => `<p><strong>${esc(x.decision)}</strong></p>${tags((x.citations || []).map((c) => c.line))}`).join("") || "<p>No decisions found.</p>"}</section>
      <section class="block"><h3>Action items</h3>${(extract.action_items || []).map((x) => `<p><strong>${esc(x.owner)}</strong>: ${esc(x.task)}${x.due ? ` by ${esc(x.due)}` : ""}</p>${tags([x.status], x.status === "ready" ? "" : "warn")}`).join("") || "<p>No action items found.</p>"}</section>
    </div>
    <section class="block"><h3>Execution plan</h3>${tags(plan.workstreams)}${tags(plan.blockers, "bad")}${tags(plan.calendar_followups, "warn")}${(plan.project_updates || []).map((x) => `<p>${esc(x)}</p>`).join("")}</section>
    <section class="block"><h3>Follow-up draft</h3><p><strong>${esc(followup.subject)}</strong></p><p>${esc(followup.message)}</p>${tags(followup.recipients)}</section>
    <section class="block"><h3>Transcript citations</h3>${citations([...(extract.decisions || []), ...(extract.action_items || [])]).map((c) => `<div class="cite"><strong>${esc(c.line)}</strong>${esc(c.quote)}</div>`).join("")}</section>
    <section class="block"><h3>Human review</h3><div class="actions"><button class="approve" id="approve">${icon("i-check")} Approve pack</button><button id="reject">Reject</button></div><div id="final" class="final" hidden></div></section>
    <section class="block audit"><h3>Audit trail</h3>${(d.audit_log || []).map((a) => `<div>[${esc(a.timestamp)}] ${esc(a.agent)}: ${esc(a.summary)}</div>`).join("")}</section>
  `;
  $("#approve").onclick = () => finalize("approved");
  $("#reject").onclick = () => finalize("rejected");
}

async function finalize(decision) {
  const final = $("#final");
  final.hidden = false;
  final.textContent = "Queuing reviewed pack...";
  const d = state.result;
  const fin = await (await fetch("/api/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, extract: d.extract, plan: d.plan, followup: d.followup }),
  })).json();
  final.textContent = fin.error ? fin.error : `${fin.action}: ${fin.action_summary}`;
}

loadExamples();
