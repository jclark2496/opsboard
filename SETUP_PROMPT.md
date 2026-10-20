# Setup prompt

Paste the block below to a coding agent (Claude, Codex, Grok, or another coding agent) in a checkout of this repository. It fills in your config, wires secrets, and deploys. It does not invent a new dashboard.

---

You are setting up Opsboard, the static ops dashboard in this repository. Read `README.md`, `switchboard.config.example.json`, and `schema/switchboard.schema.json` before you edit anything. Keep the existing pages, CSS, and adapters. Do not redesign the UI.

Goal: replace the sample with this operator's real machines, apps, repos, agents, and reference notes, then deploy on GitHub Pages.

## Ask before you write

Interview only for what the example file does not already make obvious. Group the questions:

1. Board name, wordmark, timezone, and whether the published site sits behind an auth gate.
2. Machines: display name, role, Linux/Mac/Windows/VPS, place name (home, cloud, or edge), hostname that the collector can reach, SSH user. Not a password.
3. For each machine, heartbeat (preferred) or SSH uptime, or both. If heartbeat: the private URL or the file name the collector will read, and the env var that will hold the bearer token.
4. Apps: name, public URL, health URL, which machine they run on, expected status codes (include 401 when sign-in is the healthy answer).
5. Repos: `owner/name`, release branch, workflow file name, env var for a read-only token.
6. Agents: name, one-line role, who they report to (`you` or another agent id), portrait `robot-1` through `robot-6`, heartbeat URL or file.
7. Optional: device groups, runbooks, where secrets are stored (names only), knowledge links, backlog items.

Use only facts the operator gives you. Where they have not decided, leave the sample row out instead of guessing a hostname.

## Config rules

- Write `switchboard.config.json` (gitignored). Do not put real hostnames into `switchboard.config.example.json`.
- Set `board.demo` to false when the file has their rows. Leave demo true only if they still want the sample published.
- Set `board.auth` to `gate` when something in front of the site requires sign-in. Otherwise leave `none` and keep the public-page warning.
- Every check uses an adapter id: `http`, `github-actions`, `heartbeat`, `ssh-uptime`, `json`, or `static`.
- Secrets are env var names only: `tokenEnv`, `keyEnv`, `knownHostsEnv`, `headerEnv`, matching `^[A-Z][A-Z0-9_]{0,80}$`. Never paste a token, a private key, or a password into the JSON, the README, a workflow log, or a browser.
- Validate with the schema before finishing. `npm run build` exits if the file is invalid.
- Run `npm run scrub`. If it prints a file and a rule, remove the match. Do not weaken the check.

## Secrets and the collector

- Document each env var in `.env.example` with an empty value and a one-line comment. Do not create a filled `.env` in git.
- For GitHub Actions, tell the operator the secret names to add. Map them in `.github/workflows/pages.yml` under the collect step `env`. The default `GITHUB_TOKEN` is already passed.
- If the config should not be committed, tell them to store the whole JSON as the Actions secret `OPSBOARD_CONFIG`. The workflow already writes that secret to `switchboard.config.json` before `npm run collect`.
- SSH: the known_hosts line for each host goes in the `SSH_KNOWN_HOSTS` secret (or the per-machine `knownHostsEnv`). The private key goes in `keyEnv`. Do not echo `ssh` stderr. Host keys must be pinned. `StrictHostKeyChecking` stays on.
- Heartbeats: give them a long random token per host, stored as `HEARTBEAT_TOKEN_<ID>`. Show the reporter command from the README using their id and their private URL. Recommend a systemd timer or the PowerShell script on a schedule of about five minutes.
- Recommend, in the notes you leave them, that SSH, the heartbeat receiver, and any admin URL live on a private network such as Tailscale or WireGuard, not on the public internet. A GitHub-hosted runner cannot reach that network unless they add that connectivity themselves. Prefer a self-hosted runner on the private network for SSH and file heartbeats.
- Recommend an auth gate in front of the Pages site (or whichever static host they use) whenever the board shows real hostnames.

## Deploy

- `npm test`, `npm run build`, `npm run scrub`, and `npm run redlines` must pass.
- Pages: they enable GitHub Pages with GitHub Actions as the source. Do not change repository visibility. Do not merge a pull request unless they asked.
- Confirm `dist/` contains every page, `css/switchboard.css`, `js/app.js`, `assets/portraits/robot-1.svg` through `robot-6.svg`, and `status.json`.
- Open the built overview, settings, agents, and one phone-width page in a browser. Demo off with their config should list their names. Demo on should still show only the sample.

## Done when

- `switchboard.config.json` validates and contains only their public structure plus env var names.
- The status workflow can collect without printing secrets.
- The README still describes the template; add a short "This install" note only if they ask.
- You list anything you could not wire (a host with no private path, a repo token they have not created) instead of faking a green check.
