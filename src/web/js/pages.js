import { icon } from "./icons.js";
import { esc, statusChip, healthBadge, portrait, demoNotice, publicNotice } from "./shell.js";
import {
  attentionItems,
  findObservation,
  metricsFor,
  reportPhrase,
  ago,
  isBlank,
} from "./model.js";
import { maskConfig } from "./validate.js";

const DEMO_TESTS = {
  "acme-vps-1": { state: "pass", label: "Pass", reason: "Connected", ageMs: 120000 },
  "acme-vps-2": { state: "pass", label: "Pass", reason: "Connected", ageMs: 120000 },
  "build-box-01": { state: "fail", label: "Fail", reason: "SSH timed out after 10s", ageMs: 60000 },
  "laptop-dev": { state: "untested", label: "Not tested", reason: "" },
  "example-app": { state: "testing", label: "Testing…", reason: "" },
  "api-gateway": { state: "pass", label: "Pass", reason: "HTTP 200", ageMs: 300000 },
  "docs-site": { state: "pass", label: "Pass", reason: "HTTP 200", ageMs: 300000 },
  "status-page": { state: "untested", label: "Not tested", reason: "" },
  "repo-example-app": { state: "pass", label: "Pass", reason: "Workflow visible", ageMs: 180000 },
  "repo-infra": { state: "fail", label: "Fail", reason: "Token missing repo scope", ageMs: 180000 },
  "repo-docs-site": { state: "pass", label: "Pass", reason: "Workflow visible", ageMs: 180000 },
  "repo-status-page": { state: "untested", label: "Not tested", reason: "" },
  "triage-bot": { state: "pass", label: "Pass", reason: "Heartbeat is fresh", ageMs: 60000 },
  "deploy-bot": { state: "testing", label: "Testing…", reason: "" },
  "review-bot": { state: "untested", label: "Not tested", reason: "" },
};

export function demoTestSeed(now) {
  const out = {};
  for (const [id, row] of Object.entries(DEMO_TESTS)) {
    out[id] = { ...row, at: row.ageMs ? new Date(now - row.ageMs).toISOString() : null };
  }
  return out;
}

export function renderPage(ctx) {
  const notices = [];
  if (ctx.demo) notices.push(demoNotice());
  else if (!ctx.blank && (ctx.config.board?.auth || "none") === "none") notices.push(publicNotice());
  const body = {
    overview: renderOverview,
    machines: renderMachines,
    network: renderNetwork,
    home: renderHome,
    agents: renderAgents,
    apps: renderApps,
    ship: renderShip,
    runbooks: renderRunbooks,
    auth: renderAccess,
    knowledge: renderKnowledge,
    backlog: renderBacklog,
    settings: renderSettings,
  }[ctx.page.id] || renderOverview;
  return notices.join("") + body(ctx);
}

function machineIcon(machine) {
  if (machine.icon) return machine.icon;
  if (machine.kind === "vps") return "server";
  return "monitor";
}

function locationIcon(kind) {
  if (kind === "cloud") return "cloud";
  if (kind === "edge") return "flow";
  return "home";
}

function machineCard(machine, ctx, extra = "") {
  const obs = findObservation(ctx.status, ctx.now, machine.id, "machine") || findObservation(ctx.status, ctx.now, machine.id);
  const metrics = metricsFor(ctx.status, ctx.now, machine.id);
  const state = obs?.state || "unknown";
  const label = obs?.label || "Not connected";
  const stale = state === "stale" || state === "unknown";
  const readings = metrics
    ? `<div class="machine-readings${stale ? " readings-old" : ""}"><dl><div><dt>CPU</dt><dd>${esc(metrics.cpu)}%</dd></div><div><dt>Memory</dt><dd>${esc(metrics.memory)}%</dd></div><div><dt>Disk</dt><dd>${esc(metrics.disk)}%</dd></div></dl></div>`
    : `<p class="empty-readings">No readings in this report.</p>`;
  return `<button class="machine-card" type="button" data-open="machine:${esc(machine.id)}"${extra}><div class="machine-top"><span class="asset-icon">${icon(machineIcon(machine))}</span>${icon("arrow")}</div><h3>${esc(machine.name)}</h3><p>${esc(machine.role || machine.kind || "Machine")}</p><div data-health-readings="${esc(machine.id)}">${readings}</div><div class="machine-bottom">${statusChip(state, label)}<span data-machine-report-time="${esc(machine.id)}"><span class="machine-report-time${stale ? " readings-old" : ""}">${esc(reportPhrase(obs, ctx.now))}</span></span></div></button>`;
}

function groupMachines(config) {
  const groups = [];
  for (const machine of config.machines || []) {
    const name = machine.location || "Unplaced";
    let group = groups.find((item) => item.name === name);
    if (!group) {
      group = { name, kind: machine.locationKind || "home", machines: [] };
      groups.push(group);
    }
    group.machines.push(machine);
  }
  return groups;
}

