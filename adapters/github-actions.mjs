import { category } from "../src/collector/errors.mjs";

export default {
  id: "github-actions",
  kinds: ["deploy"],
  env: ["GITHUB_TOKEN"],
  schema: {
    type: "object",
    properties: {
      workflow: { type: "string" },
      branch: { type: "string" },
      tokenEnv: { type: "string" },
    },
  },
  async check(target, options = {}, ctx) {
    const repo = options.repo || target.repo;
    const parts = String(repo || "").split("/");
    const expiresAfter = options.maxAge || "24h";
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { state: "unknown", label: "Not configured", detail: "Repository must look like owner/name", expiresAfter };
    }
    const tokenEnv = options.tokenEnv || "GITHUB_TOKEN";
    const token = ctx.env?.[tokenEnv] || "";
    const headers = { accept: "application/vnd.github+json", "user-agent": "opsboard" };
    if (token) headers.authorization = `Bearer ${token}`;
    const branch = options.branch ? `&branch=${encodeURIComponent(options.branch)}` : "";
    const url = `https://api.github.com/repos/${parts[0]}/${parts[1]}/actions/runs?per_page=20${branch}`;
    let response;
    try {
      response = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(ctx.timeoutMs || 10000) });
    } catch (error) {
      return { state: "unknown", label: "Not reachable", detail: category(error), expiresAfter };
    }
    if (response.status === 404) return { state: "unknown", label: "Repo not found", detail: "No visible repository by that name", expiresAfter: "6h" };
    if (response.status === 401 || response.status === 403) return { state: "unknown", label: "Token rejected", detail: "Token missing repo scope", expiresAfter: "6h" };
    if (!response.ok) return { state: "unknown", label: `HTTP ${response.status}`, detail: "Workflow runs were not returned", expiresAfter: "6h" };
    const body = await response.json();
    const workflow = options.workflow;
    const runs = (body.workflow_runs || []).filter((run) => {
      if (run.event === "pull_request") return false;
      if (!workflow) return true;
      const path = String(run.path || "");
      return run.name === workflow || path.endsWith(`/${workflow}`) || path.endsWith(workflow);
    });
    const latest = runs[0];
    if (!latest) return { state: "unknown", label: "Not tracked", detail: "No release runs. Pull request runs are ignored.", expiresAfter };
    const where = `${workflow || "workflow"} on ${latest.head_branch || options.branch || "the branch"}`;
    if (["in_progress", "queued", "waiting", "pending", "requested"].includes(latest.status)) {
      return { state: "running", label: "Running", detail: `${where} is running`, expiresAfter: "6h" };
    }
    if (latest.conclusion === "success") return { state: "ok", label: "Succeeded", detail: `${where} succeeded`, expiresAfter };
    if (["failure", "timed_out", "startup_failure", "cancelled"].includes(latest.conclusion)) {
      return { state: "fail", label: "Failed", detail: `${where} failed`, expiresAfter };
    }
    return { state: "unknown", label: latest.conclusion || "Unknown", detail: `${where} finished without success`, expiresAfter };
  },
  demo() {
    return { state: "unknown", label: "Not tracked", detail: "Sample deploy check", expiresAfter: "24h" };
  },
};
