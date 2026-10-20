import { readdir, readFile, access } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scanText } from "./scrub-check.mjs";

const root = resolve(process.cwd());
const dist = resolve(root, "dist");
const KEEP = new Set(["ipv4", "mac", "email", "private-key", "token-prefix"]);

export function keepFinding(finding) {
  return KEEP.has(finding.rule) || finding.rule.startsWith("term:") || finding.rule.startsWith("name:");
}

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function scanDist(dir = dist) {
  const findings = [];
  for (const path of await walk(dir)) {
    const bytes = await readFile(path);
    const binary = [".woff2", ".woff", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"].includes(extname(path).toLowerCase()) || bytes.includes(0);
    const text = binary ? bytes.toString("latin1") : bytes.toString("utf8");
    findings.push(...scanText(text, relative(dir, path), { binary }).filter(keepFinding));
  }
  return findings;
}

async function main() {
  try {
    await access(dist);
  } catch {
    console.error("dist/ is missing. Run npm run build first.");
    process.exit(1);
  }
  const findings = await scanDist();
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  if (findings.length) {
    console.error(`redlines failed with ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log("redlines passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || "redlines failed");
    process.exit(1);
  });
}
