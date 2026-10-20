import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import http from "../adapters/http.mjs";
import github from "../adapters/github-actions.mjs";
import heartbeat from "../adapters/heartbeat.mjs";
import jsonAdapter, { readPath } from "../adapters/json.mjs";
import ssh from "../adapters/ssh-uptime.mjs";
import { renderDocument } from "../src/web/js/document.js";
import { attentionItems, effectiveObservation, emptyBoard } from "../src/web/js/model.js";
import { validate } from "../src/web/js/validate.js";
import { scanText } from "../scripts/scrub-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("example config matches the schema and rejects secrets", async () => {
  const schema = await readJson("../schema/switchboard.schema.json");
  const example = await readJson("../switchboard.config.example.json");
  assert.deepEqual(validate(example, schema), []);
  const withPassword = structuredClone(example);
  withPassword.machines[0].password = "nope";
  assert.ok(validate(withPassword, schema).some((error) => error.includes("password")));
  const withToken = structuredClone(example);
  const prefix = ["gh", "p_"].join("");
  withToken.board.tagline = `${prefix}abcdefghijklmnopqrstuvwxyz`;
  assert.ok(validate(withToken, schema).some((error) => error.includes("token")));
});

test("http adapter distinguishes auth, failure, and timeout", async () => {
  const ctx = (status) => ({ fetch: async () => ({ status }), timeoutMs: 1000, now: Date.now(), env: {} });
  const authed = await http.check({ url: "https://example.com/healthz" }, {}, ctx(401));
  assert.equal(authed.state, "auth");
  assert.equal(authed.label, "Sign-in required");
  const failed = await http.check({ url: "https://example.com/healthz" }, {}, ctx(502));
  assert.equal(failed.state, "fail");
  assert.match(failed.label, /502/);
  const timed = await http.check({ url: "https://example.com/healthz" }, {}, {
    fetch: async () => { throw new Error("The operation was aborted due to timeout"); },
  });
  assert.equal(timed.state, "fail");
  assert.equal(timed.detail, "timeout");
});

test("github adapter ignores pull request runs", async () => {
  const body = {
    workflow_runs: [
      { event: "pull_request", conclusion: "success", name: "Deploy", path: ".github/workflows/deploy.yml", status: "completed", head_branch: "main" },
      { event: "push", conclusion: "failure", name: "Deploy", path: ".github/workflows/deploy.yml", status: "completed", head_branch: "main" },
    ],
  };
  const result = await github.check({ repo: "example-org/example-app" }, { workflow: "deploy.yml" }, {
    fetch: async () => ({ status: 200, ok: true, json: async () => body }),
    env: {},
    now: Date.now(),
  });
  assert.equal(result.state, "fail");
  assert.equal(result.label, "Failed");
});

test("json adapter reads a dotted path", async () => {
  assert.equal(readPath({ a: { b: [{ c: "ok" }] } }, "$.a.b[0].c"), "ok");
  const result = await jsonAdapter.check({ url: "https://example.com/status.json" }, { statePath: "$.service.state", okValue: "up" }, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ service: { state: "up" }, metrics: { cpu: 12 } }) }),
    env: {},
    now: Date.now(),
  });
  assert.equal(result.state, "ok");
  assert.equal(result.metrics.cpu, 12);
});

test("heartbeat older than maxAge is stale", async () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const observedAt = new Date(now - 60 * 60 * 1000).toISOString();
  const result = await heartbeat.check({ id: "acme-vps-1" }, { file: "heartbeats/acme-vps-1.json", maxAge: "15m" }, {
    now,
    readFile: async () => JSON.stringify({ observedAt, ok: true, metrics: { cpu: 10 } }),
  });
  assert.equal(result.state, "stale");
  assert.equal(result.label, "No recent data");
});

test("ssh failures are categorized and do not echo stderr", async () => {
  const marker = ["secret", "material"].join("-");
  const result = await ssh.check(
    { host: "203.0.113.10", user: "ci", keyEnv: "SSH_KEY_TEST", knownHostsEnv: "SSH_KNOWN_HOSTS" },
    {},
    {
      env: { SSH_KEY_TEST: "not-a-real-key\n", SSH_KNOWN_HOSTS: "203.0.113.10 ssh-ed25519 AAAA" },
      exec: async () => ({ code: 255, stdout: "", stderr: `${marker} permission denied for user` }),
      timeoutMs: 1000,
    },
  );
  assert.equal(result.state, "fail");
  assert.equal(result.detail, "SSH authentication failed");
  assert.equal(JSON.stringify(result).includes(marker), false);
});

test("freshness turns old success into stale and keeps failures", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const observedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const stale = effectiveObservation({ state: "ok", label: "Checks normal", observedAt, expiresAfter: "15m" }, now);
  assert.equal(stale.state, "stale");
  const failed = effectiveObservation({ state: "fail", label: "Failed", observedAt, expiresAfter: "15m" }, now);
  assert.equal(failed.state, "fail");
});