function renderOverview(ctx) {
  if (ctx.blank) return renderEmpty(ctx);
  const items = attentionItems(ctx.config, ctx.status, ctx.now);
  const hidden = items.length ? "" : " hidden";
  const attention = `<section class="attention-panel" aria-labelledby="attention-title"${hidden}><div class="section-head"><h2 id="attention-title" tabindex="-1">Worth a look</h2></div><p class="attention-summary">${items.length} item${items.length === 1 ? "" : "s"} from saved checks</p><div class="attention-list">${items.map(attentionRow).join("")}</div></section>`;
  const groups = groupMachines(ctx.config).map((group) => {
    const noun = group.machines.every((machine) => machine.kind === "vps") ? "VPS servers" : "machines";
    return `<div class="location-head"><span>${icon(locationIcon(group.kind))}${esc(group.name)}</span><span>${group.machines.length} ${noun}</span></div><div class="machine-grid">${group.machines.map((machine) => machineCard(machine, ctx)).join("")}</div>`;
  }).join("");
  const deviceCount = (ctx.config.devices?.groups || []).length;
  const home = deviceCount
    ? `<button class="home-strip" type="button" data-href="home-it.html"><span class="home-symbol">${icon("home")}</span><span><strong>Your home &amp; devices.</strong><span>${esc(ctx.config.devices.summary || "Groups you add in the config")}</span></span><span class="strip-count">${deviceCount} groups${icon("arrow")}</span></button>`
    : "";
  const apps = (ctx.config.apps || []).slice(0, 4).map((app) => appCard(app, ctx)).join("");
  const followups = ctx.config.followups || [];
  const follow = followups.length
    ? followups.map((item) => `<a class="overview-followup" href="${esc(item.href || "backlog.html")}"><strong>${esc(item.title)}</strong><span>${esc(item.detail || "")}</span><span class="followup-action">Review next action ${icon("arrow")}</span></a>`).join("")
    : `<p class="followup-note">Nothing to review yet</p>`;
  const agents = (ctx.config.agents || []).map((agent) => agentMini(agent)).join("") || `<p class="followup-note">No agents connected</p>`;
  return `<div class="overview-grid">${attention}<div class="primary-column"><section><div class="section-head"><h2>Infrastructure</h2><a class="text-button" href="machines.html">All machines${icon("arrow")}</a></div>${groups}${home}</section><section class="overview-apps"><div class="section-head"><h2>Apps &amp; sites</h2><a class="text-button" href="apps.html">All apps &amp; sites${icon("arrow")}</a></div><div class="app-grid">${apps || emptyBlock("No apps yet", "Add a site in Settings.")}</div></section></div><aside class="secondary-column"><section class="overview-followups" aria-labelledby="followups-title"><div class="section-head"><h2 id="followups-title">Follow-ups</h2><a class="text-button" href="backlog.html">Backlog ${icon("arrow")}</a></div><p class="followup-note">${followups.length ? "Dated records to review" : "Nothing to review yet"}</p>${followups.length ? follow : ""}</section><section class="agent-section"><div class="section-head"><h2>Your agent workspace</h2><a class="text-button" href="agents.html">Explore${icon("arrow")}</a></div><div class="agent-strip">${agents}</div></section></aside></div>`;
}

function attentionRow(item) {
  const symbol = item.state === "stale" ? "◷" : "!";
  const klass = item.state === "fail" ? " failure" : "";
  const inner = `<span class="attention-symbol${klass}" aria-hidden="true">${symbol}</span><span><strong>${esc(item.title)}</strong><span>${esc(item.detail || item.label || "")}</span></span>${icon("chevron")}`;
  if (item.kind === "machine") return `<button class="attention-item" type="button" data-open="machine:${esc(item.target)}">${inner}</button>`;
  if (item.kind === "app") return `<button class="attention-item" type="button" data-open="app:${esc(item.target)}">${inner}</button>`;
  return `<a class="attention-item" href="${esc(item.href || "settings.html")}">${inner}</a>`;
}

function renderEmpty() {
  const tile = (href, glyph, title, copy, action) => `<button class="device-group" type="button" data-href="${esc(href)}"><div class="group-top">${icon(glyph)}<span>0<small>added</small></span></div><h3>${esc(title)}</h3><p>${esc(copy)}</p><div class="group-bottom"><span>${esc(action)}</span>${icon("arrow")}</div></button>`;
  return `<div class="overview-grid"><section class="attention-panel" aria-labelledby="attention-title" hidden><div class="section-head"><h2 id="attention-title">Worth a look</h2></div><p class="attention-summary">0 items from saved checks</p><div class="attention-list"></div></section><div class="primary-column"><div class="empty">${icon("grid")}<h3>Nothing is connected yet.</h3><p>Add one source and this page fills in. You can add the rest later in Settings.</p><p><a class="button" href="settings.html#add-machine">Add your first source</a> <button class="button" type="button" data-demo="on">Load demo data</button></p><p class="fine-print">Demo data fills every page with samples. Turn it off any time in Settings.</p></div><section><div class="section-head"><h2>Connect a source</h2><a class="text-button" href="settings.html">Settings ${icon("arrow")}</a></div><div class="machine-grid">${tile("settings.html#add-machine", "server", "Machines", "See which servers are up, how full they are, and when one stops reporting. Needs a host and an SSH user.", "Add machine")}${tile("settings.html#apps", "window", "Apps", "Check each site on a schedule and see the moment it stops responding. Needs a health URL.", "Add app")}${tile("settings.html#repos", "flow", "Repos", "Show recent deploys and which ones failed, in one list. Needs a read-only access token.", "Add repo")}${tile("settings.html#agents", "robot", "Agents", "See which agents are working and which have gone quiet. Needs a heartbeat URL or file.", "Add agent")}</div></section></div><aside class="secondary-column"><section class="overview-followups"><div class="section-head"><h2>Follow-ups</h2></div><p class="followup-note">Nothing to review yet</p></section><section class="agent-section"><div class="section-head"><h2>Your agent workspace</h2></div><p class="followup-note">No agents connected</p></section></aside></div>`;
}

function appCard(app, ctx) {
  const site = findObservation(ctx.status, ctx.now, app.id, "app");
  const deploy = findObservation(ctx.status, ctx.now, app.id, "deploy");
  const host = (ctx.config.machines || []).find((machine) => machine.id === app.host);
  const hostname = app.hostname || hostOf(app.url || app.healthUrl);
  return `<button type="button" class="app-card" data-open="app:${esc(app.id)}" data-site-state="${esc(site?.state || "unknown")}" data-name="${esc(app.name)}"><span class="app-mark" aria-hidden="true">${icon(app.icon || "window")}</span><strong class="app-card-name">${esc(app.name)}</strong>${icon("chevron")}<span class="app-card-hostname">${esc(hostname)}</span><span class="app-indicators"><span><span class="app-indicator-label">Website</span>${healthBadge(site?.state || "unknown", site?.label || "Not connected")}</span><span><span class="app-indicator-label">Deploy</span>${healthBadge(deploy?.state || "unknown", deploy?.label || "Not tracked")}</span></span><span class="app-card-footer"><span class="app-card-host">${esc(host?.name || app.host || "Unplaced")}</span><span class="app-card-action">Details ${icon("arrow")}</span></span></button>`;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url || ""; }
}

