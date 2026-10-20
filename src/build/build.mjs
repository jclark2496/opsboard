import { cp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "../web/js/nav.js";
import { renderDocument } from "../web/js/document.js";
import { validate } from "../web/js/validate.js";
import { emptyBoard, isBlank } from "../web/js/model.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = resolve(root, "dist");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const schema = await readJson(resolve(root, "schema/switchboard.schema.json"));
const demoConfig = await readJson(resolve(root, "switchboard.config.example.json"));
const demoStatus = await readJson(resolve(root, "demo/status.demo.json"));
const demoErrors = validate(demoConfig, schema);
if (demoErrors.length) {
  console.error("switchboard.config.example.json failed schema validation:");
  console.error(demoErrors.join("\n"));
  process.exit(1);
}

let userConfig = null;
const userPath = resolve(root, "switchboard.config.json");
if (await exists(userPath)) {
  userConfig = await readJson(userPath);
  const userErrors = validate(userConfig, schema);
  if (userErrors.length) {
    console.error("switchboard.config.json failed schema validation:");
    console.error(userErrors.join("\n"));
    process.exit(1);
  }
}

let liveStatus = { schemaVersion: 1, generatedAt: new Date().toISOString(), demo: false, observations: [] };
const livePath = resolve(root, "status/status.json");
if (await exists(livePath)) liveStatus = await readJson(livePath);

const useUser = userConfig && userConfig.board?.demo === false;
const config = useUser ? userConfig : demoConfig;
const status = useUser ? liveStatus : demoStatus;
const demo = !useUser;
const blank = !demo && isBlank(config);
if (!demo && (config.board?.auth || "none") === "none" && !blank) {
  console.warn("\nWARNING: This dashboard is public. Anyone can see your hostnames. Put it behind an auth gate before publishing real data.\n");
}

const boot = { demoConfig, userConfig, demoStatus, liveStatus, schema };
const bootJson = JSON.stringify(boot).replace(/</g, "\\u003c");
const now = Date.now();
const theme = config.theme?.mode === "dark" ? "dark" : "light";

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, "src/web/css"), resolve(dist, "css"), { recursive: true });
await cp(resolve(root, "src/web/fonts"), resolve(dist, "fonts"), { recursive: true });
await cp(resolve(root, "src/web/js"), resolve(dist, "js"), { recursive: true });
await cp(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
await cp(resolve(root, "src/web/favicon.svg"), resolve(dist, "favicon.svg"));
await mkdir(resolve(dist, "schema"), { recursive: true });
await cp(resolve(root, "schema/switchboard.schema.json"), resolve(dist, "schema/switchboard.schema.json"));
await writeFile(resolve(dist, "status.json"), `${JSON.stringify(liveStatus, null, 2)}\n`);
await writeFile(resolve(dist, "switchboard.config.example.json"), `${JSON.stringify(demoConfig, null, 2)}\n`);

for (const page of PAGES) {
  const html = renderDocument({
    pageId: page.id,
    config: blank ? emptyBoard(demoConfig) : config,
    status,
    demo,
    blank,
    now,
    theme,
    draft: config,
    tests: {},
    changes: [],
    errors: [],
    appId: "",
    bootJson,
  });
  const file = resolve(dist, page.file);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

console.log(`Built ${PAGES.length} pages in dist/ (${demo ? "demo" : "configured"} data)`);
