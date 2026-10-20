# Heartbeats

The collector reads `heartbeats/<id>.json` when a check uses `options.file`. Those JSON files are gitignored. The dev server writes them when a reporter POSTs to `/api/heartbeat` with the matching bearer token.

Do not commit live heartbeat files. They can contain hostnames.
