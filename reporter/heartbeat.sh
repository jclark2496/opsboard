#!/bin/sh
# Run the heartbeat reporter. Export OPSBOARD_HEARTBEAT_URL, OPSBOARD_HEARTBEAT_TOKEN, and OPSBOARD_HEARTBEAT_ID first.
set -eu
cd "$(dirname "$0")/.."
exec node reporter/heartbeat.mjs "$@"