function agentMini(agent) {
  const initials = (agent.name || "?").slice(0, 1).toUpperCase();
  return `<button class="agent-mini" type="button" data-open="agent:${esc(agent.id)}">${portrait(agent.avatar, initials)}<span><strong>${esc(agent.name)}</strong><small>${esc(agent.role || "Agent")}</small></span>${icon("chevron")}</button>`;
}

function renderMachines(ctx) {
  if (!(ctx.config.machines || []).length) return emptyBlock("No machines yet", "Add a host in Settings. A heartbeat or an SSH uptime check fills the card.", "settings.html#add-machine");
  const groups = groupMachines(ctx.config).map((group) => `<section class="place-heading"><h2>${esc(group.name)}</h2><span>${group.machines.length} ${group.machines.every((machine) => machine.kind === "vps") ? "VPS servers" : "machines"}</span></section><div class="machine-grid">${group.machines.map((machine) => machineCard(machine, ctx)).join("")}</div>`).join("");
  return `<nav class="infrastructure-tabs" aria-label="Infrastructure"><a href="#fleet" aria-current="page">Machines</a><a href="#recovery">Recovery</a><a href="#coverage">Monitoring</a></nav><div class="infra-locations" id="fleet">${groups}</div>${renderRecovery(ctx)}<div id="coverage">${renderCoverage(ctx)}</div>`;
}

function renderRecovery(ctx) {
  const rows = ctx.config.recovery || [];
  if (!rows.length) {
    return `<section id="recovery" class="assurance-view"><h2>Recovery</h2><p class="fine-print">No recovery records in the config yet.</p></section>`;
  }
  const records = rows.map((row) => `<details class="recovery-record" id="${esc(row.id)}"><summary><span class="recovery-name"><strong>${esc(row.name)}</strong></span><span class="recovery-evidence"><span class="record-state ${esc(row.state || "recorded")}">${esc(row.state || "recorded")}</span><small>${esc(row.evidence || "")}</small></span><span class="recovery-restore">${esc(row.restore || "")}</span>${icon("chevron")}</summary><div class="assurance-body"><p>${esc(row.detail || "")}</p><dl class="assurance-facts"><div><dt>Recorded</dt><dd>${esc(row.recorded || "Not dated")}</dd></div><div><dt>Restore</dt><dd>${esc(row.restore || "Add a restore note")}</dd></div></dl></div></details>`).join("");
  return `<section id="recovery" class="assurance-view"><div class="section-head"><h2>Recovery</h2></div><p class="assurance-source">${icon("info")}<span>Records you typed into the config. Opsboard does not take snapshots itself.</span></p><div class="recovery-columns"><span>Record</span><span>Evidence</span><span>Restore</span><span></span></div><div class="recovery-list">${records}</div></section>`;
}

function renderCoverage(ctx) {
  const cards = (ctx.config.machines || []).map((machine) => {
    const checks = machine.checks || [];
    const obs = findObservation(ctx.status, ctx.now, machine.id, "machine");
    return `<button type="button" data-open="machine:${esc(machine.id)}"><strong>${esc(machine.name)}</strong>${statusChip(obs?.state || "unknown", obs?.label || "Not connected")}<small>${checks.length ? checks.map((check) => check.adapter).join(", ") : "No check connected"}</small></button>`;
  }).join("");
  return `<section class="health-coverage"><div class="section-head"><h2>Monitoring coverage</h2></div><p class="health-explainer">Each machine needs a heartbeat or an SSH uptime check. Unknown means the collector has not stored an observation yet.</p><div class="health-coverage-list">${cards}</div></section>`;
}

function renderNetwork(ctx) {
  const places = ctx.config.network?.places || [];
  if (!places.length) return emptyBlock("No network map yet", "Add places and node ids to network.places in the config.", "settings.html");
  const islands = places.map((place) => {
    const nodes = (place.nodes || []).map((ref) => networkNode(ref, ctx)).join("");
    return `<section class="map-island"><div class="island-heading">${icon(locationIcon(place.kind))}<div><h2>${esc(place.name)}</h2><p>${esc(place.note || "")}</p></div><span class="island-count">${(place.nodes || []).length}</span></div>${nodes}</section>`;
  });
  const bridged = islands.flatMap((island, index) => index === 0 ? [island] : [`<div class="map-bridge"><span>link</span><i></i></div>`, island]);
  const outline = (ctx.config.machines || []).map((machine) => `<tr><td><strong>${esc(machine.name)}</strong></td><td>${esc(machine.location || "")}</td><td><code>${esc(machine.host || "")}</code></td><td>${statusChip((findObservation(ctx.status, ctx.now, machine.id, "machine") || {}).state || "unknown", (findObservation(ctx.status, ctx.now, machine.id, "machine") || {}).label || "Not connected")}</td></tr>`).join("");
  return `<div class="atlas-canvas"><div class="map-caption"><span>${icon("flow")}Layered map</span><span>Documentation addresses only in the sample</span></div><div class="map-locations">${bridged.join("")}</div><div class="map-legend"><span class="line-key"></span><span>Link between places</span><span class="legend-note">Click a node for the same evidence as Infrastructure.</span></div></div><div class="reference-content"><section class="block"><h2>Outline</h2><p>The same nodes as a table, so the map is not the only way to read them.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Place</th><th>Host</th><th>Status</th></tr></thead><tbody>${outline}</tbody></table></div></section></div>`;
}

function networkNode(ref, ctx) {
  const app = ref.startsWith("app:") ? (ctx.config.apps || []).find((item) => item.id === ref.slice(4)) : null;
  const machine = app ? null : (ctx.config.machines || []).find((item) => item.id === ref);
  if (machine) {
    const obs = findObservation(ctx.status, ctx.now, machine.id, "machine");
    return `<button class="map-node" type="button" data-open="machine:${esc(machine.id)}"><span class="asset-icon">${icon(machineIcon(machine))}</span><span><strong>${esc(machine.name)}</strong><small>${esc(machine.host || machine.role || "")}</small></span>${statusChip(obs?.state || "unknown", obs?.label || "Not connected")}</button>`;
  }
  if (app) {
    const obs = findObservation(ctx.status, ctx.now, app.id, "app");
    return `<button class="map-node" type="button" data-open="app:${esc(app.id)}"><span class="asset-icon">${icon("window")}</span><span><strong>${esc(app.name)}</strong><small>${esc(hostOf(app.url || ""))}</small></span>${statusChip(obs?.state || "unknown", obs?.label || "Not connected")}</button>`;
  }
  return "";
}

