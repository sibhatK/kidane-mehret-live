#!/usr/bin/env bash
set -euo pipefail

readonly VERSION="1.21.2"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DATA_DIR="$HOME/.local/share/kidane-mehret-live/mediamtx-$VERSION"
readonly STATE_DIR="$HOME/.local/state/kidane-mehret-live"
readonly BINARY="$DATA_DIR/mediamtx"
readonly CONFIG="$DATA_DIR/mediamtx.yml"
readonly PID_FILE="$STATE_DIR/mediamtx.pid"
readonly LOG_FILE="$STATE_DIR/mediamtx.log"

fail() {
  printf 'MediaMTX: %s\n' "$1" >&2
  exit 1
}

load_lan_ip() {
  local ip="${MEDIAMTX_LAN_IP:-}"
  if [[ -z "$ip" && -f "$ROOT_DIR/.env" ]]; then
    ip="$(awk -F= '$1 == "MEDIAMTX_LAN_IP" { value = $2; gsub(/^"|"$/, "", value); print value; exit }' "$ROOT_DIR/.env")"
  fi
  [[ -n "$ip" ]] || fail "Set MEDIAMTX_LAN_IP in the root .env file before starting the preview."
  printf '%s\n' "$ip" | awk -F. 'NF != 4 { exit 1 } { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1 }' ||
    fail "MEDIAMTX_LAN_IP is not a valid IPv4 address."
  printf '%s\n' "$ip"
}

process_is_running() {
  [[ -r "$PID_FILE" ]] || return 1
  local pid command
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == "$BINARY" || "$command" == "$BINARY "* ]]
}

install_binary() {
  local architecture archive checksum temporary_dir
  case "$(uname -m)" in
    arm64)
      architecture="arm64"
      checksum="7d0d0c5c11527cbd10bde1c3d728864eb0334a9b653566cd73c0259750cbf093"
      ;;
    x86_64)
      architecture="amd64"
      checksum="87a00062b6a588aa1158f875504a3b56c80d62e2611dc450b83d0534e1b49198"
      ;;
    *) fail "Unsupported Mac architecture: $(uname -m)" ;;
  esac

  archive="mediamtx_v${VERSION}_darwin_${architecture}.tar.gz"
  temporary_dir="$(mktemp -d)"
  if ! curl -fL "https://github.com/bluenviron/mediamtx/releases/download/v${VERSION}/${archive}" -o "$temporary_dir/$archive"; then
    rm -rf "$temporary_dir"
    fail "Could not download the official MediaMTX archive."
  fi
  if ! printf '%s  %s\n' "$checksum" "$temporary_dir/$archive" | shasum -a 256 -c -; then
    rm -rf "$temporary_dir"
    fail "MediaMTX archive checksum did not match the official release."
  fi
  if ! tar -xzf "$temporary_dir/$archive" -C "$temporary_dir"; then
    rm -rf "$temporary_dir"
    fail "Could not extract the MediaMTX archive."
  fi
  [[ -x "$temporary_dir/mediamtx" && -f "$temporary_dir/mediamtx.yml" ]] || {
    rm -rf "$temporary_dir"
    fail "The MediaMTX archive is missing its executable or configuration."
  }

  mkdir -p "$DATA_DIR"
  install -m 755 "$temporary_dir/mediamtx" "$BINARY"
  install -m 644 "$temporary_dir/mediamtx.yml" "$CONFIG"
  rm -rf "$temporary_dir"
}

case "${1:-start}" in
  status)
    process_is_running
    ;;
  start)
    [[ "$(uname -s)" == "Darwin" ]] || fail "The native runner supports macOS only."
    lan_ip="$(load_lan_ip)"
    if process_is_running; then
      printf 'MediaMTX is already running (PID %s).\n' "$(<"$PID_FILE")"
      exit 0
    fi
    mkdir -p "$STATE_DIR"
    rm -f "$PID_FILE"
    [[ -x "$BINARY" && -f "$CONFIG" ]] || install_binary
    nohup env MTX_RTSP=no MTX_RTMP=no MTX_HLS=no MTX_WEBRTC=yes \
      MTX_SRT=no MTX_MOQ=no MTX_WEBRTCADDITIONALHOSTS="$lan_ip" \
      "$BINARY" "$CONFIG" >"$LOG_FILE" 2>&1 </dev/null &
    printf '%s\n' "$!" >"$PID_FILE"
    printf 'Started native MediaMTX (PID %s). Log: %s\n' "$(<"$PID_FILE")" "$LOG_FILE"
    ;;
  stop)
    if process_is_running; then
      pid="$(<"$PID_FILE")"
      kill "$pid"
      for ((attempt = 1; attempt <= 50; attempt++)); do
        if ! process_is_running; then
          break
        fi
        sleep 0.1
      done
      if process_is_running; then
        fail "MediaMTX did not stop within 5 seconds. Check its log before restarting."
      fi
      printf 'Stopped native MediaMTX (PID %s).\n' "$pid"
    else
      printf 'Native MediaMTX is not running.\n'
    fi
    rm -f "$PID_FILE"
    ;;
  logs)
    [[ -f "$LOG_FILE" ]] || fail "No native MediaMTX log exists yet."
    tail -f "$LOG_FILE"
    ;;
  *) fail "Usage: $0 {start|stop|status|logs}" ;;
esac