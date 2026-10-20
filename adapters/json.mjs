import { category } from "../src/collector/errors.mjs";

export function readPath(data, path) {
  const clean = String(path || "").replace(/^\$\.?/, "");
  if (!clean) return data;
  let node = data;
  for (const part of clean.split(".")) {
    const match = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!match) return undefined;
    node = node?.[match[1]];
    if (match[2] != null) node = node?.[Number(match[2])];
    if (node == null) return undefined;
  }
  return node;
}

export default {
  id: "json",
  kinds: ["app", "machine", "agent"],
  env: [],
  schema: {
    type: "object",
    properties: {
      url: { type: "string" },
      statePath: { type: "string" },
      labelPath: { type: "string" },
      okValue: { type: "string" },
      headerEnv: { type: "string" },
      headerName: { type: "string" },
    },
  },
  async check(target, options = {}, ctx) {
    const url = options.url || target.url;
    const expiresAfter = options.maxAge || "2h";
    if (!url) return { state: "unknown", label: "Not configured", detail: "Add a JSON URL", expiresAfter };
    const headers = { accept: "application/json", "user-agent": "opsboard" };
    if (options.headerEnv && options.headerName && ctx.env?.[options.headerEnv]) {
      headers[options.headerName] = ctx.env[options.headerEnv];
    }
    let response;
    try {
      response = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(ctx.timeoutMs || 10000) });
    } catch (error) {
      return { state: "unknown", label: "Not reachable", detail: category(error), expiresAfter };
    }
    if (!response.ok) return { state: "fail", label: `HTTP ${response.status}`, detail: "JSON URL did not succeed", expiresAfter };
    let body;
    try {
      body = await response.json();
    } catch {
      return { state: "unknown", label: "Unreadable JSON", detail: "The URL did not return JSON", expiresAfter };
    }
    const value = readPath(body, options.statePath || "$.state");
    const label = options.labelPath ? readPath(body, options.labelPath) : "";
    const okValue = options.okValue ?? "ok";
    const metrics = body.metrics && typeof body.metrics === "object" ? body.metrics : undefined;
    if (String(value) === String(okValue)) {
      return { state: "ok", label: label || "Responding", detail: "JSON field matched", expiresAfter, metrics };
    }
    if (value == null) return { state: "unknown", label: "Field missing", detail: "The JSON path did not match", expiresAfter };
    return { state: "fail", label: label || "Failed", detail: "JSON field did not match", expiresAfter, metrics };
  },
  demo() {
    return { state: "ok", label: "Responding", detail: "Sample JSON check", expiresAfter: "2h" };
  },
};
