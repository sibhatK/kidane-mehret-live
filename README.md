# Kidane Mehret Live

## Project overview

Kidane Mehret Live is a simple livestream control dashboard for Kidane Mehret
Eritrean Ge'ez Rite Church in Atlanta. The goal is to help volunteers check
equipment health, prepare, start, monitor, and end one YouTube livestream from
an iPad without operating OBS directly.

## Architecture and equipment connections

```text
PTZOptics Move 4K ── Ethernet ──┐
                                Mac mini (OBS + Node.js/TypeScript backend)
Church audio mixer ─────────────┘           │
                                            └── Church Wi-Fi / YouTube
iPad (React/Vite dashboard) ── church Wi-Fi ── Mac mini

Camera HDMI ── existing connection to church TV
Camera power ── existing TRENDnet PoE injector
```

The camera is one PTZOptics Move 4K, model PT30X-4K-WH-G3, with 30× optical
zoom. The camera's PoE and HDMI-to-TV connections must be preserved. The Mac
mini is intended to run OBS and the local backend; the iPad runs the dashboard.
A live OBS test has succeeded, with clear video and audio reported by the
church team. The team has since confirmed the simultaneous network and
mixer-audio checks are verified. Exact mixer wiring and test/recording evidence
still need to be recorded. The product is intended for one camera, one audio
feed, and one YouTube destination. Do not enable macOS Internet Sharing or IP
forwarding as an MVP workaround.

**Network status:** the camera was successfully reached at `192.168.100.76`
while the Mac was also connected to Wi-Fi. Earlier tests at camera
`192.168.1.76` with Mac Ethernet `192.168.1.10` and Wi-Fi `192.168.1.206`
found the camera accessible with Wi-Fi disabled, but unreliable with both
interfaces enabled. The church team now confirms the later simultaneous
camera/Wi-Fi test and mixer-audio path are verified; the successful OBS live
test had clear video and audio. Record the current Mac Ethernet settings and
test evidence for future maintenance. Make no network changes without a
backed-up, supervised maintenance and rollback plan.

## MVP features and screens

Keep V1 to three screens for the volunteer workflow:

1. **Overview:** At-a-glance camera, audio, OBS, and internet/stream health;
   show actionable preflight failures and links to Camera or Broadcast. No
   configuration dashboard or advanced metrics.
2. **Camera:** One live preview and three saved presets—Wide, Altar, Reader.
   Show camera connection and selected preset. No multi-camera layouts, manual
   joystick, or advanced PTZ controls in V1.
3. **Broadcast:** Preflight summary, Prepare, Go Live, current stream state,
   and End Broadcast with a clear confirmation. Keep essential audio/OBS/stream
   health visible while operating. No scheduling, graphics, or analytics.

Basic settings should be limited to values required to connect the single
camera, audio feed, OBS, and one YouTube destination; place them in context or
an in-screen panel, not a separate settings screen. Keep credentials out of the
dashboard. OBS stream controls are available in the explicitly configured local
OBS mode described below. Camera PTZ remains unintegrated; the optional live
OBS preview is provided separately through MediaMTX.

## Installation and development

Requires Node.js `^20.19.0 || ^22.13.0 || >=24.0.0` and npm 10+.
For Mac mini setup, OBS configuration, and the exact Docker/Node commands, see
[GETTING_STARTED.md](GETTING_STARTED.md).

```sh
npm ci
npm run dev
```

### Optional OBS preview

MediaMTX runs on the Mac mini. Set `MEDIAMTX_LAN_IP` to the Mac's current
Wi-Fi/LAN address (replace the example address), then run from the repository
root:

```sh
export MEDIAMTX_LAN_IP=192.168.1.206
docker compose up -d
```

Docker Desktop publishes WebRTC HTTP `8889/tcp` and ICE `8189/udp`; the
advertised LAN address lets iPad Safari reach the Mac rather than Docker's
private container address. Keep these ports on the trusted local network.
Stop MediaMTX with `docker compose down`.
Keep `MEDIAMTX_LAN_IP` exported in the shell for Compose commands. This LAN
preview setup is for the Mac mini, not Codespaces forwarding.

