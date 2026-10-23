#!/bin/bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$ROOT_DIR/Start Kidane Mehret.command"
if [[ "${BASH_SOURCE[0]}" != "$SELF" ]]; then
  exec /bin/bash "$SELF"
fi

pause_on_failure() {
  if [[ -t 0 ]]; then
    printf '\nPress Return to close this window.\n'
    IFS= read -r answer || true
  fi
}

[[ "$(uname -s)" == "Darwin" ]] || {
  printf '[FAIL] This launcher supports macOS only.\n'
  pause_on_failure
  exit 1
}
cd "$ROOT_DIR" || exit 1
LOCK_DIR="$ROOT_DIR/.cache/mac-launcher.lock"
mkdir -p "$ROOT_DIR/.cache" || exit 1

launcher_running() {
  [[ -r "$LOCK_DIR/pid" ]] || return 1
  local pid command
  pid="$(<"$LOCK_DIR/pid")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$SELF"* ]]
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if launcher_running || [[ ! -f "$LOCK_DIR/pid" ]]; then
    printf 'The app is already running or starting in another window.\n'
    if bash "$ROOT_DIR/scripts/start-mac.sh" --open-existing; then
      exit 0
    fi
    printf 'Next step: check the first launcher window. Do not start another copy while it is starting.\n'
    pause_on_failure
    exit 1
  fi
  rm -f "$LOCK_DIR/pid"
  if ! rmdir "$LOCK_DIR" || ! mkdir "$LOCK_DIR"; then
    printf '[FAIL] Could not acquire the launcher lock.\nNext step: check the first launcher window before trying again.\n'
    pause_on_failure
    exit 1
  fi
fi

printf '%s\n' "$$" >"$LOCK_DIR/pid"
cleanup() {
  if [[ -r "$LOCK_DIR/pid" && "$(<"$LOCK_DIR/pid")" == "$$" ]]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT
startup_pid=""
stop_launcher() {
  local exit_code="$1"
  if [[ -n "$startup_pid" ]]; then
    kill -TERM "$startup_pid" 2>/dev/null || true
    wait "$startup_pid" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap 'stop_launcher 130' INT
trap 'stop_launcher 143' TERM
trap 'stop_launcher 129' HUP

printf 'Kidane Mehret Live\nKeep this Terminal window open while using the dashboard.\nNo broadcast or recording starts automatically.\n\n'
bash "$ROOT_DIR/scripts/start-mac.sh" --open-browser &
startup_pid=$!
if wait "$startup_pid"; then
  startup_pid=""
  exit 0
else
  exit_code=$?
  startup_pid=""
  if [[ "$exit_code" != 130 && "$exit_code" != 143 ]]; then
    printf '\n[FAIL] Startup did not finish.\nNext step: follow the first error above, then double-click this launcher again.\n'
    pause_on_failure
  fi
  exit "$exit_code"
fi