test("attention keeps fail ahead of notice and drops silenced targets", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const status = {
    observations: [
      { id: "a", kind: "deploy", target: "example-app", state: "fail", label: "Failed", attention: false, observedAt: new Date(now).toISOString(), expiresAfter: "2h" },
      { id: "b", kind: "app", target: "example-app", state: "fail", label: "HTTP 502", attention: true, observedAt: new Date(now).toISOString(), expiresAfter: "2h" },
      { id: "c", kind: "machine", target: "build-box-01", state: "stale", label: "No recent data", observedAt: new Date(now).toISOString(), expiresAfter: "15m" },
      { id: "d", kind: "agent", target: "quiet-bot", state: "unknown", label: "Not connected", attention: false, observedAt: new Date(now).toISOString(), expiresAfter: "2h" },
      { id: "e", kind: "agent", target: "loud-bot", state: "unknown", label: "Not connected", attention: true, observedAt: new Date(now).toISOString(), expiresAfter: "2h" },
    ],
  };
  const config = { notices: [{ id: "cert", title: "Renew cert", state: "warn", detail: "expires soon" }] };
  const items = attentionItems(config, status, now);
  assert.deepEqual(items.map((item) => item.target), ["example-app", "cert", "build-box-01", "loud-bot"]);
  assert.equal(items[0].title, "Restart example-app");
});

test("overview renders demo evidence and the empty state hides it", async () => {
  const config = await readJson("../switchboard.config.example.json");
  const status = await readJson("../demo/status.demo.json");
  const now = Date.now();
  const html = renderDocument({
    pageId: "overview",
    config,
    status,
    demo: true,
    theme: "light",
    now,
    bootJson: "{}",
  });
  assert.match(html, /Worth a look/);
  assert.match(html, /Restart example-app/);
  assert.match(html, /build-box-01/);
  assert.match(html, /Demo data — connect your own/);
  assert.match(html, /triage-bot/);
  const agents = renderDocument({ pageId: "agents", config, status, demo: true, theme: "dark", now, bootJson: "{}" });
  assert.match(agents, /data-theme="dark"/);
  assert.match(agents, /Who works for whom/);
  assert.match(agents, /review-bot/);
  assert.match(agents, /assets\/portraits\/robot-1\.svg/);
  const empty = renderDocument({
    pageId: "overview",
    config: emptyBoard(config),
    status: { observations: [] },
    demo: false,
    blank: true,
    theme: "light",
    now,
    bootJson: "{}",
  });
  assert.match(empty, /Nothing is connected yet/);
  assert.match(empty, /Add your first source/);
  assert.match(empty, /attention-panel" aria-labelledby="attention-title" hidden/);
  assert.doesNotMatch(empty, /build-box-01/);
});

test("scrub flags a planted term and accepts the documentation address", () => {
  const planted = ["fig", "-ops"].join("");
  const hit = scanText(`see ${planted} here`, "notes.md");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].rule, `term:${planted}`);
  assert.equal(hit[0].line, 1);
  const name = ["Ja", "son"].join("");
  assert.equal(scanText(`Hello ${name}`, "notes.md")[0].rule, "name");
  const owner = ["jcl", "ark2496"].join("");
  assert.equal(scanText(`Copyright (c) 2026 ${owner}`, "LICENSE").length, 0);
  assert.equal(scanText(`https://github.com/${owner}/opsboard`, "README.md").length, 0);
  assert.equal(scanText("host 192.0.2.44", "config.json").length, 0);
  const other = ["10", "1", "2", "3"].join(".");
  assert.equal(scanText(`host ${other}`, "config.json")[0].rule, "ipv4");
  const mail = ["person", "example.net"].join("@");
  assert.equal(scanText(mail, "config.json")[0].rule, "email");
  assert.equal(scanText("ops@example.com", "config.json").length, 0);
});

test("git history allows noreply and the agent mailbox only", () => {
  const bot = ["cursoragent", "cursor.com"].join("@");
  const noreply = ["34655449+dev", ["users.noreply", "github.com"].join(".")].join("@");
  const other = ["person", "example.net"].join("@");
  const log = [
    `    Co-authored-by: Cursor Agent <${bot}>`,
    `    Co-authored-by: Dev <${noreply}>`,
    `    Co-authored-by: Person <${other}>`,
  ].join("\n");
  const history = scanText(log, "git-history", { history: true });
  const emails = history.filter((finding) => finding.rule === "email");
  assert.equal(emails.length, 1);
  assert.equal(emails[0].line, 3);
  assert.equal(scanText(bot, "notes.md").some((finding) => finding.rule === "email"), true);
  assert.equal(scanText(noreply, "notes.md").some((finding) => finding.rule === "email"), true);
  const planted = ["fig", "-ops"].join("");
  assert.equal(scanText(`${planted} <${bot}>`, "git-history", { history: true }).some((finding) => finding.rule === `term:${planted}`), true);
});

test("scrub check passes on this tree", () => {
  const result = spawnSync(process.execPath, ["scripts/scrub-check.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("a temp file outside the repo can still be scanned", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opsboard-scrub-"));
  try {
    const word = ["her", "mes"].join("");
    await writeFile(join(dir, "note.txt"), word);
    const text = await readFile(join(dir, "note.txt"), "utf8");
    assert.equal(scanText(text, "note.txt")[0].rule, `term:${word}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
