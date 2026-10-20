import { icon } from "./icons.js";
import { PAGES, heading } from "./nav.js";
import { formatStamp } from "./model.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

export function statusChip(state, label) {
  const mapped = state === "auth" ? "gated" : state === "redirect" ? "redirect" : state === "running" ? "gated" : state || "unknown";
  const mark = { ok: "✓", fail: "!", warn: "!", stale: "◷", unknown: "−", gated: "−", redirect: "→" }[mapped] || "−";
  const shown = mapped === "gated" && state === "running" ? "↻" : mark;
  return `<span class="status ${esc(mapped)}"><span class="status-mark" aria-hidden="true">${shown}</span>${esc(label)}</span>`;
}

export function healthBadge(state, label) {
  const mapped = { ok: "ok", fail: "fail", warn: "warn", stale: "stale", unknown: "unknown", auth: "gated", running: "running", redirect: "redirect" }[state] || "unknown";
  const mark = { ok: "✓", fail: "!", warn: "!", stale: "◷", unknown: "−", auth: "−", running: "↻", redirect: "→" }[state] || "−";
  return `<span class="deploy-health-status ${mapped}"><span aria-hidden="true">${mark}</span> ${esc(label)}</span>`;
}

export function portrait(avatar, initials) {
  if (avatar) {
    return `<span class="avatar avatar-portrait"><img src="assets/portraits/${esc(avatar)}.svg" alt=""></span>`;
  }
  return `<span class="avatar">${esc(initials || "?")}</span>`;
}

export function shellDocument({ page, config, theme, content, sourceNote, boot, now }) {
  const board = config.board || {};
  const name = board.name || "Your Ops";
  const word = board.wordmark || name.toLowerCase();
  const footer = board.footer || `${name} · private`;
  const initials = board.ownerInitials || "YN";
  const owner = board.ownerName || "Your name";
  const role = board.ownerRole || "Personal workspace";
  const h1 = heading(page, config);
  const accent = config.theme?.accent;
  const accentStyle = accent && accent.toLowerCase() !== "#2452ce"
    ? `<style>:root{--accent:${esc(accent)}}</style>`
    : "";
  const title = `${page.crumb} — ${name}`;
  return `<!doctype html>
<html lang="en" data-theme="${theme === "dark" ? "dark" : "light"}" data-direction="switchboard">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="icon" type="image/svg+xml" href="favicon.svg"><link rel="stylesheet" href="css/switchboard.css">${accentStyle}<script>try{var t=localStorage.getItem("opsboard.theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}</script></head>
<body data-view="${esc(page.view)}"><a class="skip" href="#main">Skip to workspace</a><div class="app-frame"><aside class="app-rail"><a class="brand" href="index.html" aria-label="${esc(name)} overview"><img class="brand-mark" src="favicon.svg" alt="" width="42" height="42"><span>${esc(word)}</span></a>
    <button class="mobile-menu-trigger" type="button" data-menu aria-controls="mobile-menu" aria-expanded="false" aria-haspopup="dialog">${icon("menu")}<span>Menu</span></button>
    <nav class="workspace-nav" aria-label="Workspace">${navLinks(page.id, "main")}</nav>
    <div class="rail-footer"><a class="nav-item${page.id === "settings" ? " active" : ""}" href="settings.html"${page.id === "settings" ? ' aria-current="page"' : ""}>${icon("sliders")}<span>Settings</span></a><div class="profile"><span>${esc(initials)}</span><div><strong>${esc(owner)}</strong><small>${esc(role)}</small></div></div></div></aside>
    <div class="workspace"><header class="workspace-bar"><div class="breadcrumb"><span>Workspace</span><span>/</span><strong>${esc(page.crumb)}</strong></div><div class="workspace-actions"><button class="search-trigger" type="button" data-search aria-label="Find anything" aria-keyshortcuts="/" title="Search workspace (/)">${icon("search")}<span>Find anything</span></button><button class="theme-button" type="button" data-theme aria-label="${theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}" title="${theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}">${icon(theme === "dark" ? "sun" : "moon")}</button></div></header>
    <main id="main" tabindex="-1"><header class="page-heading"><div><h1>${esc(h1)}</h1></div></header>
    <div id="page-content">${content}</div><div id="source-note" aria-live="polite">${sourceNote}</div><footer class="workspace-footer"><span>${esc(footer)}</span><button type="button" data-about>How status works</button></footer></main></div></div>
    ${mobileMenu(page.id)}
    <dialog id="search-dialog" aria-labelledby="search-title"><button class="dialog-close" type="button" data-close aria-label="Close search">${icon("close")}</button><div class="search-title"><h2 id="search-title">Find anything</h2></div><label class="search-input">${icon("search")}<input data-search-input type="search" placeholder="Machines, apps, agents, runbooks" aria-label="Find anything"></label><div data-search-results></div></dialog>
    <dialog id="about-dialog" aria-labelledby="about-title"><button class="dialog-close" type="button" data-close aria-label="Close">${icon("close")}</button><h2 id="about-title">How status works</h2><p>Every badge is an observation with a time. Fresh, stale, unknown, and failed stay distinct. A missing report is never shown as healthy.</p><ul class="notes-list"><li><strong>Responding / Checks normal.</strong> A check succeeded inside its expiry window.</li><li><strong>Sign-in required.</strong> The host answered 401 or 403. That is evidence, not a pass and not a crash.</li><li><strong>No recent data.</strong> The last report is older than its expiry.</li><li><strong>Failed.</strong> The check ran and the result was bad.</li><li><strong>Not connected.</strong> Nothing has reported. Add a check before you trust the silence.</li></ul><p>The browser never receives tokens, SSH keys, or heartbeat secrets. Those stay in environment variables and in the status Action.</p></dialog>
    <dialog id="inspector" aria-labelledby="inspector-title"></dialog>
    <script type="application/json" id="opsboard-boot">${boot}</script>
    <script type="module" src="js/app.js"></script>
    <noscript><p class="noscript-note">This view was rendered with the saved config. Theme, search, demo toggle, and Settings need JavaScript.</p></noscript>
</body></html>`;
}

