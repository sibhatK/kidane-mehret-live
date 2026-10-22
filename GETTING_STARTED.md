# Mac mini: Getting Started

This guide starts the React dashboard, local Fastify agent, and optional
MediaMTX WebRTC preview. It does not configure OBS sources, change church network
settings, or start a YouTube broadcast for you.

## One-Command Setup

On a new Mac mini, first install and launch Docker Desktop using the steps below.
Then review the bootstrap script before running it:

```sh
curl -fsSLo /tmp/kidane-bootstrap-mac.sh \
   https://raw.githubusercontent.com/sibhatK/kidane-mehret-live/refs/heads/copilot/bootstrap-kidane-mehret-live/scripts/bootstrap-mac.sh
less /tmp/kidane-bootstrap-mac.sh
```

If the script looks right, run it:

```sh
bash /tmp/kidane-bootstrap-mac.sh
```

It installs/selects the project Node version with nvm, clones or fast-forwards
the clean project checkout, prompts for the Mac's Wi-Fi IP, creates ignored
local environment files, runs `npm ci`, lint, tests and build, starts MediaMTX,
and launches the dashboard and agent. It never starts or stops an OBS/YouTube
broadcast. If OBS settings are entered, password input is hidden and stored
only in ignored `.env`. It refuses to overwrite a checkout containing local
changes. The manual steps below explain each part and are the fallback if the
bootstrap cannot complete.

## What You Need

- A Mac mini on a trusted private network with the iPad.
- Docker Desktop for Mac, Git, Node.js `^20.19.0 || ^22.13.0 || >=24.0.0`,
  and npm 10+. Node 22 LTS is recommended.
- OBS configured and tested with the existing camera, church audio, YouTube
  destination, and local recording.
- OBS WebSocket enabled if using OBS control. A secondary WHIP output and
  MediaMTX are only needed for the optional browser video preview.

Keep the Mac mini and iPad on the same trusted LAN. Do not enable macOS Internet
Sharing or IP forwarding. Do not expose the development server, OBS WebSocket,
or MediaMTX ports to the public internet.

## 1. Install Docker Desktop

1. On the Mac mini, open **Apple menu → About This Mac** and note whether it
   uses Apple silicon or Intel.
2. Download the matching [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/).
3. Open the downloaded `.dmg` and drag Docker to **Applications**. For a
   user-local install with the image mounted at `/Volumes/Docker`, use:

   ```sh
   mkdir -p ~/Applications
   ditto /Volumes/Docker/Docker.app ~/Applications/Docker.app
   hdiutil detach /Volumes/Docker
   open ~/Applications/Docker.app
   ```

4. Accept Docker Desktop's first-run prompts and wait until Docker Desktop
   reports that its engine is running. Approve any privileged-helper prompt
   with a Mac administrator.
5. Open a new login terminal. Docker Desktop normally adds its CLI to
   `~/.docker/bin` in `~/.zprofile`. If `docker` is not found, run:

   ```sh
   source ~/.zprofile
   export PATH="$HOME/.docker/bin:$PATH"
   ```

6. Verify Docker and Compose:

   ```sh
   docker --version
   docker compose version
   docker info
   ```

```sh
cd /path/to/kidane-mehret-live
node --version
npm --version
```

