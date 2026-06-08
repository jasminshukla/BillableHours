/* Project Time Tracker — popup logic
 * Data model (chrome.storage.local):
 *   projects: [{ id, name, createdAt }]
 *   entries:  [{ id, projectId, projectName, start, end, durationMs, note }]
 *   active:   { projectId, projectName, start } | null   // a running timer
 */

const store = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },
  async set(obj) {
    return chrome.storage.local.set(obj);
  },
};

// ---- State ----
let projects = [];
let entries = [];
let active = null;
let tickHandle = null;

// ---- Helpers ----
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function fmtDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function fmtDurationShort(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = total % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showMsg(el, text, type = "") {
  el.textContent = text;
  el.className = "msg" + (type ? " " + type : "");
  if (text) {
    setTimeout(() => {
      el.textContent = "";
      el.className = "msg";
    }, 2500);
  }
}

// ---- Load ----
async function loadData() {
  const data = await store.get(["projects", "entries", "active"]);
  projects = data.projects || [];
  entries = data.entries || [];
  active = data.active || null;
}

// ---- Tabs ----
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("#tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "history") renderHistory();
      if (btn.dataset.tab === "projects") renderProjects();
    });
  });
}

// ---- Project select dropdowns ----
function renderProjectOptions() {
  const sel = $("#project-select");
  const filter = $("#history-filter");
  const prevSel = active ? active.projectId : sel.value;
  const prevFilter = filter.value;

  sel.innerHTML = '<option value="">— Select a project —</option>';
  filter.innerHTML = '<option value="">All projects</option>';

  for (const p of projects) {
    const o1 = document.createElement("option");
    o1.value = p.id;
    o1.textContent = p.name;
    sel.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = p.id;
    o2.textContent = p.name;
    filter.appendChild(o2);
  }
  sel.value = prevSel || "";
  filter.value = prevFilter || "";
}

// ---- Timer UI ----
function startTick() {
  stopTick();
  tickHandle = setInterval(updateTimerDisplay, 1000);
}
function stopTick() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

function updateTimerDisplay() {
  if (active) {
    $("#timer-display").textContent = fmtDuration(Date.now() - active.start);
  }
}

function renderTimerState() {
  const startBtn = $("#start-btn");
  const stopBtn = $("#stop-btn");
  const noteField = $("#note-field");
  const runningInfo = $("#timer-running-info");
  const sel = $("#project-select");

  if (active) {
    sel.value = active.projectId;
    sel.disabled = true;
    startBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    noteField.classList.remove("hidden");
    runningInfo.classList.remove("hidden");
    $("#running-project-name").textContent = active.projectName;
    $("#running-since").textContent = " · since " + fmtDate(active.start);
    updateTimerDisplay();
    startTick();
  } else {
    sel.disabled = false;
    startBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
    noteField.classList.add("hidden");
    runningInfo.classList.add("hidden");
    $("#timer-display").textContent = "00:00:00";
    stopTick();
  }
}

// ---- Actions ----
async function startTimer() {
  const sel = $("#project-select");
  const projectId = sel.value;
  if (!projectId) {
    showMsg($("#track-msg"), "Pick a project first.", "error");
    return;
  }
  const project = projects.find((p) => p.id === projectId);
  active = { projectId, projectName: project.name, start: Date.now() };
  await store.set({ active });
  renderTimerState();
}

async function stopTimer() {
  if (!active) return;
  const end = Date.now();
  const note = $("#note-input").value.trim();
  const entry = {
    id: uid(),
    projectId: active.projectId,
    projectName: active.projectName,
    start: active.start,
    end,
    durationMs: end - active.start,
    note,
  };
  entries.unshift(entry);
  active = null;
  await store.set({ entries, active: null });
  $("#note-input").value = "";
  renderTimerState();
  showMsg($("#track-msg"), "Saved: " + fmtDurationShort(entry.durationMs) + " logged.", "success");
}

async function addProject() {
  const input = $("#new-project-name");
  const name = input.value.trim();
  if (!name) {
    showMsg($("#project-msg"), "Enter a project name.", "error");
    return;
  }
  if (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    showMsg($("#project-msg"), "That project already exists.", "error");
    return;
  }
  projects.push({ id: uid(), name, createdAt: Date.now() });
  await store.set({ projects });
  input.value = "";
  renderProjects();
  renderProjectOptions();
  showMsg($("#project-msg"), "Project added.", "success");
}