OBS's existing primary output can remain set to YouTube with local recording
unchanged. To add MediaMTX as a second output, install a macOS-compatible
[OBS Multi-RTMP plugin](https://github.com/sorayuki/obs-multi-rtmp/releases)
(current release offers a universal macOS package). This third-party plugin is
needed because OBS's primary stream output is already used by YouTube; it is
not an application dependency. In the plugin, add a secondary **WebRTC
(WHIP)** target at `http://127.0.0.1:8889/live/whip`. Do not replace the
existing YouTube target or change the recording output. Confirm plugin/OBS
compatibility and test both existing outputs after setup.

Set the dashboard URL in the ignored file `apps/dashboard/.env.local`, using
the Mac's actual Wi-Fi/LAN address in place of the example, then restart Vite:

```dotenv
VITE_MEDIAMTX_WEBRTC_URL=http://192.168.1.206:8889/live
```

The dashboard embeds MediaMTX's player with muted autoplay and inline playback;
its player reports a missing stream/connection. A missing or invalid dashboard
URL shows an unavailable placeholder. The `<500 ms` goal and iPad Safari
playback still require measurement on the church LAN; neither is verified by
local builds or tests.

Open port 5173 for the dashboard. In Codespaces, keep the forwarded port
private; Vite proxies API requests to the local agent. Useful checks:

```sh
npm run lint
npm test
npm run build
```

To enable OBS mode, turn on OBS WebSocket Server in OBS and set its password.
In the ignored root `.env` file, set the OBS URL and password:

```dotenv
OBS_WEBSOCKET_URL=ws://192.168.1.177:4455
OBS_WEBSOCKET_PASSWORD=<your OBS WebSocket password>
```

authentication; use it only on a trusted, private network. Browser confirmation
The agent loads `.env` at startup. With neither variable set, the app remains in
simulation mode; a URL without a password is rejected. Never commit the
password. In OBS mode, Check connection reads the OBS connection and stream state,
Start Livestream and End Broadcast require confirmation, and stream/recording
status comes from OBS. OBS input meter events appear by source name; their
mapping to the church mixer is not yet verified. When configured, MediaMTX
provides the browser video preview. Verify audio in OBS before starting, then
confirm YouTube delivery in YouTube Studio. Opt-in PTZOptics preset recall is
available with operator-verified mappings; directional PTZ remains unintegrated.
The dashboard has no user authentication; use it only on a trusted, private
network. Browser confirmation is not access control.

## Current implementation and hardware status

The current app is a **simulation foundation with opt-in OBS WebSocket control
and optional MediaMTX preview**, not a production broadcast system:

- React/Vite dashboard renders simulated status and controls by default. In OBS
  mode it reports OBS stream/recording status, displays OBS input meters, and
  can start/stop the configured OBS stream after confirmation. When MediaMTX is
  configured, the dashboard embeds its WebRTC preview.
- Optional **Main camera / Congregation (iPad)** buttons select existing OBS
  program scenes using exact, explicitly configured scene names. Actual program
  selection comes from OBS, with missing scenes disabled. Configure the iPad
  capture and shared mixer audio in OBS first; scene switching does not connect
  the iPad or verify its video. See [GETTING_STARTED.md](GETTING_STARTED.md).
- Fastify provides `GET /api/status`, `POST /api/commands`, and OBS meter/status
  endpoints. Zod contracts validate public state; agent state is in memory.
- An opt-in PTZOptics Move 4K HTTP adapter can recall confirmed stored presets
  after explicit confirmation. Camera control API connectivity is checked
  read-only; actual position and NDI video health remain unverified. Without
  camera configuration, real preset buttons stay disabled. See
  [GETTING_STARTED.md](GETTING_STARTED.md) before configuring hardware.
- Audio health and directional physical PTZ remain unintegrated. The
  OBS meter source is not yet mapped specifically to the church mixer. OBS
  output-active does not independently prove YouTube delivery, and the app
  does not configure the YouTube destination or control recording.
- Automated tests cover contracts, API transitions/errors, and dashboard
  behavior. They do not verify hardware.
- Hardware status: the church team confirms repeatable camera access at
  `192.168.100.76` with Wi-Fi connected and verifies the mixer-audio path. A
  live OBS test succeeded with clear video and audio. Exact mixer wiring and
  stream/recording evidence still need documentation; physical PTZ movement
  remains unverified. The church team confirms app-driven OBS start and stop
  now work. YouTube delivery still needs independent confirmation in YouTube
  Studio.

## Pull request status

All repository PRs were reviewed; GitHub's all-states listing returned one PR.
The repository exposes Copilot agent/reviewer workflows, not a project CI
workflow. PR check-run access was unavailable (403). The prior documentation
revision passed lint, 33 tests, and build; rerun validation after these OBS
integration changes.

| PR and title                                                                                                            | GitHub status               | Implemented functionality                                                                 | Evidence/status                                                                                                                                                                                                                                                                                           | Immediate next action                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [#1 — Bootstrap Kidane Mehret Live mock-only TypeScript monorepo](https://github.com/sibhatK/kidane-mehret-live/pull/1) | Open, not draft, not merged | React/Vite dashboard, Fastify API, shared Zod contracts, mock adapters, scripts and tests | OBS WebSocket connection and app-driven start/stop confirmed by the church team; camera/audio adapters remain mocked. Church OBS video/audio test succeeded. YouTube delivery and recording behavior remain to be documented. Two older review threads remain; requested fixes are included in `c281adb`. | Verify YouTube delivery and recording state, document evidence, and validate the remaining build/tests. |