function renderHome(ctx) {
  const groups = ctx.config.devices?.groups || [];
  if (!groups.length) return emptyBlock("No device groups yet", "Add devices.groups in the config. The sample uses obviously fake gear.", "settings.html");
  const total = groups.reduce((sum, group) => sum + (group.items || []).length, 0);
  const attention = groups.reduce((sum, group) => sum + (group.items || []).filter((item) => item.state && item.state !== "ok").length, 0);
  const cards = groups.map((group) => `<button class="device-group" type="button" data-open="device:${esc(group.id)}"><div class="group-top">${icon(group.icon || "home")}<span>${(group.items || []).length}<small>devices</small></span></div><h3>${esc(group.name)}</h3><p>${esc(group.summary || "")}</p><div class="group-bottom"><span>Open group</span>${icon("arrow")}</div></button>`).join("");
  return `<div class="home-summary"><div><span class="big-inventory">${total}</span><span>devices<small>across ${groups.length} groups</small></span></div><div><span class="inventory-alert">${attention}</span><span>need a look<small>not marked ok</small></span></div><div class="home-telemetry"><span>${esc(ctx.config.devices.summary || "")}</span></div></div><div class="device-groups">${cards}</div><p class="home-footnote"><span>Device rows are config, not a live home controller. A json adapter can point at a private status URL if you run one on your own network.</span></p>`;
}

function renderAgents(ctx) {
  const agents = ctx.config.agents || [];
  if (!agents.length) return emptyBlock("No agents yet", "Add an agent with a heartbeat. The chart is the reports-to tree.", "settings.html#agents");
  const operator = ctx.config.board?.operatorLabel || "You";
  const roots = agents.filter((agent) => !agent.reportsTo || agent.reportsTo === "you");
  const chart = `<div class="org-workspace" id="org"><div class="org-summary"><div><span class="team-label">Reports to</span><h2>Who works for whom</h2><p>An agent shows as working only when its heartbeat is fresh. The portrait set is generic. Put your own names in the config.</p></div></div><div class="team-chart"><div class="lead-wrap"><button class="lead-node" type="button" data-open="operator"><span class="avatar">${esc(ctx.config.board?.ownerInitials || "YN")}</span><span><strong>${esc(operator)}</strong><small>${esc(ctx.config.board?.ownerRole || "Workspace owner")}</small></span>${icon("chevron")}</button></div><div class="tree-connector"><span>reports to ${esc(operator.toLowerCase())}</span></div><div class="profile-grid">${roots.map((agent) => agentNode(agent, agents, ctx)).join("")}</div><p class="tree-note">${icon("info")}Lines follow the reportsTo field. Use "you" for the workspace owner, or another agent id.</p></div></div>`;
  const autos = ctx.config.automations || [];
  const autoRows = autos.map((item) => {
    const obsState = item.state || "unknown";
    return `<details class="automation-row" id="${esc(item.id)}"><summary><span class="automation-symbol">${icon("clock")}</span><span class="automation-name"><strong>${esc(item.name)}</strong><small>${esc(item.schedule || "")}</small></span><span class="automation-observation">${statusChip(obsState, item.label || obsState)}<small>${esc(item.detail || "")}</small></span>${icon("chevron")}</summary><div class="automation-body"><p>${esc(item.detail || "")}</p><dl class="ops-facts"><div><dt>Owner</dt><dd>${esc(item.owner || "Unassigned")}</dd></div><div><dt>Schedule</dt><dd>${esc(item.schedule || "Not set")}</dd></div></dl></div></details>`;
  }).join("");
  const autoBlock = `<section class="agent-operations" id="automations"><h3>Automations</h3><div class="automation-list">${autoRows || `<p class="ops-pending">No automations in the config.</p>`}</div></section>`;
  return `<div class="team-tabs" role="tablist" aria-label="Agent views"><button type="button" class="active" data-href="#org"><strong>Org chart</strong><span>Reports-to tree</span></button><button type="button" data-href="#automations"><strong>Automations</strong><span>${autos.length} scheduled</span></button></div>${chart}${autoBlock}`;
}

function agentNode(agent, agents, ctx) {
  const children = agents.filter((item) => item.reportsTo === agent.id);
  const obs = findObservation(ctx.status, ctx.now, agent.id, "agent");
  const node = `<button class="profile-node" type="button" data-open="agent:${esc(agent.id)}">${portrait(agent.avatar, agent.name.slice(0, 1))}<strong>${esc(agent.name)}</strong><small>${esc(agent.role || "")}</small>${statusChip(obs?.state || "unknown", obs?.label || "No heartbeat")}</button>`;
  if (!children.length) return node;
  return `<div class="profile-branch">${node}<div class="tree-connector"><span>reports to ${esc(agent.name)}</span></div><div class="profile-grid">${children.map((child) => agentNode(child, agents, ctx)).join("")}</div></div>`;
}

function renderApps(ctx) {
  if (ctx.appId) return renderAppDetail(ctx, ctx.appId);
  const apps = ctx.config.apps || [];
  if (!apps.length) return emptyBlock("No apps yet", "Add a health URL. The collector records the status code and how long it took.", "settings.html#apps");
  return `<div class="app-browser-toolbar"><label class="search-input app-search">${icon("search")}<input data-filter-apps type="search" placeholder="Filter apps" aria-label="Filter apps"></label><span id="app-count">${apps.length} apps</span></div><div class="filter-row app-browser-filters" role="group" aria-label="App filters"><button type="button" class="active" data-app-filter="all" aria-pressed="true">All</button><button type="button" data-app-filter="fail" aria-pressed="false">Failing</button><button type="button" data-app-filter="auth" aria-pressed="false">Sign-in</button><button type="button" data-app-filter="ok" aria-pressed="false">Healthy</button></div><div class="apps-table"><div class="app-grid" data-app-grid>${apps.map((app) => appCard(app, ctx)).join("")}</div></div>`;
}

