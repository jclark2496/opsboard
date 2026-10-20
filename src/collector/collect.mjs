import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectAll, readHeartbeatFile } from "./runner.mjs";
import { validate } from "../web/js/validate.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const configPath = resolve(root, arg("--config", "switchboard.config.json"));
const examplePath = resolve(root, "switchboard.config.example.json");
const outPath = resolve(root, arg("--out", "status/status.json"));
const demo = process.argv.includes("--demo");

const schema = JSON.parse(await readFile(resolve(root, "schema/switchboard.schema.json"), "utf8"));
let raw;
try {
  raw = await readFile(configPath, "utf8");
} catch {
  raw = await readFile(examplePath, "utf8");
}
const config = JSON.parse(raw);
const errors = validate(config, schema);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const status = await collectAll(config, {
  env: process.env,
  now: Date.now(),
  timeoutMs: 10000,
  demo,
  fetch: globalThis.fetch,
  readFile: (relativePath) => readHeartbeatFile(root, relativePath),
});

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(status, null, 2)}\n`);
const counts = status.observations.reduce((map, obs) => {
  map[obs.state] = (map[obs.state] || 0) + 1;
  return map;
}, {});
console.log(`Wrote ${status.observations.length} observations to ${outPath} ${JSON.stringify(counts)}`);
