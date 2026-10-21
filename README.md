# Kidane Mehret Live

Kidane Mehret Live is a beginner-friendly control platform for the Sunday Divine
Liturgy livestream at **Kidane Mehret Eritrean Ge'ez Rite Church, Atlanta,
Georgia**. The goal is for volunteers to check camera, audio, and internet
health; prepare; start and monitor; then safely stop a broadcast from an iPad or
Mac without operating OBS directly. Reliability, simplicity, and audio quality
take priority.

> **Current application is simulation-only.** No camera moves, audio is sent,
> recording is made, or stream is sent to YouTube. The dashboard and backend
> use in-memory mocks and are not ready for church broadcasting.

## Project status

**As of 2026-10-21:** the TypeScript foundation is implemented, but its device
and broadcast behavior is mocked. No milestone has passed physical hardware or
church-pilot validation. Current blockers and criteria are in
[docs/WORKPLAN.md](docs/WORKPLAN.md).

| PR                                                         | Description                             | GitHub Status               | Milestone        | Implementation Status                                                                                                                                                                                                                                  | Next Action                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/sibhatK/kidane-mehret-live/pull/1) | Bootstrap mock-only TypeScript monorepo | Open, non-draft, not merged | M2/M3 foundation | Implemented: Fastify API, shared Zod contracts, React dashboard, and mock adapters. Tested locally: 33 tests pass; lint/build pass. Hardware-validated: no. Two outdated review threads remain unresolved; requested changes are present in `c281adb`. | Review/resolve the outdated threads and review the mock-only scope. Continue M0 hardware/network validation; do not treat this PR as a live system. |

GitHub listed two branches (`main` and this task branch). PR #1 changes the
initial application foundation; it does not implement the confirmed hardware
topology, real OBS/PTZ control, or any validated broadcast. No other PRs were
returned by the repository's all-states PR listing. See the
[workplan](docs/WORKPLAN.md) for milestone status and scope.

### Immediate next three engineering tasks

1. Complete M0 in a supervised maintenance window: back up current settings,
   confirm route cleanup, and validate simultaneous Wi-Fi/Ethernet on a
   controlled network plan. Do not change church equipment remotely.
2. Verify actual camera video in OBS and identify/test the mixer-to-Mac audio
   path before any stream test (M1).
3. After M0/M1 evidence, design the Mac-mini-to-iPad control boundary and
   security model; the current agent listens only on loopback and has no
   authentication.

## Locked V1 scope

V1 is one PTZOptics camera, one church audio feed, one YouTube destination, an
OBS-based Mac mini streaming engine, and a React dashboard controlled from an
iPad. It includes three PTZ presets (Wide, Altar, Reader), Prepare/Start/Stop,
real device/stream status, essential preflight and failure reporting, safe-stop
confirmation, and local recording where supported.

Multiple cameras, AI directing, a custom encoder, cloud hosting/databases,
advanced scheduling, elaborate graphics, multilingual UI, native mobile apps,
and unrelated infrastructure/features are excluded. Authentication is not a
feature-expansion target, but the minimum security required before safe local
remote operation is mandatory. Proposals outside V1 belong in a future
enhancements list and require explicit change approval; do not add them
implicitly. The current simulation does not yet implement most operational V1
requirements.

## Architecture and repository

```text
apps/dashboard/       React + Vite + Tailwind iPad/desktop interface
apps/agent/           Fastify API, command handling, mock adapters
packages/shared/      Zod schemas, TypeScript contracts, workflow guards
docs/                 Architecture, network findings, and milestone workplan
```

The intended deployment places OBS and the backend agent on the Mac mini; the
iPad is a control client over church Wi-Fi. The Mac has separate camera Ethernet
and internet Wi-Fi interfaces. This is an application-level intermediary, not
macOS Internet Sharing or IP forwarding. Today the agent binds to
`127.0.0.1:3001`; Vite proxies `/api` to it during development. Direct iPad access
to a loopback-only agent is therefore not implemented. Review
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/NETWORK_TROUBLESHOOTING.md](docs/NETWORK_TROUBLESHOOTING.md) before
designing the real connection.

The current adapter implementations are mocks. Shared status requires
`mode: "simulated"` and excludes a live broadcast state. No stream key or camera
credentials belong in browser code, shared contracts, or `VITE_*` variables.
The project currently has no credential configuration or authentication.

## Development

Prerequisites: Node.js `^20.19.0 || ^22.13.0 || >=24.0.0` and npm 10+.

```sh
npm ci
npm run dev
```

Open port 5173 for the dashboard. Keep Codespaces forwarding private; the
dashboard's development proxy reaches the loopback agent on port 3001.

| Command         | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `npm run build` | Build shared contracts, agent, and dashboard   |
| `npm run lint`  | Run ESLint and Prettier checks                 |
| `npm test`      | Build contracts and run Vitest                 |
| `npm start`     | Start the compiled agent on loopback port 3001 |

The repository includes Vitest tests for shared safety contracts, API
transitions/error handling, and dashboard simulation behavior. This checkout's
local validation on 2026-10-21 passed `npm run lint`, all 33 tests via
`npm test`, and `npm run build`. GitHub Actions currently lists Copilot
coding-agent and Copilot review workflows, not a project build/test workflow.
The PR check-run API was inaccessible to this review (403); do not interpret
agent-workflow completion as application CI. Run the local commands above for
code validation.

## Detailed documents

- [Architecture and integration boundaries](docs/ARCHITECTURE.md)
- [Church network findings and maintenance procedure](docs/NETWORK_TROUBLESHOOTING.md)
- [Locked scope, milestones, and acceptance criteria](docs/WORKPLAN.md)
