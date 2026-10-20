/** Browser-side probes. SSH, files, and tokens stay on the collector. */

const TIMEOUT_MS = 8000;

export async function probeTarget(spec, fetchImpl = globalThis.fetch) {
  if (!spec) return untested();
  if (spec.kind === "ssh") {
    return fail("SSH needs the collector or the status Action. A browser cannot open SSH.");
  }
  if (spec.kind === "file") {
    return fail("File heartbeats are read by the collector on the host. A browser cannot read that path.");
  }
  if (spec.kind === "static") {
    return pass("Static notes have no live endpoint.");
  }
  if (spec.kind === "github") {
    return probeGithub(spec.repo, fetchImpl);
  }
  if (spec.kind === "http" || spec.kind === "heartbeat") {
    if (!spec.url) return fail("No public URL to test. Add an https URL, or run the collector.");
    return probeHttp(spec.url, fetchImpl);
  }
  return fail("This check needs the collector or the status Action.");
}

async function probeGithub(repo, fetchImpl) {
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return fail("Repository must look like owner/name.");
  const url = `https://api.github.com/repos/${repo}`;
  try {
    const response = await timedFetch(fetchImpl, url, {
      headers: { accept: "application/vnd.github+json", "user-agent": "opsboard" },
    });
    if (response.status === 200) return pass("Public repository is visible. Workflow runs are read by the status Action.");
    if (response.status === 404) return fail("No public repository by that name. A private repo needs the status Action and a token in secrets.");
    if (response.status === 401 || response.status === 403) return fail("GitHub refused the anonymous request. The status Action can retry with a token.");
    return fail(`HTTP ${response.status}`);
  } catch (error) {
    return fail(networkReason(error));
  }
}

async function probeHttp(url, fetchImpl) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail("The URL is not valid.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fail("Only http and https can be tested from the browser.");
  try {
    const response = await timedFetch(fetchImpl, url, { redirect: "manual" });
    const status = response.status;
    if (status === 0) return fail("Browser blocked the response. The status Action can test this URL from the collector.");
    if (status === 401) return pass("Sign-in required (401). The host answered.");
    if (status === 403) return pass("Access restricted (403). The host answered.");
    if (status >= 200 && status < 400) return pass(`HTTP ${status}`);
    if (status >= 400 && status < 500) return fail(`HTTP ${status}`);
    if (status >= 500) return fail(`HTTP ${status}`);
    return pass(`HTTP ${status}`);
  } catch (error) {
    return fail(networkReason(error));
  }
}

async function timedFetch(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function networkReason(error) {
  const name = error?.name || "";
  if (name === "AbortError") return `Timed out after ${TIMEOUT_MS / 1000}s`;
  return "Browser could not read this URL. The status Action can test it from the collector.";
}

function pass(reason) {
  return { state: "pass", label: "Pass", reason };
}

function fail(reason) {
  return { state: "fail", label: "Fail", reason };
}

function untested() {
  return { state: "untested", label: "Not tested", reason: "" };
}

export { untested };