async function deleteProject(id) {
  const project = projects.find((p) => p.id === id);
  if (!project) return;
  const count = entries.filter((e) => e.projectId === id).length;
  const ok = confirm(
    `Delete "${project.name}"` +
      (count ? ` and its ${count} logged ${count === 1 ? "entry" : "entries"}?` : "?")
  );
  if (!ok) return;

  projects = projects.filter((p) => p.id !== id);
  entries = entries.filter((e) => e.projectId !== id);
  if (active && active.projectId === id) {
    active = null;
    await store.set({ active: null });
  }
  await store.set({ projects, entries });
  renderProjects();
  renderProjectOptions();
  renderTimerState();
}

async function deleteEntry(id) {
  entries = entries.filter((e) => e.id !== id);
  await store.set({ entries });
  renderHistory();
}

// ---- Renderers ----
function renderProjects() {
  const list = $("#projects-list");
  list.innerHTML = "";
  if (projects.length === 0) {
    list.innerHTML = '<li class="empty-state">No projects yet. Add one above.</li>';
    return;
  }
  for (const p of projects) {
    const totalMs = entries
      .filter((e) => e.projectId === p.id)
      .reduce((sum, e) => sum + e.durationMs, 0);
    const count = entries.filter((e) => e.projectId === p.id).length;

    const li = document.createElement("li");
    li.className = "project-item";

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "p-name";
    nameEl.textContent = p.name;
    const metaEl = document.createElement("div");
    metaEl.className = "p-meta";
    metaEl.textContent = `${count} ${count === 1 ? "entry" : "entries"} · ${fmtDurationShort(totalMs)} total`;
    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-small btn-del";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteProject(p.id));

    li.appendChild(info);
    li.appendChild(delBtn);
    list.appendChild(li);
  }
}

function renderHistory() {
  const filterId = $("#history-filter").value;
  const list = $("#history-list");
  const summary = $("#history-summary");
  list.innerHTML = "";

  const filtered = filterId ? entries.filter((e) => e.projectId === filterId) : entries;

  const totalMs = filtered.reduce((sum, e) => sum + e.durationMs, 0);
  summary.innerHTML =
    `<strong>${filtered.length}</strong> ${filtered.length === 1 ? "session" : "sessions"} · ` +
    `<strong>${fmtDurationShort(totalMs)}</strong> tracked`;

  if (filtered.length === 0) {
    list.innerHTML = '<li class="empty-state">No work logged yet.</li>';
    return;
  }

  for (const e of filtered) {
    const li = document.createElement("li");
    li.className = "history-item";

    const top = document.createElement("div");
    top.className = "h-top";
    const proj = document.createElement("span");
    proj.className = "h-project";
    proj.textContent = e.projectName;
    const dur = document.createElement("span");
    dur.className = "h-duration";
    dur.textContent = fmtDurationShort(e.durationMs);
    top.appendChild(proj);
    top.appendChild(dur);

    const date = document.createElement("div");
    date.className = "h-date";
    date.textContent = fmtDate(e.start) + " → " + fmtDate(e.end);

    const note = document.createElement("div");
    if (e.note) {
      note.className = "h-note";
      note.textContent = e.note;
    } else {
      note.className = "h-note empty";
      note.textContent = "No note added.";
    }

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-small btn-del h-del";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteEntry(e.id));

    li.appendChild(top);
    li.appendChild(date);
    li.appendChild(note);
    li.appendChild(delBtn);
    list.appendChild(li);
  }
}

// ---- Init ----
async function init() {
  await loadData();
  initTabs();
  renderProjectOptions();
  renderProjects();
  renderHistory();
  renderTimerState();

  $("#start-btn").addEventListener("click", startTimer);
  $("#stop-btn").addEventListener("click", stopTimer);
  $("#add-project-btn").addEventListener("click", addProject);
  $("#new-project-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addProject();
  });
  $("#history-filter").addEventListener("change", renderHistory);
}

document.addEventListener("DOMContentLoaded", init);
