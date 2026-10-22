import {
  canExecute,
  presetSchema,
  type AudioMeter,
  type Command,
  type Status,
} from '@kidane/shared'
import { CameraPreview } from './CameraPreview'

interface Props {
  status: Status | null
  busy: boolean
  loading: boolean
  error: string | null
  audioMeters: AudioMeter[]
  onCommand: (command: Command) => void
}

const simulationStateLabels = {
  idle: 'Not broadcasting',
  prepared: 'Prepared for simulation',
  starting: 'Starting simulated broadcast',
  streaming: 'Stream active',
  simulating: 'Broadcast simulation running — NOT LIVE',
}

const obsStateLabels = {
  idle: 'OBS stream stopped',
  prepared: 'Ready to start in OBS',
  starting: 'Starting OBS stream…',
  streaming: 'OBS output active',
  simulating: 'Unknown OBS stream state',
}

export function Dashboard({
  status,
  busy,
  loading,
  error,
  audioMeters,
  onCommand,
}: Props) {
  const obsMode = status?.mode === 'obs'
  const disabled = (command: Command) =>
    busy || !status || !canExecute(status, command)
  const devices = [
    {
      name: 'Camera',
      detail: obsMode ? 'PTZ control not integrated' : 'PTZOptics Move 4K',
      connection: status?.camera.connection,
      mock: !obsMode,
    },
    {
      name: 'Audio',
      detail: obsMode
        ? 'OBS input meters · mixer mapping unverified'
        : 'Church audio mixer',
      connection: status?.audio.connection,
      mock: !obsMode,
    },
    {
      name: 'OBS',
      detail: obsMode ? 'OBS WebSocket' : 'Mac mini · OBS Studio',
      connection: status?.obs.connection,
      mock: !obsMode,
    },
    {
      name: 'Broadcast',
      detail: obsMode
        ? 'OBS connection · stream status below'
        : 'YouTube · simulation only',
      connection: status?.broadcast.connection,
      mock: !obsMode,
    },
  ] as const
  const label = status
    ? (obsMode ? obsStateLabels : simulationStateLabels)[status.broadcast.state]
    : 'Broadcast status unknown — NOT LIVE'

  function sendBroadcastCommand(command: Command) {
    if (
      obsMode &&
      command.type === 'broadcast' &&
      (command.action === 'go-live' || command.action === 'end')
    ) {
      const message =
        command.action === 'go-live'
          ? 'Start the stream configured in OBS now? This sends the OBS output to its configured destination.'
          : 'Stop or cancel the current OBS stream?'
      if (!window.confirm(message)) return
      onCommand({ ...command, confirmed: true })
      return
    }
    onCommand(command)
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Church livestream control</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Kidane Mehret Live
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Kidane Mehret Eritrean Ge’ez Rite Church · Atlanta
          </p>
        </div>
        <span className="rounded-full border border-amber-300/50 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-200">
          {obsMode ? 'OBS CONTROL' : 'CONTROLS SIMULATED'}
        </span>
      </header>

      <aside className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-amber-100">
        {obsMode
          ? 'OBS control is active. Verify the MediaMTX preview and OBS audio meters before starting, then verify YouTube delivery in YouTube Studio. Camera PTZ and camera/audio health are not integrated with this app.'
          : 'Camera presets and broadcast controls are simulated. A configured MediaMTX preview shows the OBS program; this app does not start or stop YouTube streaming or recording.'}
      </aside>

      <div role="status" aria-live="polite">
        {loading
          ? 'Connecting to local agent…'
          : busy
            ? obsMode
              ? 'Sending command to OBS…'
              : 'Applying simulated command…'
            : status
              ? obsMode
                ? 'OBS control connected · status refreshes every 3 seconds'
                : 'Simulation agent connected · status refreshes every 3 seconds'
              : 'Local agent unavailable'}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-rose-300/50 bg-rose-300/10 p-4 text-rose-100"
        >
          {error}
        </p>
      )}

      <section
        aria-label={
          obsMode ? 'OBS and device status' : 'Simulated connection status'
        }
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {devices.map(({ name, detail, connection, mock }) => {
          const notIntegrated =
            obsMode && (name === 'Camera' || name === 'Audio')
          return (
            <article className="panel" key={name}>
              <h2 className="text-lg font-semibold">{name}</h2>
              <p className="mt-1 text-sm text-slate-300">{detail}</p>
              <p className="mt-4 font-medium">
                <span
                  aria-hidden="true"
                  className={`mr-2 inline-block size-2 rounded-full ${connection === 'connected' && !notIntegrated ? 'bg-amber-300' : 'bg-slate-400'}`}
                />
                {notIntegrated
                  ? 'Not integrated'
                  : connection === 'connected'
                    ? mock
                      ? 'Connected (mock)'
                      : 'Connected'
                    : connection === 'disconnected'
                      ? mock
                        ? 'Disconnected (mock)'
                        : 'Disconnected'
                      : 'Unknown'}
              </p>
              {name === 'OBS' && obsMode && status && (
                <p className="mt-1 text-sm text-slate-300">
                  Recording
                  {status.obs.recording === null
                    ? ' unknown'
                    : status.obs.recording
                      ? ' active'
                      : ' inactive'}
                </p>
              )}
              {name === 'Audio' && status && !obsMode && (
                <p className="mt-1 text-sm text-slate-300">
                  {status.audio.muted
                    ? 'Muted (simulated)'
                    : 'Unmuted (simulated)'}
                </p>
              )}
              {name === 'Audio' && obsMode && (
                <div
                  className="mt-3 space-y-3"
                  aria-label="OBS audio input meters"
                >
                  {audioMeters.length === 0 ? (
                    <p className="text-sm text-slate-300">
                      Waiting for OBS audio meter events
                    </p>
                  ) : (
                    audioMeters.map((meter) => (
                      <div key={meter.inputName}>
                        <div className="flex justify-between gap-2 text-xs text-slate-300">
                          <span className="truncate">{meter.inputName}</span>
                          <span>{meter.peakDb.toFixed(0)} dB</span>
                        </div>
                        <div
                          className="mt-1 h-2 overflow-hidden rounded bg-slate-700"
                          role="meter"
                          aria-label={`${meter.inputName} OBS audio level`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(meter.level * 100)}
                        >
                          <div
                            className="h-full bg-emerald-400"
                            style={{ width: `${meter.level * 100}%` }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </article>
          )
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel" aria-labelledby="camera-heading">
          <p className="eyebrow">01 · Frame the service</p>
          <h2 id="camera-heading" className="mt-2 text-2xl font-semibold">
            Camera presets
          </h2>
          <CameraPreview url={import.meta.env.VITE_MEDIAMTX_WEBRTC_URL} />
          <div
            role="group"
            aria-label={
              obsMode
                ? 'Unavailable camera presets'
                : 'Simulated camera presets'
            }
            className="mt-5 grid grid-cols-3 gap-3"
          >
            {presetSchema.options.map((preset) => {
              const command = { type: 'preset', preset } as const
              return (
                <button
                  className="control"
                  key={preset}
                  aria-pressed={status?.camera.preset === preset}
                  disabled={disabled(command)}
                  onClick={() => onCommand(command)}
                >
                  {preset}
                </button>
              )
            })}
          </div>
          <p className="mt-4 text-sm text-slate-300">
            {obsMode
              ? 'Physical PTZ controls are not connected.'
              : 'Preset buttons update mock state only.'}
          </p>
        </section>

        <section className="panel" aria-labelledby="broadcast-heading">
          <p className="eyebrow">
            02 · {obsMode ? 'Control OBS' : 'Rehearse the broadcast'}
          </p>
          <h2 id="broadcast-heading" className="mt-2 text-2xl font-semibold">
            Broadcast controls
          </h2>
          <p
            className="my-5 rounded-xl bg-slate-950/40 p-4 text-lg font-medium"
            role="status"
          >
            {label}
          </p>
          <div className="grid gap-3">
            {(
              [
                ['prepare', 'Prepare', 'Check simulated equipment'],
                [
                  'go-live',
                  obsMode ? 'Start Livestream' : 'Go Live',
                  obsMode
                    ? 'Starts the configured OBS output after confirmation'
                    : 'Simulation only — never starts a real stream',
                ],
                [
                  'end',
                  'End Broadcast',
                  obsMode
                    ? 'Stops the OBS stream after confirmation'
                    : 'End or cancel the simulation',
                ],
              ] as const
            ).map(([action, label, detail]) => {
              const command = { type: 'broadcast', action } as const
              const availabilityCommand =
                obsMode && (action === 'go-live' || action === 'end')
                  ? { ...command, confirmed: true as const }
                  : command
              return (
                <button
                  className="control flex flex-col items-start text-left"
                  key={action}
                  disabled={disabled(availabilityCommand)}
                  onClick={() => sendBroadcastCommand(command)}
                >
                  <span>
                    {label}{' '}
                    {!obsMode && (
                      <span className="text-xs font-normal">(simulated)</span>
                    )}
                  </span>
                  <span className="mt-1 text-sm font-normal">{detail}</span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <footer className="pb-4 text-sm text-slate-300">
        {obsMode
          ? 'OBS mode · stream state is read from OBS; camera and audio checks remain manual'
          : 'Development rehearsal · no physical equipment required · state resets when the agent restarts'}
      </footer>
    </main>
  )
}
