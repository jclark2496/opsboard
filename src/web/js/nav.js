export const PAGES = [
  { id: "overview", file: "index.html", label: "Overview", icon: "grid", group: "main", view: "overview", crumb: "Overview" },
  { id: "machines", file: "machines.html", label: "Infrastructure", icon: "server", group: "main", view: "infrastructure", crumb: "Infrastructure" },
  { id: "network", file: "network.html", label: "Network map", icon: "flow", group: "main", view: "network", crumb: "Network map" },
  { id: "home", file: "home-it.html", label: "Home & devices", icon: "home", group: "main", view: "home", crumb: "Home & devices" },
  { id: "agents", file: "agents.html", label: "Agents", icon: "robot", group: "main", view: "agents", crumb: "Agents" },
  { id: "apps", file: "apps.html", label: "Apps & sites", icon: "window", group: "main", view: "apps", crumb: "Apps & sites" },
  { id: "ship", file: "ship.html", label: "Deployments", icon: "flow", group: "main", view: "ship", crumb: "Deployments" },
  { id: "runbooks", file: "runbooks.html", label: "Runbooks", icon: "book", group: "reference", view: "runbooks", crumb: "Runbooks" },
  { id: "auth", file: "auth.html", label: "Access & secrets", icon: "shield", group: "reference", view: "auth", crumb: "Access & secrets" },
  { id: "knowledge", file: "knowledge.html", label: "Knowledge", icon: "book", group: "reference", view: "knowledge", crumb: "Knowledge" },
  { id: "backlog", file: "backlog.html", label: "Backlog", icon: "clock", group: "reference", view: "backlog", crumb: "Backlog" },
  { id: "settings", file: "settings.html", label: "Settings", icon: "sliders", group: "footer", view: "settings", crumb: "Settings" },
];

export function pageById(id) {
  return PAGES.find((page) => page.id === id) || PAGES[0];
}

export function heading(page, config) {
  if (page.id === "overview") return config.board?.tagline || "Your operations, in view.";
  return page.label;
}