function navLinks(current, group) {
  const main = PAGES.filter((item) => item.group === "main").map((item) => link(item, current)).join("");
  const reference = PAGES.filter((item) => item.group === "reference").map((item) => link(item, current)).join("");
  if (group === "mobile") {
    return `${main}<details class="mobile-reference"><summary>${icon("book")}<span>Reference</span>${icon("chevron").replace('class="icon"', 'class="icon reference-chevron"')}</summary><div class="mobile-reference-links">${reference}</div></details><a class="nav-item${current === "settings" ? " active" : ""}" href="settings.html">${icon("sliders")}<span>Settings</span></a>`;
  }
  return `${main}<span class="nav-group-label">Reference</span>${reference}`;
}

function link(item, current) {
  const active = item.id === current;
  return `<a class="nav-item${active ? " active" : ""}" href="${item.file}"${active ? ' aria-current="page"' : ""}>${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
}

function mobileMenu(current) {
  return `<dialog id="mobile-menu" aria-labelledby="mobile-menu-title"><div class="mobile-menu-header"><h2 id="mobile-menu-title" tabindex="-1">Workspace</h2><button class="mobile-menu-close" type="button" data-close-menu aria-label="Close menu">${icon("close")}<span>Close</span></button></div><nav class="mobile-menu-links" aria-label="Workspace">${navLinks(current, "mobile")}</nav></dialog>`;
}

export function sourceNote({ demo, blank, now, timeZone }) {
  const stamp = formatStamp(now, timeZone);
  if (blank) {
    return `<div class="source-note">${icon("clock")}<span>No saved checks yet · everything you add is written to <code>switchboard.config.json</code></span></div>`;
  }
  if (demo) {
    return `<div class="source-note">${icon("clock")}<span>Sample data · not live · ${esc(stamp)}</span><button type="button" data-refresh>Reload saved checks</button></div>`;
  }
  return `<div class="source-note">${icon("clock")}<span>Saved checks · ${esc(stamp)}</span><button type="button" data-refresh>Reload saved checks</button></div>`;
}

export function demoNotice() {
  return `<aside class="monitoring-report-notice" aria-label="Demo data"><div><strong>Demo data — connect your own</strong><p>Everything shown is sample data. No machine, site, repo, or agent is connected.</p></div><div class="filter-row" role="group" aria-label="Demo data"><button type="button" class="active" data-demo="on" aria-pressed="true">Demo data on</button><button type="button" data-demo="off" aria-pressed="false">Off</button></div><a href="settings.html">Connect your own ${icon("arrow")}</a></aside>`;
}

export function publicNotice() {
  return `<aside class="monitoring-report-notice" aria-label="Public dashboard"><div><strong>This dashboard is public.</strong><p>Anyone who can open this page can see your hostnames. Put it behind an auth gate before you share real data. Keep SSH checks, heartbeats, and private endpoints on a private network.</p></div></aside>`;
}