function renderAppDetail(ctx, id) {
  const app = (ctx.config.apps || []).find((item) => item.id === id);
  if (!app) return emptyBlock("App not in the config", "The link does not match an app id.", "apps.html");
  const site = findObservation(ctx.status, ctx.now, app.id, "app");
  const deploy = findObservation(ctx.status, ctx.now, app.id, "deploy");
  const host = (ctx.config.machines || []).find((machine) => machine.id === app.host);
  const deps = (app.dependencies || []).map((depId) => {
    const dep = (ctx.config.apps || []).find((item) => item.id === depId);
    const depObs = findObservation(ctx.status, ctx.now, depId, "app");
    return `<li><span class="dependency-symbol">${icon("flow")}</span><div><h3><a href="apps.html?app=${encodeURIComponent(depId)}">${esc(dep?.name || depId)} ${icon("arrow")}</a></h3><p class="dependency-role">Needs this app</p></div><div>${healthBadge(depObs?.state || "unknown", depObs?.label || "Not connected")}</div></li>`;
  }).join("");
  const steps = (app.troubleshooting || []).map((step) => `<li><h3>${esc(step.title || "Check")}</h3><p>${esc(step.text || step)}</p></li>`).join("");
  return `<a class="app-back" href="apps.html">${icon("arrow")}All apps &amp; sites</a><div class="app-operations-layout"><div class="app-operations-main"><header class="inspector-identity">${portrait(null, app.name.slice(0, 1))}<div><h2>${esc(app.name)}</h2><p>${esc(app.summary || "")}</p></div></header><dl class="app-summary"><div><dt>Website</dt><dd>${healthBadge(site?.state || "unknown", site?.label || "Not connected")}</dd></div><div><dt>Deploy</dt><dd>${healthBadge(deploy?.state || "unknown", deploy?.label || "Not tracked")}</dd></div><div><dt>Host</dt><dd>${esc(host?.name || app.host || "Unplaced")}</dd></div></dl><section><h2>Checks</h2><div class="app-checks"><div class="app-check-row"><div><strong>Website</strong><p>${esc(app.healthUrl || app.url || "No URL")}</p></div><div class="app-check-result">${healthBadge(site?.state || "unknown", site?.label || "Not connected")}<small>${esc(typeof site?.detail === "string" ? site.detail : reportPhrase(site, ctx.now))}</small></div></div><div class="app-check-row"><div><strong>Deploy</strong><p>${esc(app.repo || "No repo linked")}</p></div><div class="app-check-result">${healthBadge(deploy?.state || "unknown", deploy?.label || "Not tracked")}<small>${esc(typeof deploy?.detail === "string" ? deploy.detail : reportPhrase(deploy, ctx.now))}</small></div></div></div></section>${deps ? `<section><h2>Dependencies</h2><ul class="app-dependency-list">${deps}</ul></section>` : ""}${steps ? `<section class="app-troubleshooting"><h2>When this looks wrong</h2><ol>${steps}</ol></section>` : ""}</div><aside><div class="evidence-box"><div><h3>Sign-in</h3></div><p>${esc(app.signIn || "No sign-in note.")}</p><div class="observation-time">${esc(reportPhrase(site, ctx.now))}</div></div></aside></div>`;
}

function renderShip(ctx) {
  const repos = ctx.config.repos || [];
  if (!repos.length) return emptyBlock("No repos yet", "Add owner/name. Pull request runs never count as a release.", "settings.html#repos");
  const cards = repos.map((repo) => {
    const deploy = findObservation(ctx.status, ctx.now, repo.app || repo.id, "deploy") || findObservation(ctx.status, ctx.now, repo.id, "deploy");
    const state = deploy?.state || "unknown";
    const label = deploy?.label || "Not tracked";
    return `<article class="deploy-health-card" id="${esc(repo.id)}">${healthBadge(state, label)}<div class="deploy-health-identity"><span class="app-mark">${icon("flow")}</span><strong>${esc(repo.repo || repo.name)}</strong></div><p class="deploy-health-host">${esc(repo.workflow || "workflow")} on ${esc(repo.branch || "the default branch")}</p><dl class="deploy-health-facts"><div><dt>Latest</dt><dd>${esc(typeof deploy?.detail === "string" ? deploy.detail : label)}<time>${esc(reportPhrase(deploy, ctx.now))}</time></dd></div><div><dt>Token</dt><dd>env <code>${esc(repo.tokenEnv || "GITHUB_TOKEN")}</code></dd></div></dl><footer><span>Pull request runs are ignored for the release result.</span></footer></article>`;
  }).join("");
  const bad = repos.filter((repo) => {
    const deploy = findObservation(ctx.status, ctx.now, repo.app || repo.id, "deploy");
    return deploy && (deploy.state === "fail" || deploy.state === "stale");
  });
  const attention = bad.map((repo) => `<a class="${(findObservation(ctx.status, ctx.now, repo.app || repo.id, "deploy") || {}).state === "fail" ? "fail" : ""}" href="#${esc(repo.id)}"><strong>${esc(repo.repo)}</strong><span>The latest release run is not green.</span></a>`).join("");
  return `<div class="deploy-attention">${attention}</div><div class="release-meta"><p>Deployments read workflow runs. The browser does not hold the token.</p><p class="release-checked">${repos.length} repos</p></div><div class="machine-grid">${cards}</div>`;
}

function renderRunbooks(ctx) {
  const books = ctx.config.runbooks || [];
  if (!books.length) return emptyBlock("No runbooks yet", "Add short procedures to runbooks in the config.", "settings.html");
  const index = books.map((book) => `<a class="task-link" href="#${esc(book.id)}"><span><strong>${esc(book.title)}</strong><small>${esc(book.summary || "")}</small></span></a>`).join("");
  const readers = books.map((book) => `<article class="block" id="${esc(book.id)}"><h2>${esc(book.title)}</h2><p class="reader-lede">${esc(book.summary || "")}</p><ol class="procedure-steps">${(book.steps || []).map((step) => `<li><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`).join("")}</ol></article>`).join("");
  return `<div class="reference-content"><div class="reference-workspace"><aside class="task-index"><h2>Procedures</h2><label class="reference-search"><span>Find a procedure</span><input data-filter-runbooks type="search" placeholder="Search runbooks"></label>${index}</aside><div class="runbook-reader">${readers}</div></div></div>`;
}

