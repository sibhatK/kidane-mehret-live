# Mac mini: get started

This guide starts the dashboard, local Node.js agent, and MediaMTX preview on a
Mac mini. It does not install OBS settings or start a YouTube broadcast for you.

## Before you start

- Install and launch Docker Desktop for Mac. Wait until it says Docker is
  running.
- Install Git and a supported Node.js/npm version.
- Configure OBS on this Mac and confirm its existing YouTube and recording
  settings are correct before proceeding.
- Keep the Mac and iPad on a trusted private network. Do not enable macOS
  Internet Sharing or IP forwarding.

Check the tools and locate your checkout:

```sh
open -a Docker
cd /path/to/kidane-mehret-live
node --version
npm --version
docker info
npm ci
```

Node must satisfy the range in `package.json` (for example, Node 22.13 or later
within 22.x). If you already use nvm, run `nvm install` and `nvm use` from the
project folder first; `.nvmrc` selects the repository's Node 22 version.
Replace `/path/to/kidane-mehret-live` with the actual checkout directory.

## Configure OBS once

1. In OBS, open **Tools → WebSocket Server Settings**, enable the server, set a
   password, and note the port (default `4455`).
2. Keep the existing YouTube stream and local recording configuration.
3. To publish the preview too, install the macOS OBS Multi-RTMP plugin from
   [its releases page](https://github.com/sorayuki/obs-multi-rtmp/releases).
   Add a secondary **WebRTC (WHIP)** target:
   `http://127.0.0.1:8889/live/whip`. Do not replace the YouTube output.
4. Confirm OBS sees the camera video and audio. The application does not
   configure OBS sources, audio routing, or the plugin.

## Start the services

Use **Terminal 1** for MediaMTX. In the project root, get the Mac's current
Wi-Fi address, review it, replace the example below, then start the container:

```sh
cd /path/to/kidane-mehret-live
networksetup -getinfo Wi-Fi
export MEDIAMTX_LAN_IP=192.168.1.206
docker compose up -d
docker compose ps
```

Replace `192.168.1.206` with the current Wi-Fi IP shown by `networksetup`—do
not assume this example is still correct. MediaMTX exposes WebRTC on TCP 8889
and UDP 8189. Leave this terminal available; stop the container later with
`docker compose down`.

Use **Terminal 2** to configure the local agent and dashboard. In the project
root, create the ignored root `.env` file:

```sh
cd /path/to/kidane-mehret-live
nano .env
```

Enter the following, replacing the password with the OBS WebSocket password
you configured above, then save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`):

```dotenv
OBS_WEBSOCKET_URL=ws://127.0.0.1:4455
OBS_WEBSOCKET_PASSWORD=replace-with-your-OBS-password
```

Create the dashboard's ignored local preview configuration. Use the same
current Wi-Fi IP as `MEDIAMTX_LAN_IP`. Since this is a new terminal, export it
again here:

```sh
export MEDIAMTX_LAN_IP=192.168.1.206
printf 'VITE_MEDIAMTX_WEBRTC_URL=http://%s:8889/live\n' "$MEDIAMTX_LAN_IP" \
  > apps/dashboard/.env.local
```

Again, replace the example address with the Mac's current Wi-Fi IP.

Start the Node.js agent and Vite dashboard together:

```sh
npm run dev
```

Keep Terminal 2 running. Open `http://localhost:5173` on the Mac. On the iPad,
open `http://<Mac-Wi-Fi-IP>:5173` (replace the placeholder with the same
current Wi-Fi IP). If macOS asks, allow incoming connections for the local
development server on the trusted network.

The dashboard uses OBS mode when both `OBS_WEBSOCKET_URL` and
`OBS_WEBSOCKET_PASSWORD` are set. Without them, it stays in simulation mode.
The MediaMTX preview appears when the OBS WHIP target is publishing to `live`;
otherwise the player reports that the stream is unavailable.

## Stop and restart

- Stop the app: press `Ctrl+C` in Terminal 2.
- Stop MediaMTX: in Terminal 1, run `docker compose down`.
- Restart: start MediaMTX again, then run `npm run dev`.

Keep `.env` and `apps/dashboard/.env.local` local; never commit OBS passwords.
The dashboard's Start Livestream action starts the configured OBS stream output.
Verify the OBS destination before using it; YouTube delivery and local
recording must be checked in OBS/YouTube Studio. The app does not start or
manage local recording.
