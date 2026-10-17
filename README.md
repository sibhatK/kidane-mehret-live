# Kidane Mehret Live

A mock-only livestream control foundation for **Kidane Mehret Eritrean Ge’ez
Rite Church in Atlanta**. Designed for iPad Safari and desktop browsers.

**Nothing in this project broadcasts.** Camera, mixer, OBS, and YouTube connection
indicators are simulated. “Go Live” starts an in-memory rehearsal, always labeled
**NOT LIVE**. No camera movement, media capture, preview feed, or external API
requests occur.

## Quick start / Codespaces

Use Node.js 22.12+ (Node 22 LTS recommended) and npm 10+.

1. Open this repository with **Code → Codespaces → Create codespace**.
2. Check `node --version`. If needed, run `nvm install` and `nvm use`.
3. In the repository root, run:

   ```sh
   npm ci
   npm run dev
   ```

4. In Codespaces’ **Ports** panel, open port **5173** in the browser. If it is not
   detected automatically, add it manually. Keep its visibility **Private**.
   Only forward 5173; the Vite proxy reaches the loopback-only agent on port 3001.
   The same forwarded URL works in iPad Safari after signing into GitHub.

Locally, run the same commands and open <http://localhost:5173>.
For a local-network iPad rehearsal, use your development computer’s LAN address
on port 5173 on a trusted network. Vite binds to all interfaces for this purpose.
Do not expose either development server to the public internet.

No `.env`, credentials, broadcasting equipment, OBS installation, or YouTube
account is needed. Supported UI baseline: Safari/iPadOS 16.4+ (Tailwind CSS 4).
Touch controls are at least 56px tall, with keyboard focus and pressed states.

## Commands

Run these from the repository root:

| Command                                                  | Purpose                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm ci`                                                 | Install the locked workspace dependencies                          |
| `npm run dev`                                            | Build shared contracts, then watch contracts, agent, and dashboard |
| `npm run build`                                          | Build contracts → agent → dashboard, with strict TypeScript checks |
| `npm run lint`                                           | ESLint and Prettier checks                                         |
| `npm run format`                                         | Format source and configuration                                    |
| `npm test`                                               | Build contracts and run all Vitest tests                           |
| `npm test -- apps/agent/src/app.test.ts`                 | Run targeted API tests                                             |
| `npm start`                                              | Run the compiled agent on loopback port 3001 (build first)         |
| `npm run preview -w @kidane/dashboard -- --host 0.0.0.0` | Preview the built dashboard on port 4173 with its API proxy        |

To smoke-test compiled output, run `npm run build`, then `npm start` and the
dashboard preview command in separate terminals. Vite preview is for verification,
not a production hosting service.

## Architecture

```text
apps/dashboard     React + Vite + Tailwind; validated, same-origin API client
apps/agent         Fastify; loopback-only REST API and in-memory mock adapters
packages/shared    Zod schemas, inferred TypeScript contracts, workflow guards
```

The Mac mini will eventually host OBS and the agent; the iPad is only a control
client. `CameraAdapter`, `AudioAdapter`, and `ObsAdapter` in
`apps/agent/src/adapters.ts` are the server-side integration boundaries for future
PTZOptics and OBS WebSocket work. Only mock implementations exist today. A real
integration will require a deliberate revision of the simulation-only contracts
and controls; it cannot be enabled with an environment flag.

The shared status contract requires `mode: "simulated"` and has no live state.
Agent responses and dashboard inputs are runtime-validated. Unapproved adapter
fields are stripped; adapter errors are not exposed to the client. Future stream
keys and camera credentials must remain in the agent, never in shared contracts,
browser bundles, or `VITE_*` variables.

### API

- `GET /api/status` — validated camera, audio, OBS, and broadcast status.
- `POST /api/commands` — validated simulation commands:

  ```json
  { "type": "preset", "preset": "Altar" }
  ```

  ```json
  { "type": "broadcast", "action": "prepare" }
  ```

Presets: `Wide`, `Altar`, `Reader`. Broadcast actions: `prepare`, `go-live`, `end`.
Workflow: `idle → prepared → simulating → idle`; `end` also cancels preparation.
Invalid commands return 400; unavailable transitions or overlapping commands
return 409. Prepare/Go Live require connected mock devices and unmuted mock audio;
End remains available if a simulated connection drops.

State lives only in the agent process and resets on restart. The dashboard polls
every three seconds, times requests out after five seconds, disables controls
while commands run, and discards stale status on request failure. Multiple clients
share agent state; the agent serializes commands.

## Verification and scope

Vitest covers schemas, credential-field stripping, readiness guards, workflow
transitions, presets, concurrency, error redaction, dashboard labels/button
availability, and API response validation/timeouts. A manual smoke test:

1. Select Wide, Altar, and Reader; confirm the selected simulated frame changes.
2. Prepare → Go Live; confirm **Broadcast simulation running — NOT LIVE**.
3. End Broadcast; confirm **Not broadcasting**.
4. Stop the agent; confirm controls disable after the next status request fails.
5. Restart the agent; confirm automatic reconnection with the reset mock state.
6. Repeat at iPad portrait/landscape and desktop widths; check touch and keyboard use.

This foundation deliberately excludes authentication, databases, cloud
infrastructure, YouTube APIs, actual streaming, NDI decoding, and PTZ hardware
control. It is **not ready for public deployment or real church broadcasting**.
No credentials should be configured for this MVP.
