import {
  canExecute,
  presetSchema,
  type Command,
  type Status,
} from '@kidane/shared'
import { CameraPreview } from './CameraPreview'

interface Props {
  status: Status | null
  busy: boolean
  loading: boolean
  error: string | null
  onCommand: (command: Command) => void
}

const stateLabels = {
  idle: 'Not broadcasting',
  prepared: 'Prepared for simulation',
  simulating: 'Broadcast simulation running — NOT LIVE',
}

export function Dashboard({ status, busy, loading, error, onCommand }: Props) {
  const disabled = (command: Command) =>
    busy || !status || !canExecute(status, command)
  const devices = [
    ['Camera', 'PTZOptics Move 4K', status?.camera.connection],
    ['Audio', 'Church audio mixer', status?.audio.connection],
    ['OBS', 'Mac mini · OBS Studio', status?.obs.connection],
    ['Broadcast', 'YouTube · no API connection', status?.broadcast.connection],
  ] as const

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
          CONTROLS SIMULATED
        </span>
      </header>

      <aside className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-amber-100">
        Camera presets and broadcast controls are simulated. A configured
        preview shows the live OBS program; this dashboard does not start or
        stop YouTube streaming or recording.
      </aside>

      <div role="status" aria-live="polite">
        {loading
          ? 'Connecting to simulation agent…'
          : busy
            ? 'Applying simulated command…'
            : status
              ? 'Simulation agent connected · status refreshes every 3 seconds'
              : 'Simulation agent unavailable'}
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
        aria-label="Simulated connection status"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {devices.map(([name, detail, connection]) => (
          <article className="panel" key={name}>
            <h2 className="text-lg font-semibold">{name}</h2>
            <p className="mt-1 text-sm text-slate-300">{detail}</p>
            <p className="mt-4 font-medium">
              <span
                aria-hidden="true"
                className={`mr-2 inline-block size-2 rounded-full ${connection === 'connected' ? 'bg-amber-300' : 'bg-slate-400'}`}
              />
              {connection === 'connected'
                ? 'Connected (mock)'
                : connection === 'disconnected'
                  ? 'Disconnected (mock)'
                  : 'Unknown'}
            </p>
            {name === 'Audio' && status && (
              <p className="mt-1 text-sm text-slate-300">
                {status.audio.muted
                  ? 'Muted (simulated)'
                  : 'Unmuted (simulated)'}
              </p>
            )}
          </article>
        ))}
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
            aria-label="Simulated camera presets"
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
            Preset buttons update mock state only.
          </p>
        </section>

        <section className="panel" aria-labelledby="broadcast-heading">
          <p className="eyebrow">02 · Rehearse the broadcast</p>
          <h2 id="broadcast-heading" className="mt-2 text-2xl font-semibold">
            Broadcast controls
          </h2>
          <p
            className="my-5 rounded-xl bg-slate-950/40 p-4 text-lg font-medium"
            role="status"
          >
            {status
              ? stateLabels[status.broadcast.state]
              : 'Broadcast status unknown — NOT LIVE'}
          </p>
          <div className="grid gap-3">
            {(
              [
                ['prepare', 'Prepare', 'Check simulated equipment'],
                [
                  'go-live',
                  'Go Live',
                  'Simulation only — never starts a real stream',
                ],
                ['end', 'End Broadcast', 'End or cancel the simulation'],
              ] as const
            ).map(([action, label, detail]) => {
              const command = { type: 'broadcast', action } as const
              return (
                <button
                  className="control flex flex-col items-start text-left"
                  key={action}
                  disabled={disabled(command)}
                  onClick={() => onCommand(command)}
                >
                  <span>
                    {label}{' '}
                    <span className="text-xs font-normal">(simulated)</span>
                  </span>
                  <span className="mt-1 text-sm font-normal">{detail}</span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <footer className="pb-4 text-sm text-slate-300">
        Development rehearsal · no physical equipment required · state resets
        when the agent restarts
      </footer>
    </main>
  )
}