Node must match the range in the root `package.json`. `nvm` is installed per
user and loaded by `~/.zshrc`; it updates `PATH` for each shell, so do not add a
static Node path manually. If `nvm --version` reports command not found, install
nvm with its [official installer](https://github.com/nvm-sh/nvm#installing-and-updating):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

Open a new Terminal or run `source ~/.zshrc`. Confirm that the file contains
the nvm initialization added by the installer:

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

Then select this repository's pinned version:

```sh
source ~/.zshrc
nvm --version
nvm install
nvm use
node --version
npm --version
```

The root `.nvmrc` selects Node 22. Install the locked dependencies:

```sh
npm ci
```

Run the project checks before using the app:

```sh
npm run lint
npm test
npm run build
```

## 3. Configure OBS

1. In OBS, open **Tools → WebSocket Server Settings**. Enable the server, set a
   strong password, and note the port (default `4455`).
2. Keep the existing YouTube and local recording configuration unchanged.
3. Verify the camera video and church audio in OBS before continuing. This app
   does not configure OBS sources, mixer routing, or physical camera PTZ.
4. If using the optional MediaMTX preview, install the macOS-compatible
   [OBS Multi-RTMP plugin](https://github.com/sorayuki/obs-multi-rtmp/releases).
   First check your OBS version in **OBS → About OBS Studio** and choose a
   compatible plugin release. The current release is `0.7.4.4`; its asset is
   a universal macOS package. Download and verify it:

   ```sh
   curl -fL "https://github.com/sorayuki/obs-multi-rtmp/releases/download/0.7.4.4/obs-multi-rtmp-0.7.4.4-macos-universal.pkg" \
     -o "$HOME/Downloads/obs-multi-rtmp-0.7.4.4-macos-universal.pkg"
   shasum -a 256 "$HOME/Downloads/obs-multi-rtmp-0.7.4.4-macos-universal.pkg"
   ```

   Confirm the output is exactly:

   ```text
   421177e452407bf2f31708bcc06237fd4636443cd2fb7fe56dea0455b34a623b
   ```

   If it differs, do not install the file. If it matches, open the package:

   ```sh
   open "$HOME/Downloads/obs-multi-rtmp-0.7.4.4-macos-universal.pkg"
   ```

   Follow the installer prompts, then reopen OBS. If Gatekeeper blocks the
   verified package, use **System Settings → Privacy & Security → Open Anyway**
   only after confirming the checksum. In OBS's top-level **Docks** menu, check
   for **Multiple RTMP Output**. If it is missing, confirm plugin/OBS version
   compatibility before proceeding.

   In the plugin, confirm the protocol selector offers **WebRTC (WHIP)**. Add
   a secondary WHIP output to `http://127.0.0.1:8889/live/whip`, which publishes
   the MediaMTX path `live`. Do not replace the existing YouTube output.

**Important:** the dashboard's **Start Livestream** and **End Broadcast** actions
control OBS's primary stream output. It may be your real YouTube stream. For a
preview-only check, start/stop only the secondary WHIP output in the OBS plugin;
do not press Start Livestream unless a real broadcast is intended and authorized.

## 4. Configure Local Environment

Find the Mac mini's current Wi-Fi IPv4 address in **System Settings → Wi-Fi →
Details → TCP/IP**. Use the same current address for Docker's advertised WebRTC
host and the iPad's dashboard URL. Do not assume an old DHCP address is still
valid. A router DHCP reservation is recommended for a persistent address.

Create or edit the ignored root `.env` file:

```sh
nano .env
```

Add the OBS settings (replace the password locally):

```dotenv
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
OBS_WEBSOCKET_PASSWORD=<your OBS WebSocket password>
```

If OBS runs on a different computer, use its reachable LAN address instead of
`127.0.0.1`. Keep this password in the ignored `.env`; never commit or share it.
The agent loads the root `.env` at startup. Without both OBS variables, the app
runs in simulation mode.

For the optional MediaMTX preview, add the Mac's current Wi-Fi address to the
same root `.env`:

```dotenv
MEDIAMTX_LAN_IP=<Mac mini Wi-Fi IPv4 address>
```

Create the ignored Vite config `apps/dashboard/.env.local`:

```sh
cat > apps/dashboard/.env.local <<'EOF'
VITE_MEDIAMTX_WEBRTC_URL=http://<Mac mini Wi-Fi IPv4 address>:8889/live
EOF
```

Replace the placeholder in the file with the same current Wi-Fi address. Keep
both environment files local and out of source control.

## 5. Start MediaMTX (Optional Preview)

Skip this section if you only need OBS status, controls, and audio meters. Open
**Terminal 1**, go to the repository root, and start the local preview server:

```sh
cd /path/to/kidane-mehret-live
npm run mediamtx:start
docker compose ps
```

Use `npm run mediamtx:stop` to stop the service and release its ports.
The Compose file reads `MEDIAMTX_LAN_IP` from root `.env`. It publishes WebRTC
signaling on TCP `8889` and ICE media on UDP `8189`. Check startup logs with:

```sh
docker compose logs --tail=100 mediamtx
```

In OBS, start only the secondary WHIP output for the `live` path. The dashboard
preview should appear when MediaMTX receives that feed. It is browser WebRTC
video, separate from OBS WebSocket status; local startup does not validate iPad
connectivity or latency.

## 6. Start the Dashboard and Agent

Open **Terminal 2** at the repository root:

```sh
cd /path/to/kidane-mehret-live
npm run dev
```

Keep it running. Open `http://localhost:5173` on the Mac mini. On the iPad, open
`http://<Mac mini Wi-Fi IPv4 address>:5173`. If macOS asks, allow local incoming
connections on the trusted network.

## 7. Verify Safely

1. Confirm the dashboard shows **OBS CONTROL** and OBS is connected.
2. Confirm OBS's scene preview and audio meters directly in OBS. The app shows
   meter levels only; it does not play audio. Meter names are not yet mapped
   specifically to the church mixer.
3. If MediaMTX is enabled, confirm OBS's secondary WHIP output is publishing
   and the dashboard preview appears. A missing preview usually means the
   output, IP address, container, or LAN firewall needs checking.
4. Confirm the OBS primary output destination before using **Start Livestream**.
   Verify delivery in YouTube Studio. The app does not configure YouTube or
   manage local recording.
5. The dashboard has no user authentication; use it only on a trusted private
   network. Browser confirmation is not access control.

Builds/tests do not prove hardware operation, iPad WebRTC playback, low latency,
YouTube delivery, recording, or PTZ movement. Confirm each at the church.

## Stop and Roll Back

- Stop the dashboard and agent with `Ctrl+C` in Terminal 2.
- Stop MediaMTX with `docker compose down` in Terminal 1.
- To roll back preview only, stop the secondary WHIP output in OBS, then run
  `docker compose down`. The existing YouTube and recording outputs remain
  unchanged.
- Do not change camera/network addressing as part of this guide. Any such
  change requires supervised maintenance, a backup, and rollback instructions.

## Troubleshooting

- **`docker: command not found`:** open a new login terminal, run `source ~/.zprofile`,
  then `export PATH="$HOME/.docker/bin:$PATH"` and retry `docker info`.
- **MediaMTX container exits:** check `docker compose ps` and
  `docker compose logs --tail=100 mediamtx`; confirm `MEDIAMTX_LAN_IP` is set
  correctly in root `.env`.
- **Dashboard says simulation:** confirm both OBS WebSocket variables are set
  in root `.env`, then restart `npm run dev`.
- **OBS shows disconnected:** verify OBS WebSocket is enabled, the host/port and
  password are correct, and the local firewall permits the connection.
- **Preview unavailable on iPad:** confirm the secondary WHIP output is active,
  both devices use the same reachable LAN, the preview URL uses the Mac's
  current Wi-Fi address, and TCP `8889`/UDP `8189` are not blocked by firewall
  or Wi-Fi client isolation.
- **OBS says WHIP is publishing but MediaMTX shows no stream:** verify the
  output protocol is **WebRTC (WHIP)**, the endpoint ends in `/live/whip`, and
  the output publishes to path `live`. If the protocol option is missing,
  update Multi-RTMP and restart OBS.
- **YouTube or recording changes after enabling preview:** stop the secondary
  output and restore the existing OBS primary output configuration. Recheck
  YouTube and recording independently; do not troubleshoot during a service.
- **Audio meter stays at `−60 dB`:** confirm the OBS input is active and its
  meter moves in OBS's Audio Mixer. No dashboard audio playback is expected.
