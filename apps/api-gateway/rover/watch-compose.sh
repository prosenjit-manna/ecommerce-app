#!/bin/sh
# Composes the supergraph, then recomposes whenever supergraph.yaml or a subgraph schema changes.
# Polls instead of using inotify: file events from a macOS host don't reliably reach the Podman VM.
set -u

CONFIG=/workspace/apps/api-gateway/supergraph.yaml
SCHEMAS='/workspace/services/*/src/graphql/schema.graphql'
OUT=/supergraph/supergraph.graphql
TMP=/tmp/supergraph.graphql
INTERVAL=${POLL_INTERVAL:-2}

# PID 1 ignores SIGTERM unless it traps it; without this `compose down` waits 10s.
trap 'exit 0' TERM INT

fingerprint() {
  # $SCHEMAS is unquoted on purpose so the glob expands.
  # shellcheck disable=SC2086
  cat "$CONFIG" $SCHEMAS 2>/dev/null | sha256sum
}

compose() {
  if rover supergraph compose --config "$CONFIG" --output "$TMP" --skip-update; then
    # Overwrite in place (not mv) so the router's file watcher sees a change on the same file.
    cp "$TMP" "$OUT"
    echo "[supergraph] composed at $(date -u +%H:%M:%SZ)"
  else
    echo "[supergraph] composition failed; the router keeps the last good supergraph" >&2
  fi
}

last=""
while :; do
  current=$(fingerprint)
  if [ "$current" != "$last" ]; then
    last=$current
    compose
  fi
  sleep "$INTERVAL"
done
