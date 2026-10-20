import { PAGES } from "./nav.js";
import { renderDocument } from "./document.js";
import { demoTestSeed, slugId } from "./pages.js";
import { renderInspector } from "./pages.js";
import { describeChanges, emptyBoard, isBlank, materializeStatus, searchIndex } from "./model.js";
import { validate, maskConfig } from "./validate.js";
import { probeTarget } from "./probe.js";

const boot = JSON.parse(document.getElementById("opsboard-boot").textContent);
const params = new URLSearchParams(location.search);
if (params.has("demo")) localStorage.setItem("opsboard.demo", params.get("demo") === "0" || params.get("demo") === "off" ? "0" : "1");
if (params.get("theme") === "dark" || params.get("theme") === "light") localStorage.setItem("opsboard.theme", params.get("theme"));

const state = {
  now: Date.now(),
  draft: null,
  baseline: null,
  tests: null,
  errors: [],
  liveStatus: boot.liveStatus,
};

try {
  const savedDraft = sessionStorage.getItem("opsboard.draft");
  if (savedDraft) {
    state.draft = JSON.parse(savedDraft);
    state.baseline = JSON.parse(sessionStorage.getItem("opsboard.baseline") || savedDraft);
    state.tests = JSON.parse(sessionStorage.getItem("opsboard.tests") || "null");
    state.errors = JSON.parse(sessionStorage.getItem("opsboard.errors") || "[]");
  }
} catch { /* ignore a broken session draft */ }

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function demoOn() {
  const stored = localStorage.getItem("opsboard.demo");
  if (stored === "0") return false;
  if (stored === "1") return true;
  const source = boot.userConfig || boot.demoConfig;
  return source?.board?.demo !== false;
}

function savedUser() {
  try {
    const raw = localStorage.getItem("opsboard.userConfig");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore broken local draft */ }
  return boot.userConfig || null;
}

function viewModel() {
  if (demoOn()) {
    return { demo: true, config: boot.demoConfig, status: boot.demoStatus, blank: false };
  }
  const user = savedUser();
  if (user && !isBlank(user)) return { demo: false, config: user, status: state.liveStatus, blank: false };
  return { demo: false, config: user || emptyBoard(boot.demoConfig), status: { schemaVersion: 1, observations: [] }, blank: true };
}

function ensureDraft() {
  const view = viewModel();
  if (!state.draft) {
    state.draft = clone(view.config);
    state.baseline = clone(view.config);
  }
  if (!state.tests) state.tests = view.demo ? demoTestSeed(state.now) : {};
}

