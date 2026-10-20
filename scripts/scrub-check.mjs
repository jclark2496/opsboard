import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const RULES_B64 = "eyJ0ZXJtcyI6WyJzYW5kYWxzcm9ja3MiLCJqY2xhcmsyNDk2IiwibG9vcHZpc29yeSIsImppbGxtYWRlaXQiLCJmb3JrdGhpcyIsImlkZWFzb3MiLCJyb2FzdHlvdXJyaXZhbCIsInVwc2V0c2NvdXQiLCJ3aG9zZHJpdmluZyIsImZ1bmVyYWx0aGlyc3R5Iiwic3J2MTczOTU3NCIsImhlcm1lcyIsImNoaWVmIiwiZmlnLW9wcyIsImZpZ29wcyIsIi9Vc2Vycy9maWciLCJ0cy5uZXQiXSwibmFtZXMiOlsiSmFzb24iLCJKaWxsIiwiQ2xhcmsiXSwiYWxsb3ciOlsiZ2l0aHViLmNvbS9qY2xhcmsyNDk2L29wc2JvYXJkIiwiamNsYXJrMjQ5NiA8MzQ2NTU0NDkramNsYXJrMjQ5NkB1c2Vycy5ub3JlcGx5LmdpdGh1Yi5jb20+IiwiamNsYXJrMjQ5NiA8amNsYXJrMjQ5NkB1c2Vycy5ub3JlcGx5LmdpdGh1Yi5jb20+Il0sImFsbG93UmUiOlsiQ29weXJpZ2h0IFxcKGNcXCkgXFxkezR9IGpjbGFyazI0OTYiXSwidG9rZW5SZSI6IlxcYig/OmdocF9bQS1aYS16MC05XXxnaXRodWJfcGF0X3xnaG9fW0EtWmEtejAtOV18eG94W2JhcHJzXS18c2stW0EtWmEtejAtOV0pIn0=";

const SKIP_DIRS = new Set([".git", "node_modules"]);
const BINARY_EXT = new Set([".woff2", ".woff", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf"]);
const DOC_NETS = [
  [192, 0, 2],
  [198, 51, 100],
  [203, 0, 113],
];

export function loadRules() {
  return JSON.parse(Buffer.from(RULES_B64, "base64").toString("utf8"));
}

export function neutralize(text, rules = loadRules()) {
  let out = text;
  for (const exact of rules.allow || []) {
    if (!exact) continue;
    out = out.replaceAll(exact, " ".repeat(exact.length));
  }
  for (const source of rules.allowRe || []) {
    out = out.replace(new RegExp(source, "g"), (match) => " ".repeat(match.length));
  }
  return out;
}

const HISTORY_BOT = ["cursoragent", "cursor.com"].join("@");
const NOREPLY_HOST = ["users.noreply", "github.com"].join(".");

export function scanText(text, file, { binary = false, history = false, rules = loadRules() } = {}) {
  const clean = neutralize(String(text), rules);
  const findings = [];
  const push = (index, rule) => {
    const line = clean.slice(0, index).split("\n").length;
    findings.push({ file, line, rule });
  };
  const terms = rules.terms || [];
  for (const term of terms) {
    if (binary && term.length < 8) continue;
    const re = new RegExp(escapeReg(term), "gi");
    for (const match of clean.matchAll(re)) push(match.index, `term:${term}`);
  }
  for (const name of rules.names || []) {
    if (binary) continue;
    const re = new RegExp(`\\b${escapeReg(name)}\\b`, "gi");
    for (const match of clean.matchAll(re)) push(match.index, "name");
  }
  if (!binary) {
    const ip = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    for (const match of clean.matchAll(ip)) {
      if (ipClass(match[0]) === "other") push(match.index, "ipv4");
    }
    const mac = /\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/g;
    for (const match of clean.matchAll(mac)) push(match.index, "mac");
    const email = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    for (const match of clean.matchAll(email)) {
      if (emailAllowed(match[0], { history })) continue;
      const line = lineText(clean, match.index);
      if (/^(?:Author|Commit|From):/.test(line)) continue;
      push(match.index, "email");
    }
    const keyRe = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
    const keyAt = clean.search(keyRe);
    if (keyAt !== -1) push(keyAt, "private-key");
    if (rules.tokenRe) {
      const tokenAt = clean.search(new RegExp(rules.tokenRe));
      if (tokenAt !== -1) push(tokenAt, "token-prefix");
    }
  }
  return findings;
}

function lineText(text, index) {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? undefined : end);
}

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ipClass(text) {
  const parts = text.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return "ignore";
  const [a, b, c] = parts;
  if (DOC_NETS.some(([x, y, z]) => a === x && b === y && c === z)) return "doc";
  return "other";
}

function emailAllowed(email, { history = false } = {}) {
  const lower = email.toLowerCase();
  const host = lower.split("@")[1];
  if (["example.com", "example.org", "example.test"].some((name) => host === name || host.endsWith(`.${name}`))) return true;
  if (!history) return false;
  if (host === NOREPLY_HOST) return true;
  return lower === HISTORY_BOT;
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function scanTree(root) {
  const findings = [];
  for (const path of await walk(root)) {
    const rel = relative(root, path);
    const bytes = await readFile(path);
    const binary = BINARY_EXT.has(extname(path).toLowerCase()) || bytes.includes(0);
    const text = binary ? bytes.toString("latin1") : bytes.toString("utf8");
    findings.push(...scanText(text, rel, { binary }));
  }
  return findings;
}

export function scanHistory(root) {
  let log = "";
  try {
    log = execFileSync("git", ["log", "-p", "--all", "--no-color"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (error.status == null) throw error;
    return [{ file: "git-history", line: 1, rule: "git-log-failed" }];
  }
  return scanText(log, "git-history", { binary: false, history: true });
}

function report(findings) {
  const seen = new Set();
  const unique = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  for (const finding of unique) {
    console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  }
  return unique.length;
}

async function main() {
  const root = process.cwd();
  const findings = [...await scanTree(root), ...scanHistory(root)];
  const count = report(findings);
  if (count) {
    console.error(`scrub check failed with ${count} finding${count === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log("scrub check passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || "scrub check failed");
    process.exit(1);
  });
}
