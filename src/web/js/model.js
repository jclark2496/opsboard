/** Status contract, freshness, and attention. Missing evidence is never treated as healthy. */

export function parseDuration(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value).trim().match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return amount * unit;
}

export function materializeStatus(status, now) {
  const source = status || { observations: [] };
  const observations = (source.observations || []).map((obs) => {
    if (obs.ageMs != null && !obs.observedAt) {
      return { ...obs, observedAt: new Date(now - Number(obs.ageMs)).toISOString() };
    }
    return { ...obs };
  });
  return {
    schemaVersion: source.schemaVersion || 1,
    generatedAt: source.generatedAt || new Date(now).toISOString(),
    demo: Boolean(source.demo),
    observations,
  };
}

export function effectiveObservation(obs, now) {
  if (!obs) return null;
  const expires = parseDuration(obs.expiresAfter);
  if (!expires || !obs.observedAt) return obs;
  const age = now - Date.parse(obs.observedAt);
  if (Number.isNaN(age) || age <= expires) return obs;
  if (obs.state === "fail" || obs.state === "warn" || obs.state === "stale") return obs;
  return {
    ...obs,
    state: "stale",
    label: "No recent data",
    detail: obs.detail || "The last report is older than its expiry.",
  };
}

export function observationsFor(status, now) {
  return (status?.observations || [])
    .map((obs) => effectiveObservation(obs, now))
    .filter(Boolean);
}

export function findObservation(status, now, target, kind) {
  const rows = observationsFor(status, now).filter((obs) => obs.target === target && (!kind || obs.kind === kind));
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => rank(a.state) - rank(b.state))[0];
}

export function metricsFor(status, now, target) {
  for (const obs of observationsFor(status, now)) {
    if (obs.target === target && obs.metrics && (obs.metrics.cpu != null || obs.metrics.memory != null || obs.metrics.disk != null)) {
      return obs.metrics;
    }
  }
  return null;
}

function rank(state) {
  return { fail: 0, stale: 1, warn: 2, unknown: 3, auth: 4, redirect: 5, running: 6, ok: 7 }[state] ?? 8;
}

export function ago(iso, now) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "time unknown";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatStamp(now, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(now));
  } catch {
    return new Date(now).toUTCString();
  }
}

export function isBlank(config) {
  if (!config) return true;
  const groups = config.devices?.groups || [];
  return !(
    (config.machines || []).length ||
    (config.apps || []).length ||
    (config.repos || []).length ||
    (config.agents || []).length ||
    groups.length
  );
}

export function emptyBoard(base) {
  const board = { ...(base?.board || {}), name: base?.board?.name || "Your Ops", demo: false };
  return {
    version: 1,
    board,
    theme: { mode: base?.theme?.mode || "system", ...(base?.theme || {}) },
    machines: [],
    apps: [],
    repos: [],
    agents: [],
    network: { places: [] },
    devices: { summary: "", groups: [] },
    runbooks: [],
    access: [],
    knowledge: [],
    backlog: [],
    followups: [],
    notices: [],
    recovery: [],
    automations: [],
  };
}

export function entityName(config, target) {
  const pools = [config.machines, config.apps, config.repos, config.agents];
  for (const pool of pools) {
    const found = (pool || []).find((item) => item.id === target);
    if (found) return found.name || found.repo || found.id;
  }
  return target;
}

export function attentionItems(config, status, now) {
  const rankOrder = { fail: 0, warn: 1, stale: 2, unknown: 3 };
  const rows = [];
  for (const obs of observationsFor(status, now)) {
    const interesting = obs.state === "fail" || obs.state === "warn" || obs.state === "stale" || (obs.state === "unknown" && obs.attention === true);
    if (!interesting || obs.attention === false) continue;
    rows.push(obs);
  }
  for (const notice of config.notices || []) {
    rows.push({
      id: notice.id,
      kind: "notice",
      target: notice.id,
      state: notice.state || "warn",
      label: notice.title,
      title: notice.title,
      detail: notice.detail,
      href: notice.href || "settings.html",
      attention: true,
    });
  }
  rows.sort((a, b) => (rankOrder[a.state] ?? 9) - (rankOrder[b.state] ?? 9));
  const seen = new Set();
  const items = [];
  for (const obs of rows) {
    const key = obs.kind === "notice" ? `notice:${obs.id}` : obs.target;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      ...obs,
      title: attentionTitle(obs, config),
    });
  }
  return items;
}

function attentionTitle(obs, config) {
  if (obs.title) return obs.title;
  const name = entityName(config, obs.target);
  if (obs.kind === "app" && obs.state === "fail") return `Restart ${name}`;
  if (obs.kind === "machine" && (obs.state === "stale" || obs.state === "fail")) return `Probe ${name}`;
  if (obs.kind === "deploy" && obs.state === "fail") return `Deploy failed for ${name}`;
  if (obs.kind === "agent") return `${name} is quiet`;
  return obs.label || name;
}

export function reportPhrase(obs, now) {
  if (!obs?.observedAt) return "Not checked yet";
  const when = ago(obs.observedAt, now);
  if (obs.state === "stale" || obs.state === "unknown") return `Last report ${when}`;
  return `Checked ${when}`;
}

export function searchIndex(config) {
  const items = [];
  const push = (href, title, kind, text) => items.push({ href, title, kind, text: `${title} ${kind} ${text || ""}`.toLowerCase() });
  for (const machine of config.machines || []) push("machines.html", machine.name, "Machine", `${machine.role || ""} ${machine.host || ""} ${machine.location || ""}`);
  for (const app of config.apps || []) push(`apps.html?app=${encodeURIComponent(app.id)}`, app.name, "App", `${app.url || ""} ${app.summary || ""}`);
  for (const repo of config.repos || []) push("ship.html", repo.repo || repo.name, "Repo", `${repo.branch || ""} ${repo.workflow || ""}`);
  for (const agent of config.agents || []) push("agents.html", agent.name, "Agent", agent.role || "");
  for (const book of config.runbooks || []) push(`runbooks.html#${book.id}`, book.title, "Runbook", book.summary || "");
  for (const item of config.backlog || []) push("backlog.html", item.title, "Backlog", item.detail || "");
  for (const group of config.devices?.groups || []) push("home-it.html", group.name, "Devices", group.summary || "");
  return items;
}

export function describeChanges(base, draft) {
  const changes = [];
  const keys = [
    ["machines", "Machines"],
    ["apps", "Apps"],
    ["repos", "Repos"],
    ["agents", "Agents"],
  ];
  for (const [key, label] of keys) {
    const before = new Set((base?.[key] || []).map((item) => item.id));
    const after = new Set((draft?.[key] || []).map((item) => item.id));
    for (const item of draft?.[key] || []) {
      if (!before.has(item.id)) changes.push(`${item.name || item.repo || item.id} added to ${label}`);
    }
    for (const item of base?.[key] || []) {
      if (!after.has(item.id)) changes.push(`${item.name || item.repo || item.id} removed from ${label}`);
    }
  }
  if (Boolean(base?.board?.demo) !== Boolean(draft?.board?.demo)) changes.push("demo data setting changed");
  if ((base?.board?.name || "") !== (draft?.board?.name || "")) changes.push("board name changed");
  return changes;
}

export function worstState(observations) {
  if (!observations.length) return null;
  return observations.slice().sort((a, b) => rank(a.state) - rank(b.state))[0];
}

export const STATE_LABELS = {
  ok: "Checks normal",
  fail: "Failed",
  warn: "Needs a look",
  stale: "No recent data",
  unknown: "Not connected",
  auth: "Sign-in required",
  running: "Running",
  redirect: "Redirect",
};
