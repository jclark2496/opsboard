import { category } from "../src/collector/errors.mjs";

export default {
  id: "http",
  kinds: ["app"],
  env: [],
  schema: {
    type: "object",
    properties: {
      expect: { type: "array", items: { type: "number" } },
      maxAge: { type: "string" },
    },
  },
  async check(target, options = {}, ctx) {
    const url = options.url || target.healthUrl || target.url;
    const expiresAfter = options.maxAge || "2h";
    if (!url) return { state: "unknown", label: "Not configured", detail: "Add a health URL", expiresAfter };
    const started = Date.now();
    let response;
    try {
      response = await ctx.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(ctx.timeoutMs || 10000) });
    } catch (error) {
      const reason = category(error);
      return { state: reason === "timeout" ? "fail" : "unknown", label: reason === "timeout" ? "Timed out" : "Not reachable", detail: reason, expiresAfter };
    }
    const ms = Date.now() - started;
    const status = response.status;
    if (status >= 300 && status < 400) {
      return { state: "redirect", label: "Redirect", detail: `HTTP ${status} in ${ms} ms`, expiresAfter };
    }
    if (status === 401) return { state: "auth", label: "Sign-in required", detail: `HTTP 401 in ${ms} ms`, expiresAfter };
    if (status === 403) return { state: "auth", label: "Access restricted", detail: `HTTP 403 in ${ms} ms`, expiresAfter };
    const expect = options.expect || [200];
    if (expect.includes(status)) return { state: "ok", label: "Responding", detail: `HTTP ${status} in ${ms} ms`, expiresAfter };
    if (status >= 500 || status === 404) return { state: "fail", label: `HTTP ${status}`, detail: `HTTP ${status} in ${ms} ms`, expiresAfter };
    return { state: "fail", label: `HTTP ${status}`, detail: `HTTP ${status} in ${ms} ms`, expiresAfter };
  },
  demo() {
    return { state: "ok", label: "Responding", detail: "Sample HTTP check", expiresAfter: "2h" };
  },
};
