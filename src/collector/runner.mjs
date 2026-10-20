import { readFile } from "node:fs/promises";
import { adapterById } from "../../adapters/index.mjs";

const LIMIT = 4;

export async function collectAll(config, ctx) {
  const jobs = [];
  for (const machine of config.machines || []) jobs.push({ entity: machine, kind: "machine" });
  for (const app of config.apps || []) jobs.push({ entity: app, kind: "app" });
  for (const repo of config.repos || []) jobs.push({ entity: repo, kind: "repo" });
  for (const agent of config.agents || []) jobs.push({ entity: agent, kind: "agent" });
  const observations = [];
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      for (const check of job.entity.checks || []) {
        observations.push(await runCheck(job, check, ctx));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, jobs.length) || 1 }, worker));
  return {
    schemaVersion: 1,
    generatedAt: new Date(ctx.now).toISOString(),
    demo: Boolean(ctx.demo),
    observations,
  };
}

async function runCheck(job, check, ctx) {
  const adapter = adapterById(check.adapter);
  const targetId = job.kind === "repo" ? (job.entity.app || job.entity.id) : job.entity.id;
  const kind = job.kind === "repo" ? "deploy" : job.kind;
  const base = {
    id: `${kind}:${targetId}:${check.adapter}`,
    kind,
    target: targetId,
    adapter: check.adapter,
    attention: check.attention,
    observedAt: new Date(ctx.now).toISOString(),
  };
  if (!adapter) {
    return { ...base, state: "unknown", label: "Unknown adapter", detail: "That adapter is not installed", expiresAfter: "24h" };
  }
  try {
    const result = ctx.demo && adapter.demo
      ? await adapter.demo(job.entity, check.options || {}, ctx)
      : await adapter.check(job.entity, check.options || {}, ctx);
    return { ...base, ...result, detail: typeof result.detail === "string" ? result.detail : "" };
  } catch {
    return { ...base, state: "unknown", label: "Check failed", detail: "unreachable", expiresAfter: "2h" };
  }
}

export async function readHeartbeatFile(root, relativePath) {
  const { resolve, relative } = await import("node:path");
  const full = resolve(root, relativePath);
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.includes("..")) return null;
  try {
    return await readFile(full, "utf8");
  } catch {
    return null;
  }
}