function renderAccess(ctx) {
  const rows = ctx.config.access || [];
  if (!rows.length) return emptyBlock("No access notes yet", "List where each secret lives. Never paste the secret itself.", "settings.html");
  const blocks = rows.map((row) => `<section class="block credential-directory" id="${esc(row.id)}"><h3>${esc(row.name)}</h3><p>${esc(row.note || "")}</p><dl><dt>Holds</dt><dd>${esc(row.holds || "")}</dd><dt>Where</dt><dd><code>${esc(row.where || "")}</code></dd></dl></section>`).join("");
  return `<div class="reference-content"><div class="callout warn"><h3>Secrets stay out of this file</h3><p>Names of environment variables and Actions secrets are safe to commit. Values are not. The preview on Settings masks anything that still looks like a token.</p></div>${blocks}<p class="reference-note"><strong>Private network.</strong> SSH checks, heartbeat posts, and any admin URL should stay on a private network such as a tailnet or a WireGuard mesh. Do not publish them on the open internet so the dashboard can see them.</p></div>`;
}

function renderKnowledge(ctx) {
  const rows = ctx.config.knowledge || [];
  if (!rows.length) return emptyBlock("No knowledge sources yet", "Add links the on-call person should be able to open.", "settings.html");
  const blocks = rows.map((row) => `<section class="block source-directory" id="${esc(row.id)}"><h3>${esc(row.name)}</h3><p>${esc(row.summary || "")}</p>${row.url ? `<p><a href="${esc(row.url)}">${esc(row.url)}</a></p>` : ""}</section>`).join("");
  return `<div class="reference-content knowledge-workspace">${blocks}</div>`;
}

function renderBacklog(ctx) {
  const rows = ctx.config.backlog || [];
  if (!rows.length) return emptyBlock("Backlog is empty", "Dated follow-ups you want to see again go here.", "settings.html");
  const articles = rows.map((row) => `<article id="${esc(row.id)}"><div><span class="pill ${row.state === "fail" ? "fail" : row.state === "warn" ? "warn" : ""}">${esc(row.state || "open")}</span></div><div><h3>${esc(row.title)}</h3><p>${esc(row.detail || "")}</p><p class="fine-print">${esc(row.recorded || "")}${row.due ? ` · ${esc(row.due)}` : ""}</p></div></article>`).join("");
  return `<div class="reference-content"><div class="backlog">${articles}</div></div>`;
}

function testCell(id, tests, now) {
  const row = tests?.[id] || { state: "untested", label: "Not tested" };
  if (row.state === "testing") return `${statusChip("running", "Testing…")}`;
  if (row.state === "pass") return `${statusChip("ok", "Pass")}<small class="record-label">${esc(row.at ? ago(row.at, now) : "sample")}</small>`;
  if (row.state === "fail") return `${statusChip("fail", "Fail")}<small class="record-label"><strong>${esc(row.reason || "Failed")}</strong>${row.at ? ` · ${esc(ago(row.at, now))}` : ""}</small>`;
  return statusChip("unknown", "Not tested");
}

