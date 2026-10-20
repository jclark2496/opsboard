#!/usr/bin/env node
// Posts one heartbeat. The token and URL come from the environment, never from argv history if you export them first.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const id = argument("--id") || process.env.OPSBOARD_HEARTBEAT_ID;
const url = process.env.OPSBOARD_HEARTBEAT_URL;
const token = process.env.OPSBOARD_HEARTBEAT_TOKEN;

if (!id || !url || !token) {
  console.error("Set OPSBOARD_HEARTBEAT_URL, OPSBOARD_HEARTBEAT_TOKEN, and OPSBOARD_HEARTBEAT_ID (or --id).");
  process.exit(1);
}

const metrics = await readMetrics();
const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "user-agent": "opsboard-heartbeat",
  },
  body: JSON.stringify({
    id,
    observedAt: new Date().toISOString(),
    ok: true,
    metrics,
  }),
});

if (!response.ok) {
  console.error(`Heartbeat was rejected (${response.status}).`);
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1];
}

async function readMetrics() {
  const metrics = {};
  try {
    const first = parseStat(await readFile("/proc/stat", "utf8"));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    const second = parseStat(await readFile("/proc/stat", "utf8"));
    const idle = second.idle - first.idle;
    const total = second.total - first.total;
    if (total > 0) metrics.cpu = Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
  } catch { /* not a Linux host */ }
  try {
    const mem = await readFile("/proc/meminfo", "utf8");
    const total = Number(mem.match(/MemTotal:\s+(\d+)/)?.[1] || 0);
    const available = Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1] || 0);
    if (total) metrics.memory = Math.max(0, Math.min(100, Math.round((1 - available / total) * 100)));
  } catch { /* ignore */ }
  try {
    const df = await exec("df", ["-P", "/"]);
    const line = df.split("\n")[1] || "";
    const used = line.match(/(\d+)%/);
    if (used) metrics.disk = Number(used[1]);
  } catch { /* ignore */ }
  return metrics;
}

function parseStat(text) {
  const parts = (text.split("\n")[0] || "").trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((sum, value) => sum + (value || 0), 0);
  return { idle, total };
}

function exec(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise(stdout) : reject(new Error("command failed"))));
  });
}
