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
The church mixer-to-Mac audio connection is not yet verified. The product is
intended for one camera, one audio feed, and one YouTube destination. Do not
enable macOS Internet Sharing or IP forwarding as an MVP workaround.

**Network status:** the camera was successfully reached at `192.168.100.76`
while the Mac was also connected to Wi-Fi. Earlier tests at camera
`192.168.1.76` with Mac Ethernet `192.168.1.10` and Wi-Fi `192.168.1.206`
found the camera accessible with Wi-Fi disabled, but unreliable with both
interfaces enabled. The new result is evidence of successful simultaneous
access in that test, not yet sustained reliability or proof of live OBS video.
Confirm and record the current Mac Ethernet settings and repeat the test before
calling the network validated. Make no network changes without a backed-up,
supervised maintenance and rollback plan.

## MVP features and screens

Keep V1 to a small volunteer workflow:

- **Status:** camera, audio, OBS, internet/broadcast connection health and
  preflight failures.
- **Camera:** live camera preview and Wide, Altar, Reader presets.
- **Broadcast:** Prepare, Go Live, monitor, and End Broadcast.
- **Basic settings:** only settings required to operate this workflow safely.

## Installation and development

Requires Node.js `^20.19.0 || ^22.13.0 || >=24.0.0` and npm 10+.

```sh
npm ci
npm run dev
```

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

- React/Vite dashboard renders simulated status, three preset controls, and
  Prepare/Go Live/End controls. It does **not** display a live camera preview.
- Fastify provides `GET /api/status` and `POST /api/commands`. Zod contracts
  validate mock state and commands; state is in memory and resets on restart.
- Camera, audio, and OBS adapters are mocks. Selecting presets and starting a
  broadcast change mock state only; there is no physical PTZ movement, media
  capture, recording, or YouTube stream.
- Automated tests cover contracts, API transitions/errors, and dashboard
  behavior. They do not verify hardware.
- Hardware status: one successful camera access test at `192.168.100.76` with
  Wi-Fi connected; sustained network reliability and live video decode in OBS
  remain unverified. Mixer audio connection is unverified; PTZ control and real
  OBS/YouTube streaming are unimplemented. Not ready for a church broadcast.

## Pull request status

All repository PRs were reviewed; GitHub's all-states listing returned one PR.
The repository exposes Copilot agent/reviewer workflows, not a project CI
workflow. PR check-run access was unavailable (403). Local validation for the
documentation revision passed lint, 33 tests, and build.

| PR and title                                                                                                            | GitHub status               | Implemented functionality                                                                 | Evidence/status                                                                                                                                                                                                         | Immediate next action                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1 — Bootstrap Kidane Mehret Live mock-only TypeScript monorepo](https://github.com/sibhatK/kidane-mehret-live/pull/1) | Open, not draft, not merged | React/Vite dashboard, Fastify API, shared Zod contracts, mock adapters, scripts and tests | Implemented and locally tested; device and broadcast behavior mocked; church hardware unverified; live preview/stream incomplete. Two outdated review threads remain, though requested fixes are included in `c281adb`. | Review the mock-only foundation and resolve outdated threads; proceed with supervised network and hardware validation before real integrations. |
