import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sshCategory } from "../src/collector/errors.mjs";

export default {
  id: "ssh-uptime",
  kinds: ["machine"],
  env: ["SSH_KNOWN_HOSTS"],
  schema: {
    type: "object",
    properties: {
      maxAge: { type: "string" },
    },
  },
  async check(target, options = {}, ctx) {
    const expiresAfter = options.maxAge || "15m";
    const host = options.host || target.host;
    const user = options.user || target.user;
    const keyEnv = options.keyEnv || target.keyEnv;
    const knownEnv = options.knownHostsEnv || target.knownHostsEnv || "SSH_KNOWN_HOSTS";
    if (!host || !user) return { state: "unknown", label: "Not configured", detail: "Host and SSH user are required", expiresAfter };
    const key = keyEnv ? ctx.env?.[keyEnv] : "";
    const known = ctx.env?.[knownEnv] || "";
    if (keyEnv && !key) return { state: "unknown", label: "Key not set", detail: `Set ${keyEnv} for the collector`, expiresAfter };
    if (!known) return { state: "unknown", label: "Host key not set", detail: `Set ${knownEnv} to a pinned host key`, expiresAfter };
    const exec = ctx.exec || defaultExec;
    const dir = await mkdtemp(join(tmpdir(), "opsboard-ssh-"));
    try {
      const knownPath = join(dir, "known_hosts");
      await writeFile(knownPath, known.endsWith("\n") ? known : `${known}\n`, { mode: 0o600 });
      const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownPath}`, "-o", "ConnectTimeout=8", "-o", "IdentitiesOnly=yes"];
      if (key) {
        const keyPath = join(dir, "id");
        await writeFile(keyPath, key.endsWith("\n") ? key : `${key}\n`, { mode: 0o600 });
        await chmod(keyPath, 0o600);
        args.push("-i", keyPath);
      }
      args.push(`${user}@${host}`, "cat /proc/uptime");
      const result = await exec("ssh", args, ctx.timeoutMs || 12000);
      if (result.code !== 0) {
        return { state: "fail", label: "Fail", detail: sshCategory(result.stderr), expiresAfter };
      }
      const seconds = Number(String(result.stdout || "").trim().split(/\s+/)[0]);
      if (!Number.isFinite(seconds)) return { state: "unknown", label: "Unreadable uptime", detail: "The host did not return uptime", expiresAfter };
      return { state: "ok", label: "Checks normal", detail: "Uptime check succeeded", expiresAfter, metrics: { uptimeSeconds: Math.round(seconds) } };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  demo() {
    return { state: "ok", label: "Checks normal", detail: "Sample uptime", expiresAfter: "15m", metrics: { uptimeSeconds: 86400 } };
  },
};

function defaultExec(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs || 12000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: "ssh client missing" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
