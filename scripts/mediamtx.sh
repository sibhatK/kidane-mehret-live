#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-start}"
backend="${MEDIAMTX_BACKEND:-auto}"

if [[ "$backend" == "native" ]]; then
  exec bash "$ROOT_DIR/scripts/mediamtx-native.sh" "$action"
fi

if [[ "$backend" == "docker" ]]; then
  if [[ "$action" == "start" ]]; then
    exec docker compose -f "$ROOT_DIR/compose.yaml" --project-directory "$ROOT_DIR" up -d mediamtx
  fi
  exec docker compose -f "$ROOT_DIR/compose.yaml" --project-directory "$ROOT_DIR" down
fi

if [[ -f "$HOME/.local/state/kidane-mehret-live/mediamtx.pid" ]]; then
  exec bash "$ROOT_DIR/scripts/mediamtx-native.sh" "$action"
fi

if [[ "$action" == "start" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  exec docker compose -f "$ROOT_DIR/compose.yaml" --project-directory "$ROOT_DIR" up -d mediamtx
fi

if [[ "$action" == "stop" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 &&
  docker compose -f "$ROOT_DIR/compose.yaml" --project-directory "$ROOT_DIR" ps -q mediamtx | grep -q .; then
  exec docker compose -f "$ROOT_DIR/compose.yaml" --project-directory "$ROOT_DIR" down
fi

exec bash "$ROOT_DIR/scripts/mediamtx-native.sh" "$action"