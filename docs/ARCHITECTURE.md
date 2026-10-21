# Architecture

## Target equipment topology

The church's Mac mini is intended to host OBS Studio and the local application
agent. A single PTZOptics Move 4K (PT30X-4K-WH-G3) camera connects to the Mac over
Ethernet; the church audio mixer will feed the Mac, but that connection is not
verified. The Mac uses church Wi-Fi for internet and YouTube. The camera's
existing HDMI output to the church television must remain functional. An iPad
on church Wi-Fi is the remote control client.

The Mac is an application-level intermediary between the separate camera and
iPad networks. This does not imply bridging, macOS Internet Sharing, or IP
forwarding; neither Internet Sharing nor IP forwarding is part of the MVP.
Observed interface configuration and test results are documented in
[NETWORK_TROUBLESHOOTING.md](NETWORK_TROUBLESHOOTING.md).

## Application components

| Component          | Current implementation                                                | Intended V1 role                                             |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/dashboard`   | React, Vite, TypeScript, Tailwind; simulated status and controls      | Volunteer UI on iPad Safari and Mac                          |
| `apps/agent`       | Fastify REST API, serialized commands, in-memory state; mock adapters | Local control/status boundary and future device/OBS adapters |
| `packages/shared`  | Zod schemas, inferred TypeScript types, workflow guards               | Validate commands and status between dashboard and agent     |
| OBS Studio         | Not connected or tested with live camera/audio                        | Encode/record and publish the controlled YouTube stream      |
| `obs-websocket-js` | Not installed or implemented                                          | Future agent-to-OBS control                                  |
| PTZ camera         | Hardware integration not implemented                                  | Future preset recall/status using a validated protocol       |

The target workflow is dashboard health review → Prepare → Start → monitor →
safe Stop. Currently all displayed device status, presets, and broadcast
transitions are mock state. The current `go-live` command calls
`startSimulation()`; it cannot start a real broadcast. The UI has no video
preview, safe-stop confirmation, or local recording control. These are
implementation gaps, not completed V1 features.

## Control and media flow

**Current development control path**

```text
Browser dashboard --same-origin /api--> Vite proxy
                                      --> 127.0.0.1:3001 Fastify agent
                                      --> in-memory camera/audio/OBS mocks
```

The dashboard polls `GET /api/status` every three seconds and sends validated
commands to `POST /api/commands`. Shared Zod schemas require simulated mode;
the agent validates commands, prevents overlapping commands, guards workflow
transitions, and returns sanitized status. The agent serializes commands only
within one process; state is in memory and resets on restart.

**Intended real media/control paths (not implemented)**

```text
PTZ camera --video protocol to validate--> OBS on Mac mini
Church mixer --connection/levels to validate--> OBS on Mac mini
OBS --encoded stream--> YouTube
iPad dashboard --authenticated local control boundary to design--> Mac agent
Mac agent --future adapters--> camera PTZ and OBS WebSocket
```

OBS discovery of an NDI source is not proof that OBS can decode its live video.
No real camera video, audio, PTZ command, OBS control, recording, or YouTube
stream has been validated. The architecture must not treat an advertised source
or a mock "connected" status as operational evidence.

## Network boundary and remote control gap

The current agent explicitly listens on `127.0.0.1:3001`; it is not reachable
directly from another device on Wi-Fi. In local development, Vite proxies API
requests to that loopback listener. A remote iPad deployment therefore needs a
deliberately designed control path on the Mac, not a casual wildcard bind or
network bridge. The current project has no authentication. Before enabling
remote controls, establish access restrictions, origin/request protections,
credential handling, and a safe failure/stop policy appropriate to the church
LAN.

## Authentication and credentials

There are no credentials, authentication, or secret configuration in the
current mock application. Never put YouTube stream keys, OBS passwords, or
camera credentials in browser bundles, `VITE_*` variables, shared contracts,
status responses, or logs. Future secrets must stay in a protected
Mac-side configuration boundary and be redacted from errors and responses.
Choose and document an appropriate local secret-storage mechanism before real
integrations; none is implemented today.

## Adapter design and assumptions

`apps/agent/src/adapters.ts` defines `CameraAdapter`, `AudioAdapter`, and
`ObsAdapter` interfaces. The mock camera stores the selected preset in memory;
the audio mock reports connected/unmuted; the OBS mock reports connected and
simulates prepare/start/end. These interfaces are boundaries only—not evidence
of device compatibility.

Still to validate before implementation:

- Camera network control, PTZ protocol/API, preset storage/recall, and address
  configuration behavior for the exact Move 4K model/firmware.
- A reliable camera-to-OBS video path; NDI discovery versus successful decode.
- Mixer output type, level, cabling/interface, and clean audio at OBS.
- OBS WebSocket version, connection/authentication, state semantics, recording,
  and a supervised private/test YouTube workflow.
- Mac network routing that preserves camera isolation and Wi-Fi internet while
  making the required control paths work.

Do not implement any real integration until its protocol, credentials, network
boundary, and acceptance tests are agreed and documented.
