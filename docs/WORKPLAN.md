# Workplan and locked V1 scope

## Status vocabulary

- **Implemented:** the corresponding code or document exists.
- **Mocked:** behavior is simulated and does not control equipment.
- **Tested:** automated or explicitly recorded tests cover the behavior; this
  does not imply hardware validation.
- **Hardware-validated:** verified with the church's actual equipment in its
  intended topology.
- **Blocked:** a dependency or unresolved failure prevents acceptance.
- **Not started:** no evidence of execution.

Status below is based on the repository implementation and the church test
observations supplied for this task. A passing unit test is not proof of
hardware or broadcast readiness.

## Locked V1 boundaries

**Included**

1. One PTZOptics camera and one church audio feed.
2. One YouTube livestream destination.
3. Mac mini local OBS streaming engine.
4. React dashboard accessible from an iPad.
5. Wide, Altar, and Reader PTZ presets.
6. Prepare, Start Livestream, and Stop Livestream actions.
7. Real camera, audio, OBS, and stream status.
8. Essential preflight checks and failure reporting.
9. Safe stop confirmation and local recording where supported.

**Excluded**

Multiple cameras, AI auto-directing, custom video encoding, cloud hosting or
databases, advanced scheduling, complex graphics/animation, multilingual
interfaces, native mobile applications, and unrelated infrastructure or feature
expansion. User management is excluded beyond minimum security required for safe
local operation. Security required to safely expose controls is not optional.

Do not silently add excluded features. Record proposals as future enhancements,
with rationale and impact, and obtain explicit owner approval before changing
the V1 scope.

## Milestones

| Milestone                                | Deliverables and acceptance criteria                                                                                                                                                                                        | Dependencies                                                                                                                                    | Evidence-based status                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 — Hardware and Network Validation** | Stable simultaneous Ethernet and Wi-Fi; camera admin reachable; video protocol compatibility determined; PTZ commands validated; church audio mixer identified. Record configuration, test results, and rollback.           | Physical access, authorized operator, confirmed maintenance plan, manufacturer compatibility information.                                       | **IN PROGRESS / BLOCKED.** Link and camera web UI work under limited conditions; with both interfaces enabled camera is unreachable. Temporary Ethernet route did not restore connectivity; route removal is unconfirmed. Actual video/PTZ and mixer path remain unverified. |
| **M1 — OBS Streaming Validation**        | OBS receives actual camera video and clean mixer audio; validate recording and a supervised controlled YouTube test stream, with safe stop and recovery evidence.                                                           | M0 network/video path and mixer interface identified; OBS configuration and authorized test destination.                                        | **PENDING VALIDATION.** NDI source discovery was observed, but live video decode was not verified. No actual audio, recording, or YouTube stream validation is evidenced.                                                                                                    |
| **M2 — TypeScript Backend**              | Fastify API; shared contracts; adapter boundaries; OBS connection and real status reporting; safe command/error handling. Acceptance includes integration tests against approved real adapters without leaking credentials. | Mock foundation exists; real OBS/API, network boundary, secret handling, and status semantics must be selected. Real integration depends on M1. | **PARTIAL — mock foundation implemented and tested.** Fastify routes, shared Zod contracts, workflow guards, in-memory mocks, and error redaction exist. OBS is not connected; no real connection reporting.                                                                 |
| **M3 — React Dashboard**                 | Responsive iPad-friendly dashboard showing actual status, preflight/failure reporting, and safe preparation/broadcast controls. Accept on iPad/Mac with disconnected and recovery states.                                   | Current UI exists; real status/control adapter and remote iPad access/security design are prerequisites for operational acceptance.             | **PARTIAL — simulation implemented and tested.** Responsive UI and mock controls exist. It displays only mock states; actual device/stream status, safe-stop confirmation, and real operational controls are absent.                                                         |
| **M4 — PTZ Integration**                 | Preset selection mapped to saved camera presets; verify physical movement, reliable recall, and failure handling for Wide, Altar, Reader.                                                                                   | M0 validates network, camera model/firmware, protocol, and preset configuration; secure agent-side adapter.                                     | **NOT HARDWARE-VALIDATED.** UI/adapter preset changes update mock state only. No PTZ integration or physical movement evidence.                                                                                                                                              |
| **M5 — Church Pilot**                    | End-to-end rehearsal, volunteer usability, failure/recovery tests, and a supervised Sunday livestream; record sign-off and recovery procedure.                                                                              | M0–M4 accepted; operational security, safe stop, monitoring, audio quality, and supervised streaming approvals.                                 | **NOT STARTED.** No pilot or supervised real broadcast evidence.                                                                                                                                                                                                             |

### Dependencies and sequence

M0 is the immediate blocker for selecting a real camera network/control path.
M1 depends on usable camera video and mixer audio, and gates operational OBS
work in M2. M2 and M3 mock foundations may be refined within V1, but cannot be
accepted as actual device control until their real adapter and remote-access
dependencies are met. M4 depends on M0 and a validated camera protocol. M5
depends on acceptance of the operational portions of M0–M4.

## Definition of Done

A milestone is done only when its deliverables and acceptance criteria are
recorded with reproducible evidence; tests identify whether coverage is unit,
integration, or physical hardware; failures and recovery behavior are reviewed;
secrets remain outside the browser and repository; and no unapproved scope was
added. Hardware-dependent milestones require explicit on-equipment results.
Mock tests alone cannot satisfy hardware acceptance. A supervised stream is
required before claiming pilot readiness.

## Change control

For a new request, first classify it as required V1 work, a safety/security
requirement, or a future enhancement. Document the user need, milestone,
dependencies, acceptance criteria, impact on reliability/volunteer operation,
and any new equipment or credentials. Obtain owner approval before expanding
V1. Do not alter hardware remotely, enable Internet Sharing/IP forwarding,
expose the local agent broadly, merge/close/approve PRs, or start a real stream
without explicit authorization and a rollback/supervision plan.

## Current next actions

1. Complete M0's controlled dual-interface network diagnosis, verify route
   cleanup, and establish a backed-up/rollback-capable migration plan.
2. Validate actual camera video in OBS and identify the mixer-to-Mac audio path
   before conducting M1's supervised recording/stream tests.
3. Design a secure, limited Mac-mini-to-iPad control boundary and credentials
   handling before replacing mock adapters or exposing any controls.