function renderSettings(ctx) {
  const draft = ctx.draft || ctx.config;
  const tests = ctx.tests || {};
  const changes = ctx.changes || [];
  const changeCopy = changes.length ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"}: ${changes.join("; ")}.` : "No unsaved changes.";
  const errors = (ctx.errors || []).map((error) => `<li>${esc(error)}</li>`).join("");
  const machines = draft.machines || [];
  const apps = draft.apps || [];
  const repos = draft.repos || [];
  const agents = draft.agents || [];
  const machineRows = machines.map((machine) => `<tr><td><strong>${esc(machine.name)}</strong></td><td><code>${esc(machine.host || "")}</code></td><td>${esc(machine.user || "")}</td><td>${testCell(machine.id, tests, ctx.now)}</td><td><button class="button" type="button" data-test="machine" data-id="${esc(machine.id)}">${tests[machine.id]?.state === "testing" ? "Testing…" : "Test"}</button></td></tr>`).join("");
  const appRows = apps.map((app) => `<tr><td><strong>${esc(app.name)}</strong></td><td><code>${esc(app.healthUrl || app.url || "")}</code></td><td>${esc(app.host || "")}</td><td>${testCell(app.id, tests, ctx.now)}</td><td><button class="button" type="button" data-test="app" data-id="${esc(app.id)}">${tests[app.id]?.state === "testing" ? "Testing…" : "Test"}</button></td></tr>`).join("");
  const repoRows = repos.map((repo) => `<tr><td><strong>${esc(repo.repo || repo.name)}</strong></td><td>${esc(repo.branch || "")}</td><td><code>••••••••</code><small class="record-label">env ${esc(repo.tokenEnv || "GITHUB_TOKEN")}</small></td><td>${testCell(repo.id, tests, ctx.now)}</td><td><button class="button" type="button" data-test="repo" data-id="${esc(repo.id)}">${tests[repo.id]?.state === "testing" ? "Testing…" : "Test"}</button></td></tr>`).join("");
  const agentRows = agents.map((agent) => `<tr><td><strong>${esc(agent.name)}</strong></td><td><code>${esc(agent.heartbeat || agent.heartbeatFile || "")}</code></td><td>${esc(agent.reportsTo === "you" || !agent.reportsTo ? (draft.board?.operatorLabel || "You") : agent.reportsTo)}</td><td>${testCell(agent.id, tests, ctx.now)}</td><td><button class="button" type="button" data-test="agent" data-id="${esc(agent.id)}">${tests[agent.id]?.state === "testing" ? "Testing…" : "Test"}</button></td></tr>`).join("");
  const preview = esc(JSON.stringify(maskConfig(draft), null, 2));
  const demoOn = ctx.demo;
  return `<div class="checks-summary">${icon("book")}<div><strong>Editing <code>switchboard.config.json</code></strong><p>Every machine, app, repo, and agent lives in this one file. This page reads and writes that draft and nothing else. ${esc(changeCopy)} GitHub Pages cannot write the file back. Download it, then commit it yourself or let the local dev server save it. Secrets never go in the file or the browser. SSH, file heartbeats, and private URLs need the collector or the status Action.</p><div class="detail-actions"><button class="button primary" type="button" data-save>Save to file</button><button class="button" type="button" data-copy>Copy JSON</button><button class="button" type="button" data-discard>Discard change</button></div></div>${errors ? `<div class="callout warn"><h3>Config needs a fix</h3><ul>${errors}</ul></div>` : ""}</div><nav class="infrastructure-tabs" aria-label="Settings sections"><a href="#machines">Machines</a><a href="#apps">Apps</a><a href="#repos">Repos</a><a href="#agents">Agents</a><a href="#data">Demo data</a><a href="#config">Config file</a></nav><div class="reference-content"><section class="block" id="machines"><div class="section-head"><h2>Machines <span class="count-label">${machines.length}</span></h2><button class="button" type="button" data-toggle-form="add-machine">Add machine</button></div><p>Machine readings come from a heartbeat post or a read-only SSH check. The key stays in an environment variable.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Host</th><th>SSH user</th><th>Last test</th><th></th></tr></thead><tbody>${machineRows || `<tr><td colspan="5">No machines in this draft.</td></tr>`}</tbody></table></div><form class="callout" id="add-machine" data-add="machine"><h3>Add machine</h3><div class="split"><label class="reference-search"><span>Name</span><input name="name" required ${ctx.blank ? `placeholder="build-box-02"` : `value="build-box-02"`}></label><label class="reference-search"><span>Host</span><input name="host" required ${ctx.blank ? `placeholder="198.51.100.21"` : `value="198.51.100.21"`}></label><label class="reference-search"><span>SSH user</span><input name="user" value="${ctx.blank ? "" : "ci"}" placeholder="ci"></label><label class="reference-search"><span>Key env name</span><input name="keyEnv" value="SSH_KEY_BUILD_BOX_02"><small>The collector reads this variable. The path and the key are never stored in the config.</small></label></div><p class="fine-print">Reporter, on the host, pointed at a private URL: <code>OPSBOARD_HEARTBEAT_URL=https://ops.example.com/api/heartbeat OPSBOARD_HEARTBEAT_ID=build-box-02 node reporter/heartbeat.mjs</code></p><div class="detail-actions"><button class="button primary" type="submit">Add to config</button><button class="button" type="button" data-test-form="machine">Test connection</button><button class="button" type="button" data-toggle-form="add-machine">Cancel</button></div><p data-form-result="machine"></p></form></section><section class="block" id="apps"><div class="section-head"><h2>Apps <span class="count-label">${apps.length}</span></h2><button class="button" type="button" data-toggle-form="add-app">Add app</button></div><p>Each app gets an HTTPS check against its health URL. The check does not sign in.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Health URL</th><th>Runs on</th><th>Last test</th><th></th></tr></thead><tbody>${appRows}</tbody></table></div><form class="callout" id="add-app" hidden data-add="app"><h3>Add app</h3><div class="split"><label class="reference-search"><span>Name</span><input name="name" required placeholder="example-app"></label><label class="reference-search"><span>Health URL</span><input name="healthUrl" required placeholder="https://app.example.com/healthz"></label><label class="reference-search"><span>Runs on</span><input name="host" placeholder="machine id"></label></div><div class="detail-actions"><button class="button primary" type="submit">Add to config</button><button class="button" type="button" data-test-form="app">Test connection</button></div></form></section><section class="block" id="repos"><div class="section-head"><h2>Repos <span class="count-label">${repos.length}</span></h2><button class="button" type="button" data-toggle-form="add-repo">Add repo</button></div><p>Deployments read workflow runs with a read-only token named in the config and stored as an Actions secret.</p><div class="table-wrap"><table><thead><tr><th>Repository</th><th>Deploy branch</th><th>Token</th><th>Last test</th><th></th></tr></thead><tbody>${repoRows}</tbody></table></div><form class="callout" id="add-repo" hidden data-add="repo"><h3>Add repo</h3><div class="split"><label class="reference-search"><span>owner/name</span><input name="repo" required placeholder="example-org/example-app"></label><label class="reference-search"><span>Branch</span><input name="branch" value="main"></label><label class="reference-search"><span>Workflow</span><input name="workflow" value="deploy.yml"></label><label class="reference-search"><span>Token env</span><input name="tokenEnv" value="GITHUB_TOKEN"></label></div><div class="detail-actions"><button class="button primary" type="submit">Add to config</button><button class="button" type="button" data-test-form="repo">Test connection</button></div></form></section><section class="block" id="agents"><div class="section-head"><h2>Agents <span class="count-label">${agents.length}</span></h2><button class="button" type="button" data-toggle-form="add-agent">Add agent</button></div><p>An agent shows as working only when its heartbeat is fresh.</p><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Status source</th><th>Reports to</th><th>Last test</th><th></th></tr></thead><tbody>${agentRows}</tbody></table></div><form class="callout" id="add-agent" hidden data-add="agent"><h3>Add agent</h3><div class="split"><label class="reference-search"><span>Name</span><input name="name" required></label><label class="reference-search"><span>Role</span><input name="role" placeholder="Sorts new issues"></label><label class="reference-search"><span>Reports to</span><input name="reportsTo" value="you"></label><label class="reference-search"><span>Heartbeat URL</span><input name="heartbeat" placeholder="https://ops.example.com/agents/helper/heartbeat"></label><label class="reference-search"><span>Portrait</span><input name="avatar" value="robot-1"></label></div><div class="detail-actions"><button class="button primary" type="submit">Add to config</button><button class="button" type="button" data-test-form="agent">Test connection</button></div></form></section><section class="block" id="data"><div class="section-head"><h2>Demo data</h2></div><p>Fills every page with sample data so you can try the board before connecting anything.</p><div class="filter-row" role="group" aria-label="Demo data"><button type="button" class="${demoOn ? "active" : ""}" data-demo="on" aria-pressed="${demoOn ? "true" : "false"}">Demo data on</button><button type="button" class="${demoOn ? "" : "active"}" data-demo="off" aria-pressed="${demoOn ? "false" : "true"}">Off</button></div><p class="fine-print">Turning demo off with nothing saved shows the empty state. Save a config first if you want your rows to remain.</p></section><section class="block" id="config"><div class="section-head"><h2>Config file</h2>${changes.length ? `<span class="pill warn">${changes.length} unsaved</span>` : ""}</div><p>Preview of <code>switchboard.config.json</code>. Secrets are masked here and never shown in full. Env var names stay visible so you know what to set.</p><pre><code>${preview}</code></pre></section></div>`;
}

