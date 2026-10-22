#!/usr/bin/env bash
set -euo pipefail

readonly REPOSITORY_URL="https://github.com/sibhatK/kidane-mehret-live.git"
readonly REPOSITORY_BRANCH="copilot/bootstrap-kidane-mehret-live"
readonly NVM_VERSION="v0.40.8"
INSTALL_DIR="${KIDANE_REPO_DIR:-$HOME/kidane-mehret-live}"

fail() {
  printf 'Setup stopped: %s\n' "$1" >&2
  exit 1
}

version_is_less_than() {
  awk -v actual="$1" -v required="$2" 'BEGIN {
    split(actual, a, /[.]/)
    split(required, r, /[.]/)
    for (i = 1; i <= 3; i++) {
      actual_part = a[i] + 0
      required_part = r[i] + 0
      if (actual_part < required_part) exit 0
      if (actual_part > required_part) exit 1
    }
    exit 1
  }'
}

check_docker_macos_version() {
  local app_path="$1"
  local minimum_version current_version
  minimum_version="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' \
    "$app_path/Contents/Info.plist" 2>/dev/null || true)"
  current_version="$(sw_vers -productVersion)"

  if [[ -n "$minimum_version" ]] &&
    version_is_less_than "$current_version" "$minimum_version"; then
    printf 'Docker Desktop requires macOS %s; this Mac has macOS %s. Using native MediaMTX instead.\n' \
      "$minimum_version" "$current_version"
    return 1
  fi
}

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  curl -fsSL <bootstrap-script-url> | bash

Optional:
  KIDANE_REPO_DIR=/path/to/checkout
  MEDIAMTX_LAN_IP=192.168.x.x

If Docker Desktop is compatible, the script can install it under ~/Applications.
On older macOS versions or when Docker is incompatible, it uses the official,
checksum-verified native MediaMTX binary instead. The script never starts or
stops an OBS/YouTube broadcast. OBS credentials, if entered, are read silently
from the terminal and stored only in the ignored local .env file.
EOF
  exit 0
fi

[[ "$(uname -s)" == "Darwin" ]] || fail "This bootstrap script supports macOS only."

for required_command in curl git awk networksetup ipconfig uname hdiutil ditto open sw_vers; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "Required command '$required_command' is missing."
done

mediamtx_backend="docker"
docker_app=""
for candidate in "$HOME/Applications/Docker.app" "/Applications/Docker.app"; do
  if [[ -d "$candidate" ]]; then
    docker_app="$candidate"
    break
  fi
done

if [[ -z "$docker_app" ]] && version_is_less_than "$(sw_vers -productVersion)" "14.0"; then
  printf 'macOS %s is too old for current Docker Desktop; using native MediaMTX.\n' \
    "$(sw_vers -productVersion)"
  mediamtx_backend="native"
fi

if [[ "$mediamtx_backend" == "docker" && -z "$docker_app" ]]; then
  case "$(uname -m)" in
    arm64) docker_dmg_url="https://desktop.docker.com/mac/main/arm64/Docker.dmg" ;;
    x86_64) docker_dmg_url="https://desktop.docker.com/mac/main/amd64/Docker.dmg" ;;
    *) fail "Unsupported Mac architecture: $(uname -m)" ;;
  esac

  docker_tmp="$(mktemp -d)"
  docker_mount="$docker_tmp/mount"
  mkdir -p "$docker_mount"
  if ! curl -fL "$docker_dmg_url" -o "$docker_tmp/Docker.dmg"; then
    rm -rf "$docker_tmp"
    fail "Could not download the official Docker Desktop image."
  fi
  if ! hdiutil attach "$docker_tmp/Docker.dmg" -nobrowse -mountpoint "$docker_mount" >/dev/null; then
    rm -rf "$docker_tmp"
    fail "Could not mount the Docker Desktop disk image."
  fi
  if [[ ! -d "$docker_mount/Docker.app" ]]; then
    hdiutil detach "$docker_mount" >/dev/null 2>&1 || true
    rm -rf "$docker_tmp"
    fail "The downloaded disk image did not contain Docker.app."
  fi
  minimum_version="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' \
    "$docker_mount/Docker.app/Contents/Info.plist" 2>/dev/null || true)"
  if [[ -n "$minimum_version" ]] &&
    version_is_less_than "$(sw_vers -productVersion)" "$minimum_version"; then
    printf 'Docker Desktop requires macOS %s; this Mac has macOS %s. Using native MediaMTX.\n' \
      "$minimum_version" "$(sw_vers -productVersion)"
    mediamtx_backend="native"
  else
    mkdir -p "$HOME/Applications"
    if ! ditto "$docker_mount/Docker.app" "$HOME/Applications/Docker.app"; then
      hdiutil detach "$docker_mount" >/dev/null 2>&1 || true
      rm -rf "$docker_tmp"
      fail "Could not copy Docker Desktop into ~/Applications."
    fi
    docker_app="$HOME/Applications/Docker.app"
    printf 'Installed Docker Desktop at %s\n' "$docker_app"
  fi
  hdiutil detach "$docker_mount" >/dev/null 2>&1 || true
  rm -rf "$docker_tmp"
fi

if [[ "$mediamtx_backend" == "docker" ]] &&
  ! check_docker_macos_version "$docker_app"; then
  mediamtx_backend="native"
fi

