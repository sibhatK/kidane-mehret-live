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
The camera live video and audio are now reported as received in OBS. The
specific church-mixer-to-Mac audio path remains unverified. The product is
intended for one camera, one audio feed, and one YouTube destination. Do not
enable macOS Internet Sharing or IP forwarding as an MVP workaround.

**Network status:** the camera was successfully reached at `192.168.100.76`
while the Mac was also connected to Wi-Fi. Earlier tests at camera
`192.168.1.76` with Mac Ethernet `192.168.1.10` and Wi-Fi `192.168.1.206`
found the camera accessible with Wi-Fi disabled, but unreliable with both
interfaces enabled. The new result is evidence of successful simultaneous
access in that test; OBS is now reported to receive camera live video and
audio. Confirm and record the current Mac Ethernet settings and repeat the
test before calling network reliability validated. Make no network changes without a
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
dashboard wherever possible. Real camera and broadcast controls are not
implemented; the optional live OBS preview setup is described below.

## Installation and development

Requires Node.js `^20.19.0 || ^22.13.0 || >=24.0.0` and npm 10+.

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

## Current implementation and hardware status

The current app is a tested **simulation foundation**, not a production
broadcast system:

- React/Vite dashboard renders simulated status and controls. It displays the
  live OBS program only when the optional MediaMTX preview is configured; it
  does not control OBS or start/stop the YouTube stream.
- Fastify provides `GET /api/status` and `POST /api/commands`. Zod contracts
  validate mock state and commands; state is in memory and resets on restart.
- Camera, audio, and OBS status/control adapters are mocks. Selecting presets
  and starting a broadcast change mock state only; the MediaMTX preview is a
  separate OBS feed. There is no physical PTZ control, recording management,
  or app-managed YouTube stream.
- Automated tests cover contracts, API transitions/errors, and dashboard
  behavior. They do not verify hardware.
- Hardware status: camera web access at `192.168.100.76` succeeded with Wi-Fi
  connected, and camera live video and audio are now reported in OBS. Sustained
  network reliability and the source/route of OBS audio have not been
  independently documented here. The app still has no physical PTZ control or
  real OBS/YouTube integration; YouTube streaming from the app is unimplemented.
  OBS input success alone does not validate the app or a complete broadcast.

## Pull request status

All repository PRs were reviewed; GitHub's all-states listing returned one PR.
The repository exposes Copilot agent/reviewer workflows, not a project CI
workflow. PR check-run access was unavailable (403). Local validation for the
documentation revision passed lint, 33 tests, and build.

| PR and title                                                                                                            | GitHub status               | Implemented functionality                                                                 | Evidence/status                                                                                                                                                                                                         | Immediate next action                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1 — Bootstrap Kidane Mehret Live mock-only TypeScript monorepo](https://github.com/sibhatK/kidane-mehret-live/pull/1) | Open, not draft, not merged | React/Vite dashboard, Fastify API, shared Zod contracts, mock adapters, scripts and tests | Implemented and locally tested; device and broadcast behavior mocked; church hardware unverified; live preview/stream incomplete. Two outdated review threads remain, though requested fixes are included in `c281adb`. | Review the mock-only foundation and resolve outdated threads; proceed with supervised network and hardware validation before real integrations. |
