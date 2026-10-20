import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { adapterById } from "../../adapters/index.mjs";
import { readHeartbeatFile } from "../collector/runner.mjs";
import { validate } from "../web/js/validate.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = join(root, "dist");
const port = Number(process.env.PORT || 4173);
const loopback = ["127", "0", "0", "1"].join(".");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

await runBuild();
const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error.message || "request failed");
    send(res, 500, { error: "request failed" });
  });
});
server.listen(port, "localhost", () => {
  console.log(`Opsboard dev server at http://localhost:${port}`);
});

async function runBuild() {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["src/build/build.mjs"], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`build exited ${code}`))));
  });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/config") return saveConfig(req, res);
  if (req.method === "POST" && url.pathname === "/api/test") return testCheck(req, res);
  if (req.method === "POST" && url.pathname === "/api/heartbeat") return saveHeartbeat(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method" });
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = normalize(join(dist, pathname));
  if (!file.startsWith(dist)) return send(res, 403, { error: "path" });
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

async function saveConfig(req, res) {
  if (!fromLoopback(req)) return send(res, 403, { error: "config writes are limited to localhost" });
  if (!authorized(req)) return send(res, 401, { error: "settings token required" });
  const config = JSON.parse(await readBody(req));
  const schema = JSON.parse(await readFile(join(root, "schema/switchboard.schema.json"), "utf8"));
  const errors = validate(config, schema);
  if (errors.length) return send(res, 400, { errors });
  const target = join(root, "switchboard.config.json");
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`);
  await rename(temp, target);
  send(res, 200, { ok: true, note: "Wrote switchboard.config.json. Secrets were not stored." });
}

async function testCheck(req, res) {
  if (!fromLoopback(req)) return send(res, 403, { error: "test API is limited to localhost" });
  const body = JSON.parse(await readBody(req));
  const spec = body.spec || {};
  const ctx = {
    env: process.env,
    now: Date.now(),
    timeoutMs: 8000,
    fetch: globalThis.fetch,
    readFile: (relativePath) => readHeartbeatFile(root, relativePath),
  };
  let obs;
  if (spec.kind === "http" || spec.kind === "heartbeat") {
    const adapter = adapterById(spec.kind === "heartbeat" ? "heartbeat" : "http");
    obs = await adapter.check({ healthUrl: spec.url, url: spec.url, heartbeat: spec.url }, { url: spec.url, maxAge: "15m" }, ctx);
  } else if (spec.kind === "github") {
    obs = await adapterById("github-actions").check({ repo: spec.repo }, { tokenEnv: "GITHUB_TOKEN" }, ctx);
  } else if (spec.kind === "ssh") {
    const machine = (body.draft?.machines || []).find((item) => item.id === body.id) || {};
    obs = await adapterById("ssh-uptime").check(machine, {}, ctx);
  } else if (spec.kind === "file") {
    obs = { state: "unknown", label: "Needs the collector", detail: "File heartbeats are read by the collector on the host." };
  } else if (spec.kind === "static") {
    obs = { state: "ok", label: "Static", detail: "Static notes have no live endpoint." };
  } else {
    obs = { state: "unknown", label: "Not tested", detail: "This check needs the status Action." };
  }
  const good = ["ok", "auth", "redirect", "running"].includes(obs.state);
  send(res, 200, { state: good ? "pass" : "fail", label: good ? "Pass" : "Fail", reason: obs.detail || obs.label });
}

async function saveHeartbeat(req, res) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const body = JSON.parse(await readBody(req));
  const id = String(body.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!id) return send(res, 400, { error: "id" });
  const envName = `HEARTBEAT_TOKEN_${id.toUpperCase().replace(/-/g, "_")}`;
  const expected = process.env[envName] || process.env.OPSBOARD_HEARTBEAT_TOKEN || "";
  if (!expected || token !== expected) return send(res, 401, { error: "heartbeat token rejected" });
  const report = {
    id,
    observedAt: typeof body.observedAt === "string" ? body.observedAt : new Date().toISOString(),
    ok: body.ok !== false,
    metrics: body.metrics && typeof body.metrics === "object" ? body.metrics : undefined,
  };
  const dir = join(root, "heartbeats");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify(report)}\n`);
  send(res, 204, null);
}

function fromLoopback(req) {
  const address = req.socket.remoteAddress || "";
  return address === loopback || address === `::ffff:${loopback}` || address === "::1";
}

function authorized(req) {
  const required = process.env.SETTINGS_TOKEN || "";
  if (!required) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${required}`;
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8") || "{}"));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  if (body == null) {
    res.writeHead(status);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}