if [[ "$mediamtx_backend" == "docker" ]]; then
  export PATH="$docker_app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"
  command -v docker >/dev/null 2>&1 || fail "Docker CLI was not found inside Docker Desktop."

  open "$docker_app" || fail "Could not launch Docker Desktop."
  docker_ready=false
  printf 'Waiting for Docker Desktop. Approve any macOS helper prompt if shown.\n'
  for ((attempt = 1; attempt <= 60; attempt++)); do
    if docker info >/dev/null 2>&1; then
      docker_ready=true
      break
    fi
    sleep 3
  done

  if [[ "$docker_ready" != true ]]; then
    printf 'Docker Desktop did not become ready; using native MediaMTX.\n'
    mediamtx_backend="native"
  fi
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  nvm_installer="$(mktemp)"
  trap 'rm -f "$nvm_installer"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" \
    -o "$nvm_installer"
  PROFILE="$HOME/.zshrc" bash "$nvm_installer"
  rm -f "$nvm_installer"
  trap - EXIT
fi
[[ -s "$NVM_DIR/nvm.sh" ]] || fail "nvm installation did not create $NVM_DIR/nvm.sh"
# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"

if [[ -e "$INSTALL_DIR" ]]; then
  git -C "$INSTALL_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
    fail "Install directory exists but is not a Git checkout: $INSTALL_DIR (set KIDANE_REPO_DIR to another path)."

  remote_url="$(git -C "$INSTALL_DIR" remote get-url origin)"
  case "$remote_url" in
    *sibhatK/kidane-mehret-live.git|*sibhatK/kidane-mehret-live) ;;
    *) fail "Existing checkout has a different origin: $remote_url" ;;
  esac

  [[ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ]] ||
    fail "Existing checkout has local changes. Commit/stash them or set KIDANE_REPO_DIR to a new path."
  git -C "$INSTALL_DIR" fetch origin "$REPOSITORY_BRANCH"
  git -C "$INSTALL_DIR" checkout "$REPOSITORY_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REPOSITORY_BRANCH"
else
  git clone --single-branch --branch "$REPOSITORY_BRANCH" \
    "$REPOSITORY_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
nvm install
nvm use

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

if [[ -z "$lan_ip" ]]; then
  [[ -r /dev/tty ]] || fail "Could not detect Wi-Fi IPv4 address and no interactive terminal is available. Set MEDIAMTX_LAN_IP and rerun."
  printf 'Enter the Mac mini Wi-Fi IPv4 address: ' >/dev/tty
  IFS= read -r lan_ip </dev/tty
else
  printf 'Detected Mac Wi-Fi IPv4 address: %s\n' "$lan_ip"
  if [[ -r /dev/tty ]]; then
    printf 'Press Enter to use it, or type the current Wi-Fi IP: ' >/dev/tty
    IFS= read -r confirmed_ip </dev/tty
    [[ -z "$confirmed_ip" ]] || lan_ip="$confirmed_ip"
  fi
fi

printf '%s\n' "$lan_ip" | awk -F. '
  NF != 4 { exit 1 }
  { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1 }
' || fail "Invalid IPv4 address: $lan_ip"

upsert_env() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local temp_file escaped_value

  mkdir -p "$(dirname "$env_file")"
  temp_file="$(mktemp "${env_file}.XXXXXX")"
  if [[ -f "$env_file" ]]; then
    awk -v key="$key" 'index($0, key "=") != 1 { print }' "$env_file" >"$temp_file"
  fi
  escaped_value="${value//\\/\\\\}"
  escaped_value="${escaped_value//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$escaped_value" >>"$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$env_file"
}

upsert_env "$INSTALL_DIR/.env" MEDIAMTX_LAN_IP "$lan_ip"
upsert_env "$INSTALL_DIR/apps/dashboard/.env.local" \
  VITE_MEDIAMTX_WEBRTC_URL "http://${lan_ip}:8889/live"

has_env_key() {
  awk -F= -v key="$2" '$1 == key { found = 1 } END { exit !found }' "$1"
}

if has_env_key "$INSTALL_DIR/.env" OBS_WEBSOCKET_URL &&
  ! has_env_key "$INSTALL_DIR/.env" OBS_WEBSOCKET_PASSWORD; then
  fail "OBS_WEBSOCKET_URL exists without OBS_WEBSOCKET_PASSWORD. Add the password locally or remove the URL from .env."
fi

if ! has_env_key "$INSTALL_DIR/.env" OBS_WEBSOCKET_URL &&
  ! has_env_key "$INSTALL_DIR/.env" OBS_WEBSOCKET_PASSWORD &&
  [[ -r /dev/tty ]]; then
  printf 'Enable OBS WebSocket mode now? [y/N] ' >/dev/tty
  IFS= read -r configure_obs </dev/tty
  case "$configure_obs" in
    [Yy]*)
      printf 'OBS WebSocket URL [ws://127.0.0.1:4455]: ' >/dev/tty
      IFS= read -r obs_url </dev/tty
      obs_url="${obs_url:-ws://127.0.0.1:4455}"
      printf 'OBS WebSocket password (input hidden): ' >/dev/tty
      IFS= read -r -s obs_password </dev/tty
      printf '\n' >/dev/tty
      [[ -n "$obs_password" ]] || fail "OBS password cannot be empty."
      upsert_env "$INSTALL_DIR/.env" OBS_WEBSOCKET_URL "$obs_url"
      upsert_env "$INSTALL_DIR/.env" OBS_WEBSOCKET_PASSWORD "$obs_password"
      unset obs_password
      ;;
    *) printf 'Leaving the app in simulation mode.\n' ;;
  esac
fi

npm ci
npm run lint
npm test
npm run build
MEDIAMTX_BACKEND="$mediamtx_backend" npm run mediamtx:start

cat <<EOF

Setup is complete. MediaMTX is running on the trusted LAN.
Install/configure the OBS Multi-RTMP plugin separately, then add a secondary
WebRTC (WHIP) output to http://127.0.0.1:8889/live/whip. Keep the existing
YouTube output unchanged. The app will now start; it will not start a broadcast.
EOF

exec npm run dev