function theme() {
  const stored = localStorage.getItem("opsboard.theme");
  if (stored === "light" || stored === "dark") return stored;
  const mode = (boot.userConfig || boot.demoConfig)?.theme?.mode || "system";
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function pageId() {
  const file = location.pathname.split("/").pop() || "index.html";
  return (PAGES.find((page) => page.file === file) || PAGES[0]).id;
}

function paint() {
  ensureDraft();
  const view = viewModel();
  const y = window.scrollY;
  const html = renderDocument({
    pageId: pageId(),
    config: view.config,
    status: materializeStatus(view.status, state.now),
    demo: view.demo,
    blank: view.blank,
    now: state.now,
    theme: theme(),
    draft: state.draft,
    baseline: state.baseline,
    tests: state.tests,
    changes: describeChanges(state.baseline, state.draft),
    errors: state.errors,
    appId: params.get("app") || "",
    bootJson: JSON.stringify(boot).replace(/</g, "\\u003c"),
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script").forEach((node) => node.remove());
  document.title = parsed.title;
  document.documentElement.dataset.theme = parsed.documentElement.dataset.theme;
  document.body.replaceWith(parsed.body);
  window.scrollTo(0, y);
  try {
    sessionStorage.setItem("opsboard.draft", JSON.stringify(state.draft));
    sessionStorage.setItem("opsboard.baseline", JSON.stringify(state.baseline));
    sessionStorage.setItem("opsboard.tests", JSON.stringify(state.tests));
    sessionStorage.setItem("opsboard.errors", JSON.stringify(state.errors));
  } catch { /* session storage can be unavailable */ }
}

function resetDraftToView() {
  const view = viewModel();
  state.draft = clone(view.config);
  state.baseline = clone(view.config);
  state.tests = view.demo ? demoTestSeed(state.now) : {};
  state.errors = [];
}

function setDemo(on) {
  localStorage.setItem("opsboard.demo", on ? "1" : "0");
  if (state.draft) state.draft.board = { ...state.draft.board, demo: on };
  resetDraftToView();
  paint();
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formData(form) {
  const data = {};
  for (const field of form.elements) {
    if (field.name) data[field.name] = field.value.trim();
  }
  return data;
}

function addEntity(kind, data) {
  const draft = state.draft;
  if (kind === "machine") {
    const id = slugId(data.name);
    draft.machines.push({
      id,
      name: data.name,
      role: "Added from Settings",
      kind: "linux",
      location: "Unplaced",
      locationKind: "home",
      host: data.host,
      user: data.user || "deploy",
      auth: "ssh-key",
      keyEnv: data.keyEnv || `SSH_KEY_${id.toUpperCase().replace(/-/g, "_")}`,
      knownHostsEnv: "SSH_KNOWN_HOSTS",
      checks: [
        { adapter: "ssh-uptime", options: { maxAge: "15m" } },
        { adapter: "heartbeat", options: { file: `heartbeats/${id}.json`, maxAge: "15m", tokenEnv: `HEARTBEAT_TOKEN_${id.toUpperCase().replace(/-/g, "_")}` } },
      ],
    });
  } else if (kind === "app") {
    const id = slugId(data.name);
    draft.apps.push({
      id,
      name: data.name,
      url: data.healthUrl,
      healthUrl: data.healthUrl,
      host: data.host || "",
      summary: "Added from Settings",
      checks: [{ adapter: "http", options: { expect: [200, 401, 403], maxAge: "2h" } }],
    });
  } else if (kind === "repo") {
    const id = slugId(`repo-${data.repo}`);
    draft.repos.push({
      id,
      name: data.repo,
      repo: data.repo,
      branch: data.branch || "main",
      workflow: data.workflow || "deploy.yml",
      tokenEnv: data.tokenEnv || "GITHUB_TOKEN",
      checks: [{ adapter: "github-actions", options: { workflow: data.workflow || "deploy.yml", branch: data.branch || "main", tokenEnv: data.tokenEnv || "GITHUB_TOKEN" } }],
    });
  } else if (kind === "agent") {
    const id = slugId(data.name);
    draft.agents.push({
      id,
      name: data.name,
      role: data.role || "Agent",
      reportsTo: data.reportsTo || "you",
      avatar: data.avatar || "robot-1",
      heartbeat: data.heartbeat || "",
      checks: [{ adapter: "heartbeat", options: { url: data.heartbeat || "", maxAge: "2h" } }],
    });
  }
  paint();
}

function specFor(kind, id) {
  const draft = state.draft;
  if (kind === "machine") {
    const machine = (draft.machines || []).find((item) => item.id === id);
    const beat = (machine?.checks || []).find((check) => check.adapter === "heartbeat" && check.options?.url);
    if (beat?.options?.url) return { kind: "heartbeat", url: beat.options.url };
    return { kind: "ssh" };
  }
  if (kind === "app") {
    const app = (draft.apps || []).find((item) => item.id === id);
    return { kind: "http", url: app?.healthUrl || app?.url || "" };
  }
  if (kind === "repo") {
    const repo = (draft.repos || []).find((item) => item.id === id);
    return { kind: "github", repo: repo?.repo || "" };
  }
  if (kind === "agent") {
    const agent = (draft.agents || []).find((item) => item.id === id);
    if (agent?.heartbeat) return { kind: "heartbeat", url: agent.heartbeat };
    return { kind: "file" };
  }
  return { kind: "static" };
}

async function runTest(kind, id, spec) {
  state.tests = { ...state.tests, [id]: { state: "testing", label: "Testing…", at: new Date().toISOString() } };
  paint();
  const remote = await probeServer(kind, id, spec);
  const result = remote || await probeTarget(spec);
  state.tests = { ...state.tests, [id]: { ...result, at: new Date().toISOString() } };
  paint();
}

async function probeServer(kind, id, spec) {
  try {
    const response = await fetch("/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, spec, draft: state.draft }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !body.label) return null;
    return body;
  } catch {
    return null;
  }
}

async function saveDraft() {
  state.errors = validate(state.draft, boot.schema);
  if (state.errors.length) {
    paint();
    return;
  }
  const text = `${JSON.stringify(state.draft, null, 2)}\n`;
  localStorage.setItem("opsboard.userConfig", text.trim());
  state.baseline = clone(state.draft);
  download("switchboard.config.json", text);
  try {
    await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: text });
  } catch { /* static host: the download is the save */ }
  paint();
}

function fillSearch(query) {
  const view = viewModel();
  const box = document.querySelector("[data-search-results]");
  if (!box) return;
  const needle = query.trim().toLowerCase();
  const rows = searchIndex(view.config).filter((item) => !needle || item.text.includes(needle)).slice(0, 8);
  box.innerHTML = rows.length
    ? rows.map((item) => `<a class="search-result" href="${item.href}"><span></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.kind)}</small></span></a>`).join("")
    : `<p class="empty-search">Nothing matches.</p>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function filterApps() {
  const query = (document.querySelector("[data-filter-apps]")?.value || "").trim().toLowerCase();
  const mode = document.querySelector("[data-app-filter].active")?.dataset.appFilter || "all";
  for (const card of document.querySelectorAll("[data-app-grid] .app-card")) {
    const name = (card.dataset.name || "").toLowerCase();
    const site = card.dataset.siteState || "";
    const modeOk = mode === "all"
      || (mode === "fail" && site === "fail")
      || (mode === "auth" && (site === "auth" || site === "gated"))
      || (mode === "ok" && site === "ok");
    card.hidden = !(name.includes(query) && modeOk);
  }
  const visible = [...document.querySelectorAll("[data-app-grid] .app-card")].filter((card) => !card.hidden).length;
  const count = document.getElementById("app-count");
  if (count) count.textContent = `${visible} apps`;
}

document.addEventListener("click", (event) => {
  const menu = event.target.closest("[data-menu]");
  if (menu) {
    document.getElementById("mobile-menu")?.showModal();
    menu.setAttribute("aria-expanded", "true");
    return;
  }
  if (event.target.closest("[data-close-menu]")) {
    document.getElementById("mobile-menu")?.close();
    document.querySelector("[data-menu]")?.setAttribute("aria-expanded", "false");
    return;
  }
  if (event.target.closest("button[data-theme]")) {
    const next = theme() === "dark" ? "light" : "dark";
    localStorage.setItem("opsboard.theme", next);
    paint();
    return;
  }
  const demo = event.target.closest("[data-demo]");
  if (demo) {
    setDemo(demo.dataset.demo === "on");
    return;
  }
  if (event.target.closest("[data-search]")) {
    const dialog = document.getElementById("search-dialog");
    dialog?.showModal();
    dialog?.querySelector("input")?.focus();
    fillSearch("");
    return;
  }
  if (event.target.closest("[data-about]")) {
    document.getElementById("about-dialog")?.showModal();
    return;
  }
  if (event.target.closest("[data-close]")) {
    event.target.closest("dialog")?.close();
    return;
  }
  const jump = event.target.closest("[data-href]");
  if (jump) {
    const href = jump.dataset.href;
    if (href.startsWith("#")) {
      location.hash = href.slice(1);
      document.getElementById(href.slice(1))?.scrollIntoView({ block: "start" });
    } else {
      location.href = href;
    }
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) {
    const [kind, id] = open.dataset.open.split(":");
    const view = viewModel();
    const dialog = document.getElementById("inspector");
    if (!dialog) return;
    dialog.innerHTML = renderInspector(kind, id, { config: view.config, status: materializeStatus(view.status, state.now), now: state.now });
    dialog.showModal();
    return;
  }
  const filter = event.target.closest("[data-app-filter]");
  if (filter) {
    for (const button of document.querySelectorAll("[data-app-filter]")) {
      button.classList.toggle("active", button === filter);
      button.setAttribute("aria-pressed", button === filter ? "true" : "false");
    }
    filterApps();
    return;
  }
  const test = event.target.closest("[data-test]");
  if (test) {
    runTest(test.dataset.test, test.dataset.id, specFor(test.dataset.test, test.dataset.id));
    return;
  }
  const formTest = event.target.closest("[data-test-form]");
  if (formTest) {
    const form = document.getElementById(formTest.dataset.testForm === "machine" ? "add-machine" : `add-${formTest.dataset.testForm}`);
    const data = form ? formData(form) : {};
    const kind = formTest.dataset.testForm;
    const spec = kind === "machine" ? { kind: "ssh" }
      : kind === "app" ? { kind: "http", url: data.healthUrl }
      : kind === "repo" ? { kind: "github", repo: data.repo }
      : data.heartbeat ? { kind: "heartbeat", url: data.heartbeat } : { kind: "file" };
    const slot = document.querySelector(`[data-form-result="${kind}"]`);
    if (slot) slot.innerHTML = `<span class="status gated"><span class="status-mark" aria-hidden="true">↻</span>Testing…</span>`;
    probeTarget(spec).then((result) => {
      if (!slot) return;
      const klass = result.state === "pass" ? "ok" : "fail";
      slot.innerHTML = `<span class="status ${klass}"><span class="status-mark" aria-hidden="true">${result.state === "pass" ? "✓" : "!"}</span>${result.label}</span> <span class="record-label">${escapeHtml(result.reason || "")}</span>`;
    });
    return;
  }
  if (event.target.closest("[data-toggle-form]")) {
    const id = event.target.closest("[data-toggle-form]").dataset.toggleForm;
    const form = document.getElementById(id);
    if (form) form.hidden = !form.hidden;
    return;
  }
  if (event.target.closest("[data-save]")) {
    saveDraft();
    return;
  }
  if (event.target.closest("[data-copy]")) {
    const text = JSON.stringify(maskConfig(state.draft), null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    return;
  }
  if (event.target.closest("[data-discard]")) {
    resetDraftToView();
    paint();
    return;
  }
  if (event.target.closest("[data-refresh]")) {
    refresh();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-add]");
  if (!form) return;
  event.preventDefault();
  addEntity(form.dataset.add, formData(form));
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-filter-apps]")) filterApps();
  if (event.target.matches("[data-search-input]")) fillSearch(event.target.value);
  if (event.target.matches("[data-filter-runbooks]")) {
    const needle = event.target.value.trim().toLowerCase();
    for (const link of document.querySelectorAll(".task-link")) {
      link.hidden = needle && !link.textContent.toLowerCase().includes(needle);
    }
  }
});

document.addEventListener("keydown", (event) => {
  const typing = event.target.matches("input, textarea");
  if (event.key === "/" && !typing) {
    event.preventDefault();
    document.getElementById("search-dialog")?.showModal();
    document.querySelector("[data-search-input]")?.focus();
    fillSearch("");
  }
  if (event.key === "Escape") {
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  }
});

document.addEventListener("click", (event) => {
  if (event.target instanceof HTMLDialogElement) event.target.close();
});

async function refresh() {
  if (!demoOn()) {
    try {
      const response = await fetch("status.json", { cache: "no-store" });
      if (response.ok) state.liveStatus = await response.json();
    } catch { /* keep the previous snapshot */ }
  }
  state.now = Date.now();
  paint();
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!localStorage.getItem("opsboard.theme")) paint();
});

paint();
