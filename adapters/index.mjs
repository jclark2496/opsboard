import http from "./http.mjs";
import github from "./github-actions.mjs";
import heartbeat from "./heartbeat.mjs";
import ssh from "./ssh-uptime.mjs";
import json from "./json.mjs";
import stat from "./static.mjs";

export const adapters = [http, github, heartbeat, ssh, json, stat];

export function adapterById(id) {
  return adapters.find((adapter) => adapter.id === id) || null;
}
