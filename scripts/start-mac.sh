#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[FAIL] Startup stopped: %s\nNext step: %s\n' "$1" \
    "${2:-Fix the issue above, then run npm run live again.}" >&2
  exit 1
}

case "${1:-}" in
  ''|--check) ;;
  *) fail "Usage: bash scripts/start-mac.sh [--check]" ;;
esac

[[ "$(uname -s)" == "Darwin" ]] || fail "This startup command supports macOS only."

local_name="$(scutil --get LocalHostName | tr '[:upper:]' '[:lower:]')"
[[ "$local_name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "Could not read a valid Mac LocalHostName."
wifi_device="$(networksetup -listallhardwareports | awk '
  /Hardware Port: Wi-Fi/ {
    getline
    sub(/^Device: /, "")
    print
    exit
  }
')"
lan_ip="${MEDIAMTX_LAN_IP:-}"
if [[ -z "$lan_ip" && -n "$wifi_device" ]]; then
  lan_ip="$(ipconfig getifaddr "$wifi_device" 2>/dev/null || true)"
fi
[[ -n "$lan_ip" ]] || fail "No Wi-Fi IPv4 address found." \
  "Open System Settings > Wi-Fi and connect to the same trusted Wi-Fi as the iPad. Then run npm run live again. For Ethernet, explicitly set MEDIAMTX_LAN_IP."
printf '%s\n' "$lan_ip" | awk -F. '
  NF != 4 { exit 1 }
  { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1 }
' || fail "The detected LAN IPv4 address is invalid."
case "$lan_ip" in
  0.*|127.*|169.254.*) fail "The detected IP is not a usable LAN address: $lan_ip" ;;
esac

export MEDIAMTX_LAN_IP="$lan_ip"
export VITE_MEDIAMTX_WEBRTC_URL="http://${local_name}.local:8889/live"
export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${local_name}.local"

printf 'Wi-Fi/LAN IP: %s\nSaved iPad link: http://%s.local:5173\nPreview: %s\n' \
  "$lan_ip" "$local_name" "$VITE_MEDIAMTX_WEBRTC_URL"
[[ "${1:-}" != "--check" ]] || exit 0

if ! command -v npm >/dev/null 2>&1; then
  export PATH="$HOME/.local/kidane-node/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ ! -s "$NVM_DIR/nvm.sh" ]] || . "$NVM_DIR/nvm.sh"
fi
command -v npm >/dev/null 2>&1 || fail "Node/npm is missing. Complete the initial setup first."
export PATH="$HOME/.docker/bin:$HOME/Applications/Docker.app/Contents/Resources/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

command -v lsof >/dev/null 2>&1 || fail "The port-check tool lsof is unavailable." \
  "Open a standard macOS Terminal and retry. Do not skip the port checks or stop unknown processes."
for port in 5173 3001; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $port is already in use. No preview services were restarted." \
      "In the terminal running the existing app, press Control+C. Then run npm run live again. Do not close OBS."
  fi
done

backend="${MEDIAMTX_BACKEND:-auto}"
if [[ "$backend" == "auto" ]]; then
  if [[ -f "$HOME/.local/state/kidane-mehret-live/mediamtx.pid" ]]; then
    backend="native"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    backend="docker"
  else
    backend="native"
  fi
fi
case "$backend" in
  native|docker) export MEDIAMTX_BACKEND="$backend" ;;
  *) fail "MEDIAMTX_BACKEND must be auto, native, or docker." ;;
esac

cd "$ROOT_DIR"
printf 'Refreshing the local preview service (%s). OBS/YouTube outputs are not controlled.\n' "$backend"
bash scripts/mediamtx.sh stop || fail "Could not stop the old preview service." \
  "Read its log before retrying: npm run mediamtx:native:logs (native) or docker compose logs --tail=30 mediamtx (Docker). Do not close OBS."
bash scripts/mediamtx.sh start || fail "Could not start the preview service." \
  "Check the preview log for a port conflict or download error, then retry npm run live."
preview_ready=false
for ((attempt = 1; attempt <= 30; attempt++)); do
  if curl --noproxy '*' --max-time 1 --fail --silent http://127.0.0.1:8889/live >/dev/null; then
    preview_ready=true
    break
  fi
  sleep 0.2
done
[[ "$preview_ready" == true ]] || fail "MediaMTX did not become ready." \
  "Read the preview log: npm run mediamtx:native:logs (native) or docker compose logs --tail=30 mediamtx (Docker). Fix its first error, then retry npm run live."

printf 'Open OBS and manually start only Local Preview. Keep this terminal open.\n'
exec node --import tsx scripts/live.ts