function emptyBlock(title, copy, href) {
  return `<div class="empty">${icon("grid")}<h3>${esc(title)}</h3><p>${esc(copy)}</p>${href ? `<p><a class="button" href="${esc(href)}">Open Settings</a></p>` : ""}</div>`;
}

export function renderInspector(kind, id, ctx) {
  if (kind === "machine") return machineInspector(id, ctx);
  if (kind === "app") return appInspector(id, ctx);
  if (kind === "agent") return agentInspector(id, ctx);
  if (kind === "device") return deviceInspector(id, ctx);
  if (kind === "operator") {
    return `<button class="dialog-close" type="button" data-close aria-label="Close">${icon("close")}</button><h2 id="inspector-title">${esc(ctx.config.board?.operatorLabel || "You")}</h2><p>${esc(ctx.config.board?.ownerRole || "Workspace owner")}. Agents with reportsTo set to "you" sit under this node.</p>`;
  }
  return "";
}

function machineInspector(id, ctx) {
  const machine = (ctx.config.machines || []).find((item) => item.id === id);
  if (!machine) return "";
  const obs = findObservation(ctx.status, ctx.now, id, "machine");
  const metrics = metricsFor(ctx.status, ctx.now, id);
  const readings = metrics ? `<div class="machine-readings"><dl><div><dt>CPU</dt><dd>${esc(metrics.cpu)}%</dd></div><div><dt>Memory</dt><dd>${esc(metrics.memory)}%</dd></div><div><dt>Disk</dt><dd>${esc(metrics.disk)}%</dd></div></dl></div>` : `<p class="empty-readings">No readings in this report.</p>`;
  const checks = (machine.checks || []).map((check) => check.adapter).join(", ") || "none";
  return `<button class="dialog-close" type="button" data-close aria-label="Close">${icon("close")}</button><div class="inspector-identity"><span class="asset-icon">${icon(machineIcon(machine))}</span><div><h2 id="inspector-title">${esc(machine.name)}</h2><p>${esc(machine.role || "")}</p></div></div><div class="evidence-box"><div><h3>Latest observation</h3>${statusChip(obs?.state || "unknown", obs?.label || "Not connected")}</div><p>${esc(typeof obs?.detail === "string" ? obs.detail : reportPhrase(obs, ctx.now))}</p><div class="observation-time">${esc(reportPhrase(obs, ctx.now))}</div></div>${readings}<dl class="health-facts"><div><dt>Host</dt><dd>${esc(machine.host || "—")}</dd></div><div><dt>User</dt><dd>${esc(machine.user || "—")}</dd></div><div><dt>Place</dt><dd>${esc(machine.location || "—")}</dd></div><div><dt>Checks</dt><dd>${esc(checks)}</dd></div></dl>`;
}

function appInspector(id, ctx) {
  const app = (ctx.config.apps || []).find((item) => item.id === id);
  if (!app) return "";
  const site = findObservation(ctx.status, ctx.now, id, "app");
  const deploy = findObservation(ctx.status, ctx.now, id, "deploy");
  return `<button class="dialog-close" type="button" data-close aria-label="Close">${icon("close")}</button><h2 id="inspector-title">${esc(app.name)}</h2><p class="detail-description">${esc(app.summary || "")}</p><p>${healthBadge(site?.state || "unknown", site?.label || "Not connected")} ${healthBadge(deploy?.state || "unknown", deploy?.label || "Not tracked")}</p><dl><dt>URL</dt><dd>${esc(app.url || "")}</dd><dt>Health</dt><dd>${esc(app.healthUrl || "")}</dd><dt>Host</dt><dd>${esc(app.host || "")}</dd></dl><p class="detail-actions"><a class="button primary" href="apps.html?app=${encodeURIComponent(app.id)}">Open dossier</a></p>`;
}

function agentInspector(id, ctx) {
  const agent = (ctx.config.agents || []).find((item) => item.id === id);
  if (!agent) return "";
  const obs = findObservation(ctx.status, ctx.now, id, "agent");
  const reports = !agent.reportsTo || agent.reportsTo === "you" ? (ctx.config.board?.operatorLabel || "You") : agent.reportsTo;
  return `<button class="dialog-close" type="button" data-close aria-label="Close">${icon("close")}</button><div class="inspector-identity">${portrait(agent.avatar, agent.name.slice(0, 1))}<div><h2 id="inspector-title">${esc(agent.name)}</h2><p>${esc(agent.role || "")}</p></div></div><div class="evidence-box"><div><h3>Heartbeat</h3>${statusChip(obs?.state || "unknown", obs?.label || "No heartbeat")}</div><p>${esc(agent.heartbeat || agent.heartbeatFile || "No source configured")}</p><div class="observation-time">${esc(reportPhrase(obs, ctx.now))}</div></div><dl><dt>Reports to</dt><dd>${esc(reports)}</dd><dt>Portrait</dt><dd>${esc(agent.avatar || "initials")}</dd></dl>`;
}

function deviceInspector(id, ctx) {
  const group = (ctx.config.devices?.groups || []).find((item) => item.id === id);
  if (!group) return "";
  const items = (group.items || []).map((item) => `<li><span>${esc(item.name)}</span><strong class="service-${item.state === "ok" ? "running" : item.state === "fail" ? "failed" : "unknown"}">${esc(item.detail || item.state || "")}</strong></li>`).join("");
  return `<button class="dialog-close" type="button" data-close aria-label="Close">${icon("close")}</button><h2 id="inspector-title">${esc(group.name)}</h2><p>${esc(group.summary || "")}</p><ul class="health-services">${items}</ul>`;
}

export function slugId(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
}

export { isBlank };
