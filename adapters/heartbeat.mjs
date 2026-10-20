import { category } from "../src/collector/errors.mjs";
import { parseDuration } from "../src/web/js/model.js";

export default {
  id: "heartbeat",
  kinds: ["machine", "agent"],
  env: [],
  schema: {
    type: "object",
    properties: {
      url: { type: "string" },
      file: { type: "string" },
      maxAge: { type: "string" },
      tokenEnv: { type: "string" },
    },
  },
  async check(target, options = {}, ctx) {
    const expiresAfter = options.maxAge || "15m";
    const maxAge = parseDuration(expiresAfter) || 15 * 60 * 1000;
    let payload;
    try {
      payload = await loadPayload(target, options, ctx);
    } catch (error) {
      return { state: "unknown", label: "No heartbeat yet", detail: category(error), expiresAfter };
    }
    if (!payload) return { state: "unknown", label: "No heartbeat yet", detail: "No file or URL returned a report", expiresAfter };
    const observedAt = payload.observedAt || payload.at;
    const age = observedAt ? ctx.now - Date.parse(observedAt) : Infinity;
    if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
      return { state: "unknown", label: "Unreadable heartbeat", detail: "The report has no observedAt time", expiresAfter };
    }
    if (payload.ok === false) {
      return { state: "fail", label: "Heartbeat failed", detail: "The reporter marked this host not ok", expiresAfter, metrics: payload.metrics };
    }
    if (age > maxAge) {
      return { state: "stale", label: "No recent data", detail: "The heartbeat is older than its expiry", expiresAfter, metrics: payload.metrics };
    }
    return { state: "ok", label: "Checks normal", detail: "Heartbeat is fresh", expiresAfter, metrics: payload.metrics };
  },
  demo() {
    return { state: "ok", label: "Checks normal", detail: "Sample heartbeat", expiresAfter: "15m" };
  },
};

async function loadPayload(target, options, ctx) {
  if (options.file && ctx.readFile) {
    const text = await ctx.readFile(options.file);
    if (!text) return null;
    return JSON.parse(text);
  }
  const url = options.url || target.heartbeat;
  if (!url) return null;
  const headers = { accept: "application/json", "user-agent": "opsboard" };
  const tokenEnv = options.tokenEnv;
  if (tokenEnv && ctx.env?.[tokenEnv]) headers.authorization = `Bearer ${ctx.env[tokenEnv]}`;
  const response = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(ctx.timeoutMs || 10000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    throw error;
  }
  return response.json();
}
